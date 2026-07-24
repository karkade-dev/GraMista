import { Prisma, type PrismaClient } from '@prisma/client';
import { creditPool, recomputeDonorCityChain } from './scoring';
import { recordAdminAction } from './adminLog';
import { anonymize } from './anonymize';

type Tx = Prisma.TransactionClient;

/** Назва міста для людського опису в журналі (фолбек — id, якщо раптом немає). */
async function cityName(tx: Tx, settlementId: string): Promise<string> {
  const s = await tx.settlement.findUnique({ where: { id: settlementId }, select: { name: true } });
  return s?.name ?? settlementId;
}

export interface UnrecognizedItem {
  externalId: string;
  who: string;
  amountUah: number;
  message: string;
  at: number;
  /** Поза грою: призначення міста НЕ поверне його в гру (липке виключення) — показуємо мітку. */
  outOfGame: boolean;
}

export const UNRECOGNIZED_PER_PAGE = 50;

export interface UnrecognizedPage {
  items: UnrecognizedItem[];
  /** Загальна к-сть нерозпізнаних за фільтром (для лічильника й пагінації). */
  total: number;
}

/**
 * Нерозпізнані донати (для ручного призначення міста), новіші — спершу; ім'я анонімізоване.
 * search — підрядок по імені АБО повідомленню (їх буває багато); skip/limit — offset-пагінація.
 */
export async function getUnrecognized(
  db: PrismaClient,
  userId: string,
  opts: { search?: string; skip?: number; limit?: number } = {},
): Promise<UnrecognizedPage> {
  const limit = opts.limit ?? UNRECOGNIZED_PER_PAGE;
  const skip = opts.skip ?? 0;
  const where: Prisma.DonationWhereInput = { userId, status: 'unrecognized' };
  const search = opts.search?.trim();
  if (search) {
    where.OR = [
      { donorName: { contains: search, mode: 'insensitive' } },
      { message: { contains: search, mode: 'insensitive' } },
    ];
  }
  const [rows, total] = await Promise.all([
    db.donation.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    db.donation.count({ where }),
  ]);
  return {
    items: rows.map((d) => ({
      externalId: d.externalId,
      who: anonymize(d.donorName) || '(без імені)',
      amountUah: d.amount.toNumber(),
      message: d.message,
      at: d.createdAt.getTime(),
      outOfGame: d.outOfGame,
    })),
    total,
  };
}

/**
 * Призначити місто нерозпізнаному донату (без журналювання) — ядро, спільне для одиночного
 * й масового призначення. Та сама логіка балів, що й у живого донату (creditPool). У транзакції.
 * Повертає нараховані бали або null (донату нема / уже розпізнаний / міста нема).
 */
async function assignCityTx(
  tx: Tx,
  userId: string,
  externalId: string,
  settlementId: string,
): Promise<number | null> {
  const d = await tx.donation.findUnique({ where: { userId_externalId: { userId, externalId } } });
  if (!d || d.status === 'recognized') return null;
  const settlement = await tx.settlement.findUnique({ where: { id: settlementId }, select: { id: true } });
  if (!settlement) return null;

  // Виключення з гри — липке: виключеному донату місто записуємо без балів,
  // доки його явно не повернуть кнопкою «у гру».
  const awarded = d.outOfGame
    ? new Prisma.Decimal(0)
    : (await creditPool(tx, userId, d.donorName, settlementId, d.amount, d.streamId, d.id, d.collectionId)).awarded;
  await tx.donation.update({
    where: { id: d.id },
    data: { status: 'recognized', settlementId, pointsAwarded: awarded },
  });
  return awarded.toNumber();
}

/**
 * Призначити місто нерозпізнаному донату → донарахувати бали (скарбничка «ім'я+місто»).
 * Атомарно; пише запис у журнал дій (відкат повертає донат у нерозпізнані).
 */
export async function assignCity(
  db: PrismaClient,
  userId: string,
  externalId: string,
  settlementId: string,
): Promise<{ ok: boolean; points: number } | null> {
  return db.$transaction(async (tx) => {
    const points = await assignCityTx(tx, userId, externalId, settlementId);
    if (points === null) return null;
    await recordAdminAction(tx, userId, {
      type: 'assignCity',
      summary: `Призначено місто «${await cityName(tx, settlementId)}» донату`,
      payload: { externalId, settlementId },
      undoable: true,
    });
    return { ok: true, points };
  });
}

/**
 * Змінити місто ВЖЕ розпізнаному донату (assignCity працює лише з нерозпізнаними).
 * Бали — SSOT PointEvent, поріг скарбнички враховано: переносимо донат у нове місто й
 * ПЕРЕРАХОВУЄМО обидві зачеплені пари «донатер+місто» через replay (`recomputeDonorCityChain`),
 * тож межі flush/порога лишаються коректними. Усе атомарно.
 * null — якщо донату нема / він нерозпізнаний / місто те саме / цільового міста нема.
 */
export async function reassignCity(
  db: PrismaClient,
  userId: string,
  externalId: string,
  newSettlementId: string,
): Promise<{ ok: boolean; points: number } | null> {
  return db.$transaction(async (tx) => {
    const d = await tx.donation.findUnique({ where: { userId_externalId: { userId, externalId } } });
    if (!d || d.status !== 'recognized' || !d.settlementId) return null;
    if (d.settlementId === newSettlementId) return null; // нічого не міняється
    const target = await tx.settlement.findUnique({ where: { id: newSettlementId }, select: { id: true } });
    if (!target) return null;

    const oldSettlementId = d.settlementId;
    const fromName = await cityName(tx, oldSettlementId);
    const toName = await cityName(tx, newSettlementId);
    await tx.donation.update({ where: { id: d.id }, data: { settlementId: newSettlementId } });

    // Перерахувати обидві зачеплені пари «донатер+місто»: старе місто (без цього донату) і нове (з ним).
    await recomputeDonorCityChain(tx, userId, d.donorName, oldSettlementId, d.collectionId);
    await recomputeDonorCityChain(tx, userId, d.donorName, newSettlementId, d.collectionId);

    await recordAdminAction(tx, userId, {
      type: 'reassignCity',
      summary: `Змінено місто донату: «${fromName}» → «${toName}»`,
      payload: { externalId, fromSettlementId: oldSettlementId, toSettlementId: newSettlementId },
      undoable: true,
    });

    const moved = await tx.donation.findUniqueOrThrow({ where: { id: d.id }, select: { pointsAwarded: true } });
    return { ok: true, points: moved.pointsAwarded.toNumber() };
  });
}

/**
 * Вивести донат з гри (value=true) або повернути (false): перемикає outOfGame і, якщо донат має
 * місто, ПЕРЕРАХОВУЄ пару «донатер+місто» (replay із порогом). Виведений донат балів не дає й
 * ховається від глядачів; повернутий — донараховується. Донат без міста просто ховається/
 * показується (балів у нього немає). Атомарно; журналюється (оборотно).
 * null — донату нема / позначка вже така.
 */
export async function setDonationOutOfGame(
  db: PrismaClient,
  userId: string,
  externalId: string,
  value: boolean,
): Promise<{ ok: boolean; points: number } | null> {
  return db.$transaction(async (tx) => {
    const d = await tx.donation.findUnique({ where: { userId_externalId: { userId, externalId } } });
    if (!d || d.outOfGame === value) return null;

    await tx.donation.update({
      where: { id: d.id },
      data: { outOfGame: value, ...(value ? { pointsAwarded: new Prisma.Decimal(0) } : {}) },
    });
    if (d.settlementId) await recomputeDonorCityChain(tx, userId, d.donorName, d.settlementId, d.collectionId);

    const cityLabel = d.settlementId ? `(місто «${await cityName(tx, d.settlementId)}»)` : '(без міста)';
    await recordAdminAction(tx, userId, {
      type: 'setDonationGame',
      summary: value ? `Виведено донат з гри ${cityLabel}` : `Повернено донат у гру ${cityLabel}`,
      payload: { externalId, from: String(!value), to: String(value), settlementId: d.settlementId },
      undoable: true,
    });

    const after = await tx.donation.findUniqueOrThrow({ where: { id: d.id }, select: { pointsAwarded: true } });
    return { ok: true, points: after.pointsAwarded.toNumber() };
  });
}

/**
 * Масове призначення одного міста кільком нерозпізнаним донатам; повертає к-сть успішних.
 * Атомарно (одна транзакція); пише ОДИН запис у журнал (відкат повертає всі в нерозпізнані).
 */
export async function assignCityBulk(
  db: PrismaClient,
  userId: string,
  externalIds: string[],
  settlementId: string,
): Promise<number> {
  return db.$transaction(async (tx) => {
    const assigned: string[] = [];
    for (const externalId of externalIds) {
      const points = await assignCityTx(tx, userId, externalId, settlementId);
      if (points !== null) assigned.push(externalId);
    }
    if (assigned.length > 0) {
      await recordAdminAction(tx, userId, {
        type: 'assignCityBulk',
        summary: `Масово призначено місто «${await cityName(tx, settlementId)}» (${assigned.length})`,
        payload: { externalIds: assigned, settlementId },
        undoable: true,
      });
    }
    return assigned.length;
  });
}

/** Ручне коригування балів міста (points може бути від'ємним). Атомарно; журналюється (відкат — прибрати подію). */
export async function adjustPoints(
  db: PrismaClient,
  userId: string,
  settlementId: string,
  points: number,
): Promise<boolean> {
  if (!Number.isFinite(points) || points === 0) return false;
  return db.$transaction(async (tx) => {
    const settlement = await tx.settlement.findUnique({ where: { id: settlementId }, select: { name: true } });
    if (!settlement) return false;
    // Корекція стосується поточного змагання — подію вішаємо на активний збір (як і ручні правки топу).
    const activeCol = await tx.collection.findFirst({ where: { userId, status: 'active' }, select: { id: true } });
    const ev = await tx.pointEvent.create({
      data: { userId, settlementId, points: new Prisma.Decimal(points), source: 'admin', streamId: null, collectionId: activeCol?.id ?? null },
    });
    await recordAdminAction(tx, userId, {
      type: 'adjustPoints',
      summary: `${points > 0 ? '+' : ''}${points} балів місту «${settlement.name}»`,
      payload: { pointEventId: ev.id, settlementId, points: String(points) },
      undoable: true,
    });
    return true;
  });
}

/**
 * Скинути бали + скарбнички одного міста (історія донатів лишається).
 * Журналюється як НЕЗВОРОТНА дія (undoable=false): знищує бали, відновити не можна.
 */
export async function resetCity(db: PrismaClient, userId: string, settlementId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const name = await cityName(tx, settlementId);
    await tx.pointEvent.deleteMany({ where: { userId, settlementId } });
    await tx.donorCityPool.deleteMany({ where: { userId, settlementId } });
    await recordAdminAction(tx, userId, {
      type: 'resetCity',
      summary: `Скинуто бали міста «${name}»`,
      payload: { settlementId },
      undoable: false,
    });
  });
}

/**
 * Скинути всі бали + скарбнички (історія донатів і стріми лишаються).
 * Журналюється як НЕЗВОРОТНА дія (undoable=false).
 */
export async function resetAll(db: PrismaClient, userId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.pointEvent.deleteMany({ where: { userId } });
    await tx.donorCityPool.deleteMany({ where: { userId } });
    await recordAdminAction(tx, userId, {
      type: 'resetAll',
      summary: 'Скинуто ВСІ бали',
      payload: {},
      undoable: false,
    });
  });
}
