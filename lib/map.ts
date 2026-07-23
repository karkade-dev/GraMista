import { Prisma, type PrismaClient } from '@prisma/client';
import { createdAtWhere, type PeriodWindow } from './period';
import { cityOpeners, openerKey } from './newCity';

export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  points: number;
  /** Закордонне місто (country !== 'UA') — для бірюзового стилю крапки на мапі. */
  abroad: boolean;
}

/** Дані для «спалаху» міста на мапі на новий донат (варіант Б: кільце + плашка). */
export interface DonationFlash {
  settlementId: string;
  name: string;
  lat: number;
  lon: number;
  amountUah: number;
  /** Донат відкрив місто (перший бал у зборі) — для святкового спалаху/тосту. */
  newCity: boolean;
  /** Закордонне місто — для бірюзового спалаху. */
  abroad: boolean;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Координати + сума донату для «спалаху» міста за його externalId (з NOTIFY donation).
 * null, якщо донат не знайдено, місто не розпізнане або в нього немає координат.
 */
export async function donationFlash(
  db: PrismaClient,
  userId: string,
  externalId: string,
): Promise<DonationFlash | null> {
  const d = await db.donation.findUnique({
    where: { userId_externalId: { userId, externalId } },
    select: {
      id: true,
      amount: true,
      collectionId: true,
      outOfGame: true,
      settlement: { select: { id: true, name: true, lat: true, lon: true, country: true } },
      user: { select: { abroadWorldMap: true } },
    },
  });
  if (d?.outOfGame) return null; // поза грою — глядачам не світимо
  const s = d?.settlement;
  if (!s || s.lat == null || s.lon == null) return null;
  const abroad = s.country !== 'UA';
  // Закордонна крапка спалахує лише коли стрімер увімкнув світову мапу (інакше — порожнеча за межами України).
  if (abroad && !d!.user.abroadWorldMap) return null;
  const openers = await cityOpeners(db, userId, [{ settlementId: s.id, collectionId: d!.collectionId }]);
  return {
    settlementId: s.id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    amountUah: d!.amount.toNumber(),
    newCity: openers.get(openerKey(s.id, d!.collectionId)) === d!.id,
    abroad,
  };
}

// Коалесинг запиту: на один NOTIFY шина donationBus синхронно будить УСІХ SSE-підписників
// стрімера в один тік, і кожен кинувся б за тими самими даними окремим запитом (N глядачів =
// N однакових findUnique на донат). Тримаємо натомість ОДИН запит «у польоті» на (userId,
// externalId) — решта чекають той самий проміс. Звільняємо ключ по завершенні (на settle),
// тож наступний донат робить свій запит. Так N глядачів = 1 запит на донат.
const flashInFlight = new Map<string, Promise<DonationFlash | null>>();

export function donationFlashShared(
  db: PrismaClient,
  userId: string,
  externalId: string,
): Promise<DonationFlash | null> {
  const key = `${userId}:${externalId}`;
  let inflight = flashInFlight.get(key);
  if (!inflight) {
    inflight = donationFlash(db, userId, externalId).finally(() => {
      flashInFlight.delete(key);
    });
    flashInFlight.set(key, inflight);
  }
  return inflight;
}

/**
 * Точки мапи — ЛИШЕ міста з балами (без скарбнички, без порожніх), з координатами.
 * Свідома зміна щодо legacy (там показувались і міста зі скарбничкою) — рішення в HANDOFF.
 * scope.streamId — «поточний стрім»; scope.collectionId — активний збір (точний фільтр замість вікна).
 */
export async function mapPoints(
  db: PrismaClient,
  userId: string,
  window: PeriodWindow = {},
  scope: { streamId?: string; collectionId?: string; includeAbroad?: boolean } = {},
): Promise<MapPoint[]> {
  const createdAt = createdAtWhere(window);
  const where = scope.streamId
    ? { userId, streamId: scope.streamId }
    : scope.collectionId
      ? { userId, collectionId: scope.collectionId }
      : { userId, ...(createdAt ? { createdAt } : {}) };
  const grouped = await db.pointEvent.groupBy({
    by: ['settlementId'],
    where,
    _sum: { points: true },
  });
  const withPoints = grouped.filter((g) => (g._sum.points ?? ZERO).gt(0));
  if (withPoints.length === 0) return [];

  const settlements = await db.settlement.findMany({
    where: { id: { in: withPoints.map((g) => g.settlementId) }, ...(scope.includeAbroad ? {} : { country: 'UA' }) },
    select: { id: true, name: true, lat: true, lon: true, country: true },
  });
  const meta = new Map(settlements.map((s) => [s.id, s]));

  const out: MapPoint[] = [];
  for (const g of withPoints) {
    const s = meta.get(g.settlementId);
    if (!s || s.lat == null || s.lon == null) continue; // без координат на мапу не виводимо
    out.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, points: (g._sum.points ?? ZERO).toNumber(), abroad: s.country !== 'UA' });
  }
  return out;
}
