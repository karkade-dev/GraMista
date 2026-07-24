import { Prisma, type PrismaClient, type Collection } from '@prisma/client';
import { leaderboard, type LeaderRow } from './leaderboard';
import { recomputeDonorCityChain } from './scoring';
import { formatUah, formatPoints } from './format';

// Збори (§17.4) — серія змагання: рамка топу міст. «Зібрано» = сума донатів із позначкою
// collectionId; «топ» = leaderboard({collectionId}) (журнал PointEvent з тим самим фільтром).
// Прив'язка стріму до збору лишається для звітів/навігації, але сумою/топом не керує.
// Див. docs/specs/2026-06-10-collections-as-seasons.md.

export const COLLECTION_STATUS = { active: 'active', paused: 'paused', completed: 'completed' } as const;
export type CollectionStatus = (typeof COLLECTION_STATUS)[keyof typeof COLLECTION_STATUS];

/** Порядок показу збору: активний → на паузі → завершені. */
const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1, completed: 2 };

export interface CollectionInput {
  name: string;
  /** Ціль-сума необов'язкова: серію-змагання можна вести й без грошової цілі. */
  goalUah?: number | null;
  /** Стартова сума («Вже зібрано»); 0 або відсутність — без стартової суми. */
  seedUah?: number | null;
  startAt?: Date;
  endAt?: Date | null;
}

export interface CollectionRow {
  id: string;
  name: string;
  /** null — збір без грошової цілі (прогрес-бар не показується). */
  goalUah: number | null;
  /** Реальні донати збору (через токен monobank) — НЕ враховує стартову суму; це й читає /ukraine. */
  raisedUah: number;
  /** Стартова сума («Вже зібрано») — лише для показу бара, не реальні гроші. 0, якщо нема. */
  seedUah: number;
  /** Показове «накопичено» = seedUah + raisedUah (власні вікна стрімера; НЕ /ukraine). */
  displayedUah: number;
  /** 0..100, обмежено для прогрес-бара (фактичний може бути >100); 0 коли цілі нема. */
  percent: number;
  /** % цілі від displayedUah (кеп 100); 0 без цілі. Бар власних вікон бере саме його. */
  displayedPercent: number;
  status: string;
  startAt: Date;
  endAt: Date | null;
  streamCount: number;
  /** Топ-3 — чипи в списку зборів і картинка-банер. Зріз cities. */
  topCities: LeaderRow[];
  /** Повний список міст збору з балами (без обмеження) — звіт-пост і drill-down. */
  cities: LeaderRow[];
}

/** Підсумок збору: зібрано (донати з позначкою збору), відсоток цілі, міста з балами, к-сть стрімів. */
export async function collectionSummary(db: PrismaClient, userId: string, c: Collection): Promise<CollectionRow> {
  const [agg, streamCount, cities] = await Promise.all([
    db.donation.aggregate({ where: { userId, collectionId: c.id, outOfGame: false }, _sum: { amount: true } }),
    db.stream.count({ where: { userId, collectionId: c.id } }),
    leaderboard(db, userId, { collectionId: c.id, limit: null }),
  ]);
  const raisedUah = agg._sum.amount?.toNumber() ?? 0;
  const seedUah = c.seedUah?.toNumber() ?? 0;
  const displayedUah = seedUah + raisedUah;
  const goalUah = c.goalUah?.toNumber() ?? null;
  const percent = goalUah && goalUah > 0 ? Math.min(100, (raisedUah / goalUah) * 100) : 0;
  const displayedPercent = goalUah && goalUah > 0 ? Math.min(100, (displayedUah / goalUah) * 100) : 0;
  return {
    id: c.id,
    name: c.name,
    goalUah,
    raisedUah,
    seedUah,
    displayedUah,
    percent,
    displayedPercent,
    status: c.status,
    startAt: c.startAt,
    endAt: c.endAt,
    streamCount,
    topCities: cities.slice(0, 3),
    cities,
  };
}

/** Текст звіту-посту по збору (для копіювання й публікації) — §17.4. Відсоток — фактичний (може >100). */
export function collectionReportText(c: CollectionRow): string {
  const pct = c.goalUah && c.goalUah > 0 ? Math.round((c.displayedUah / c.goalUah) * 100) : 0;
  const sumLine = c.goalUah
    ? `💰 Зібрано ${formatUah(c.displayedUah)} з ${formatUah(c.goalUah)} (${pct}%)`
    : `💰 Зібрано ${formatUah(c.displayedUah)}`;
  const lines = [`🎯 ${c.name}`, sumLine];
  if (c.cities.length > 0) {
    lines.push('🏆 Міста збору:');
    for (const [i, x] of c.cities.entries()) lines.push(`${i + 1}. ${x.name} — ${formatPoints(x.points)}`);
  }
  return lines.join('\n');
}

/** Єдине джерело «який збір зараз грає» — реюзають інжест, дашборд, оверлеї, публічна. */
export async function getActiveCollection(db: PrismaClient, userId: string): Promise<Collection | null> {
  return db.collection.findFirst({ where: { userId, status: COLLECTION_STATUS.active } });
}

/** Зробити збір активним; поточний активний (якщо інший) сам стає на паузу. Атомарно. */
export async function activateCollection(db: PrismaClient, userId: string, id: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const c = await tx.collection.findFirst({ where: { id, userId }, select: { id: true, status: true } });
    if (!c) return false;
    if (c.status === COLLECTION_STATUS.active) return true;
    await tx.collection.updateMany({
      where: { userId, status: COLLECTION_STATUS.active },
      data: { status: COLLECTION_STATUS.paused },
    });
    await tx.collection.update({ where: { id: c.id }, data: { status: COLLECTION_STATUS.active } });
    return true;
  });
}

async function setStatus(
  db: PrismaClient,
  userId: string,
  id: string,
  status: CollectionStatus,
  extra: Prisma.CollectionUpdateInput = {},
): Promise<boolean> {
  const c = await db.collection.findFirst({ where: { id, userId }, select: { id: true } });
  if (!c) return false;
  await db.collection.update({ where: { id: c.id }, data: { status, ...extra } });
  return true;
}

/** Пауза: донати тимчасово не ловляться цим збором; топ і сума на місці. */
export async function pauseCollection(db: PrismaClient, userId: string, id: string): Promise<boolean> {
  return setStatus(db, userId, id, COLLECTION_STATUS.paused);
}

/** Завершити: збір стає архівом (нічого не видаляється); endAt — момент завершення, якщо не задано. */
export async function completeCollection(db: PrismaClient, userId: string, id: string): Promise<boolean> {
  const c = await db.collection.findFirst({ where: { id, userId }, select: { endAt: true } });
  if (!c) return false;
  return setStatus(db, userId, id, COLLECTION_STATUS.completed, c.endAt ? {} : { endAt: new Date() });
}

/** Усі збори з підсумками: активний → на паузі → завершені, всередині — новіші. */
export async function listCollections(db: PrismaClient, userId: string): Promise<CollectionRow[]> {
  const cols = await db.collection.findMany({ where: { userId } });
  cols.sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      b.startAt.getTime() - a.startAt.getTime(),
  );
  return Promise.all(cols.map((c) => collectionSummary(db, userId, c)));
}

/** Деталі збору: підсумок + повний топ міст + прив'язані стріми. */
export async function getCollection(
  db: PrismaClient,
  userId: string,
  id: string,
): Promise<{ collection: CollectionRow; cities: LeaderRow[] } | null> {
  const c = await db.collection.findFirst({ where: { id, userId } });
  if (!c) return null;
  const collection = await collectionSummary(db, userId, c);
  return { collection, cities: collection.cities };
}

/** Легкий перелік зборів для селекторів (прив'язка стріму до збору з вкладки Стріми). */
export async function listCollectionOptions(
  db: PrismaClient,
  userId: string,
): Promise<{ id: string; name: string; status: string }[]> {
  const cols = await db.collection.findMany({
    where: { userId },
    select: { id: true, name: true, status: true, startAt: true },
  });
  cols.sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      b.startAt.getTime() - a.startAt.getTime(),
  );
  return cols.map(({ id, name, status }) => ({ id, name, status }));
}

/** Створити збір (на паузі — активують окремою кнопкою, інакше другий create впав би об індекс «активний — один»). */
export async function createCollection(db: PrismaClient, userId: string, input: CollectionInput): Promise<Collection> {
  return db.collection.create({
    data: {
      userId,
      name: input.name.trim() || 'Збір',
      goalUah: input.goalUah != null ? new Prisma.Decimal(input.goalUah) : null,
      seedUah: new Prisma.Decimal(input.seedUah ?? 0),
      ...(input.startAt ? { startAt: input.startAt } : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
      status: COLLECTION_STATUS.paused,
    },
  });
}

/** Редагувати збір: назва / ціль / дата кінця / статус. */
export async function updateCollection(
  db: PrismaClient,
  userId: string,
  id: string,
  patch: { name?: string; goalUah?: number | null; seedUah?: number; endAt?: Date | null; status?: CollectionStatus },
): Promise<boolean> {
  const c = await db.collection.findFirst({ where: { id, userId }, select: { id: true } });
  if (!c) return false;
  await db.collection.update({
    where: { id: c.id },
    data: {
      ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
      // undefined — не чіпаємо ціль; null — прибрати ціль (збір без грошової цілі).
      ...(patch.goalUah !== undefined ? { goalUah: patch.goalUah != null ? new Prisma.Decimal(patch.goalUah) : null } : {}),
      ...(patch.seedUah !== undefined ? { seedUah: new Prisma.Decimal(patch.seedUah) } : {}),
      ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    },
  });
  return true;
}

/** Видалити збір: стріми лишаються, лише відв'язуються (FK onDelete: SetNull). */
export async function deleteCollection(db: PrismaClient, userId: string, id: string): Promise<boolean> {
  const r = await db.collection.deleteMany({ where: { id, userId } });
  return r.count > 0;
}

/**
 * Перенести донат в інший збір (або «поза збором», collectionId=null). Донат і його бали
 * переїжджають разом; пари «донатер+місто» в СТАРОМУ й НОВОМУ зборі перераховуються реплеєм
 * (та сама механіка, що при зміні міста) — межі порога скарбнички лишаються чесними.
 */
export async function moveDonationToCollection(
  db: PrismaClient,
  userId: string,
  externalId: string,
  collectionId: string | null,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const d = await tx.donation.findUnique({
      where: { userId_externalId: { userId, externalId } },
      select: { id: true, donorName: true, settlementId: true, status: true, collectionId: true },
    });
    if (!d || d.collectionId === collectionId) return false;
    if (collectionId) {
      const c = await tx.collection.findFirst({ where: { id: collectionId, userId }, select: { id: true } });
      if (!c) return false;
    }
    const from = d.collectionId;
    await tx.donation.update({ where: { id: d.id }, data: { collectionId } });
    if (d.status === 'recognized' && d.settlementId) {
      await recomputeDonorCityChain(tx, userId, d.donorName, d.settlementId, from);
      await recomputeDonorCityChain(tx, userId, d.donorName, d.settlementId, collectionId);
    }
    // нерозпізнаний — балів/подій нема, досить перевісити позначку
    return true;
  });
}
