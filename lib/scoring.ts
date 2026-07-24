import { Prisma, type PrismaClient } from '@prisma/client';

/** 1 бал = 100 грн (з дробом). Див. docs/CONCEPT.md §4. */
export const POINTS_PER_UAH = 1 / 100;
/** Поріг скарбнички (грн). */
export const THRESHOLD_UAH = 100;

const THRESHOLD = new Prisma.Decimal(THRESHOLD_UAH);
const ZERO = new Prisma.Decimal(0);

/** Транзакційний клієнт Prisma (підмножина без $transaction). */
type Tx = Prisma.TransactionClient;

export interface DonationInput {
  externalId: string;
  donorName: string;
  amountUah: number;
  message: string;
  sourceId?: string | null;
}

export interface ApplyResult {
  matched: boolean;
  pointsAwarded: number;
  pendingUah: number;
}

export interface PoolResult {
  /** нараховані бали (0, якщо ще накопичується у скарбничці) */
  awarded: Prisma.Decimal;
  /** залишок у скарбничці після операції (0, якщо стався flush) */
  pending: Prisma.Decimal;
}

/**
 * Зараховує суму у скарбничку пари «донатер + місто»; коли пул ≥ 100 грн —
 * уся сума конвертується в бали (грн/100), пул обнуляється, пишеться PointEvent.
 * Єдине джерело логіки балів — викликається і живим донатом, і ручним призначенням міста.
 * Виконується ВСЕРЕДИНІ транзакції.
 */
export async function creditPool(
  tx: Tx,
  userId: string,
  donorKey: string,
  settlementId: string,
  amount: Prisma.Decimal,
  streamId: string | null,
  donationId: string | null,
  collectionId: string | null,
): Promise<PoolResult> {
  // Скарбничка скоупиться трійкою (донатер, місто, збір). Унікальний ключ знято зі схеми
  // (nullable collectionId не тримається), тож findFirst + create/update за id; унікальність
  // страхують часткові індекси, а інжест користувача послідовний — гонки нема.
  const existing = await tx.donorCityPool.findFirst({
    where: { userId, donorKey, settlementId, collectionId },
    select: { id: true, accumulatedAmount: true },
  });
  const newPool = (existing?.accumulatedAmount ?? ZERO).plus(amount);

  if (newPool.gte(THRESHOLD)) {
    const awarded = newPool.div(100); // POINTS_PER_UAH = 1/100
    if (existing) await tx.donorCityPool.update({ where: { id: existing.id }, data: { accumulatedAmount: ZERO } });
    else await tx.donorCityPool.create({ data: { userId, donorKey, settlementId, collectionId, accumulatedAmount: ZERO } });
    await tx.pointEvent.create({
      data: {
        userId, settlementId, points: awarded, donationId, streamId, collectionId,
        source: amount.gte(THRESHOLD) ? 'donation' : 'pool_flush',
      },
    });
    return { awarded, pending: ZERO };
  }

  if (existing) await tx.donorCityPool.update({ where: { id: existing.id }, data: { accumulatedAmount: newPool } });
  else await tx.donorCityPool.create({ data: { userId, donorKey, settlementId, collectionId, accumulatedAmount: newPool } });
  return { awarded: ZERO, pending: newPool };
}

/**
 * Перерахунок (replay) скарбнички + балів для пари «донатер N + місто C».
 * Скарбничка/бали пари — чиста функція від упорядкованого списку РОЗПІЗНАНИХ донатів N→C, тож
 * надійний спосіб «відкотити старе й нарахувати нове» (напр. після зміни міста донату) —
 * стерти донат-події й пул цієї пари та відтворити їх, проганяючи донати через `creditPool` у
 * тому ж порядку (createdAt, id), що й наживо. Так межі flush/порога лишаються коректними —
 * відняти один донат із середини ланцюга, що вже флашився, інакше не можна.
 *
 * Адмін-події (`source='admin'`, `donationId=null`) НЕ чіпаються. Виконується ВСЕРЕДИНІ транзакції.
 * Інваріант: у нарахуванні бере участь розпізнаний донат У ГРІ (`outOfGame: false`) — виключення
 * липке, тож розпізнаний-але-виключений донат (зокрема після assignCity) через creditPool не йшов.
 */
export async function recomputeDonorCityChain(
  tx: Tx,
  userId: string,
  donorKey: string,
  settlementId: string,
  collectionId: string | null,
): Promise<void> {
  // Ланцюг = «донатер + місто + збір»: replay бере лише донати цього збору, видаляє події/пул
  // лише цього збору. Беремо всі донати N (будь-яке місто), щоб прибрати й подію донату, який
  // щойно ВИНЕСЛИ з C (його donationId уже не в ланцюгу C, але стара подія в C ще лежить).
  const donorDonationIds = (
    await tx.donation.findMany({ where: { userId, donorName: donorKey }, select: { id: true } })
  ).map((d) => d.id);

  await tx.pointEvent.deleteMany({
    where: { userId, settlementId, collectionId, donationId: { in: donorDonationIds } },
  });
  await tx.donorCityPool.deleteMany({
    where: { userId, donorKey, settlementId, collectionId },
  });

  const chain = await tx.donation.findMany({
    where: { userId, donorName: donorKey, settlementId, collectionId, status: 'recognized', outOfGame: false },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (chain.length > 0) {
    await tx.donation.updateMany({ where: { id: { in: chain.map((c) => c.id) } }, data: { pointsAwarded: ZERO } });
  }
  for (const c of chain) {
    const { awarded } = await creditPool(tx, userId, donorKey, settlementId, c.amount, c.streamId, c.id, collectionId);
    if (awarded.gt(0)) {
      await tx.donation.update({ where: { id: c.id }, data: { pointsAwarded: awarded } });
    }
  }
}

/**
 * Застосовує живий донат атомарно (Donation + DonorCityPool + PointEvent у $transaction):
 *  - місто не розпізнане → донат збережено (unrecognized), балів нема;
 *  - інакше сума йде у скарбничку (див. creditPool).
 * Ключ скарбнички — повне ім'я (внутрішньо; назовні анонімізуємо).
 */
export async function applyDonation(
  db: PrismaClient,
  userId: string,
  d: DonationInput,
  settlementId: string | null,
  streamId: string | null = null,
  opts: { awardPoints?: boolean; collectionId?: string | null } = {},
): Promise<ApplyResult> {
  // awardPoints=false («битва міст» вимкнена): донат зберігаємо з містом для історії,
  // але без скарбнички/балів — лише гроші. Див. docs/specs/2026-06-07-money-and-cities.md.
  const awardPoints = opts.awardPoints ?? true;
  const collectionId = opts.collectionId ?? null;
  return db.$transaction(async (tx) => {
    // Дедуп за (userId, externalId) — той самий донат не обробляємо двічі.
    const existing = await tx.donation.findUnique({
      where: { userId_externalId: { userId, externalId: d.externalId } },
      select: { id: true },
    });
    if (existing) return { matched: false, pointsAwarded: 0, pendingUah: 0 };

    const amount = new Prisma.Decimal(d.amountUah);

    if (!settlementId) {
      await tx.donation.create({
        data: {
          userId, externalId: d.externalId, donorName: d.donorName, amount,
          message: d.message, sourceId: d.sourceId ?? null, streamId, collectionId,
          status: 'unrecognized', outOfGame: !awardPoints,
        },
      });
      return { matched: false, pointsAwarded: 0, pendingUah: 0 };
    }

    const donation = await tx.donation.create({
      data: {
        userId, externalId: d.externalId, donorName: d.donorName, amount,
        message: d.message, sourceId: d.sourceId ?? null, settlementId, streamId, collectionId,
        status: 'recognized', outOfGame: !awardPoints,
      },
    });

    if (!awardPoints) {
      // Місто розпізнане й записане, але балів/скарбнички нема — лише гроші.
      return { matched: true, pointsAwarded: 0, pendingUah: 0 };
    }

    const { awarded, pending } = await creditPool(tx, userId, d.donorName, settlementId, amount, streamId, donation.id, collectionId);
    if (awarded.gt(0)) {
      await tx.donation.update({ where: { id: donation.id }, data: { pointsAwarded: awarded } });
    }
    return { matched: true, pointsAwarded: awarded.toNumber(), pendingUah: pending.toNumber() };
  });
}
