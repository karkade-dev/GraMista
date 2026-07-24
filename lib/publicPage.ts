import type { PrismaClient } from '@prisma/client';
import { getState, type DashboardState } from './dashboard';
import { collectionSummary, type CollectionRow } from './collections';
import { getStreams, type StreamSummary } from './streams';
import { leaderboard, type LeaderRow } from './leaderboard';
import { userIdByHandle } from './publicUser';

// Публічний рівень даних сторінки /<handle> (§18). Цей тип — ЄДИНЕ, що йде назовні:
// секрети (email, overlayKey, webhookSecret, повні імена) не потрапляють сюди за побудовою.
export interface PublicProfile {
  name: string;
  handle: string;
  twitchUrl: string | null;
  youtubeUrl: string | null;
  telegramUrl: string | null;
  monobankJarUrl: string | null;
  publicShowStreams: boolean;
  /** Показувати коментарі донатів у стрічці публічної сторінки. */
  showCommentPublic: boolean;
}

export interface BattleGap {
  leader: LeaderRow;
  challenger: LeaderRow;
  /** Відставання №2 від №1, балів (округлено до 0.1). */
  diff: number;
}

export interface PublicTiles {
  todayRaisedUah: number;
  todayLeader: { name: string; points: number } | null;
  biggestTodayUah: number;
}

export interface PublicPageData {
  userId: string;
  profile: PublicProfile;
  /** Мапа/стрічка/сума/активний стрім — реюз стану панелі (стрічка вже анонімізована). */
  state: DashboardState;
  /** УСІ міста з балами активного збору (нема збору → за весь час); топ-10/30/«усі» — зрізи на UI. */
  fullLeaderboard: LeaderRow[];
  /** Окремий повний топ закордонних міст — лише в режимі 'separate' (інакше undefined). */
  fullAbroad?: LeaderRow[];
  /** «Зібрано загалом» — гаманець стрімера за весь час (футер, OG-опис); НЕ скоупиться збором. */
  totalAllTimeUah: number;
  battle: BattleGap | null;
  tiles: PublicTiles;
  activeCollection: CollectionRow | null;
  /** Завершені збори (архів), новіші спершу — для списку «минулі збори». */
  pastCollections: PublicPastCollection[];
  /** [] якщо стрімер вимкнув показ або стрімів нема. */
  streams: StreamSummary[];
}

/** Рядок списку «минулі збори» на публічній головній. */
export interface PublicPastCollection {
  id: string;
  name: string;
  endAt: Date | null;
  raisedUah: number;
}

/** Повна архівна сторінка завершеного збору /<handle>/zbir/<id>. */
export interface PublicCollectionArchive {
  id: string;
  name: string;
  status: string;
  startAt: Date;
  endAt: Date | null;
  goalUah: number | null;
  raisedUah: number;
  donationCount: number;
  /** ПОВНИЙ топ усіх міст збору. */
  cities: LeaderRow[];
  streams: { id: string; name: string; startedAt: Date; url: string | null }[];
  profile: { name: string; handle: string };
}

/** «№2: ще X б до 1-го місця» — null, якщо міст < 2 або розрив нульовий. Без відмінків (правило §18). */
export function battleGap(rows: LeaderRow[]): BattleGap | null {
  // Локалі (а не rows[0]/rows[1]) — щоб TS звузив тип під noUncheckedIndexedAccess.
  const leader = rows[0];
  const challenger = rows[1];
  if (!leader || !challenger) return null;
  const diff = Math.round((leader.points - challenger.points) * 10) / 10;
  if (diff <= 0) return null;
  return { leader, challenger, diff };
}

/** Усі дані публічної сторінки одним викликом. Невідомий handle → null (сторінка віддає 404). */
export async function getPublicPage(db: PrismaClient, handle: string): Promise<PublicPageData | null> {
  const userId = await userIdByHandle(db, handle);
  if (!userId) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, handle: true, twitchUrl: true, youtubeUrl: true, telegramUrl: true, monobankJarUrl: true, publicShowStreams: true, showCommentPublic: true, abroadCities: true, abroadTopMode: true },
  });
  if (!user?.handle) return null;

  // Режим закордону (дзеркало getState): off → лише UA; shared → один рейтинг UA+світ;
  // separate → основний топ лише UA + окремий повний список закордонних. Рахуємо тут,
  // бо country-фільтр fullLeaderboard/fullAbroad потрібен ще до того, як getState поверне state.
  const abroadMode: 'off' | 'shared' | 'separate' = !user.abroadCities
    ? 'off'
    : user.abroadTopMode === 'shared'
      ? 'shared'
      : 'separate';

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Активний збір — рамка показу: топ/мапа/стрічка/суми панелей скоупляться ним (нема → весь час).
  const openCol = await db.collection.findFirst({ where: { userId, status: 'active' }, orderBy: { startAt: 'desc' } });
  const colId = openCol?.id;

  const [state, fullLeaderboard, fullAbroad, allTimeAgg, todayAgg, todayLeaderRows, streams, pastCols] = await Promise.all([
    getState(db, userId, {}, colId ? { collectionId: colId, audience: 'viewer' } : { audience: 'viewer' }),
    // Усі міста з балами, без обрізання.
    // shared → один список (UA+світ); off/separate → основний лише UA.
    leaderboard(db, userId, { limit: null, country: abroadMode === 'shared' ? undefined : 'ua', ...(colId ? { collectionId: colId } : {}) }),
    // Окремий повний топ закордонних міст — лише в режимі 'separate'.
    abroadMode === 'separate'
      ? leaderboard(db, userId, { limit: null, country: 'abroad', ...(colId ? { collectionId: colId } : {}) })
      : Promise.resolve(undefined),
    db.donation.aggregate({ where: { userId, outOfGame: false }, _sum: { amount: true } }),
    db.donation.aggregate({
      where: { userId, createdAt: { gte: startOfDay }, outOfGame: false },
      _sum: { amount: true },
      _max: { amount: true },
    }),
    leaderboard(db, userId, { from: startOfDay, limit: 1 }),
    getStreams(db, userId, 'date'),
    db.collection.findMany({
      where: { userId, status: 'completed' },
      orderBy: [{ endAt: 'desc' }, { startAt: 'desc' }],
      select: { id: true, name: true, endAt: true, seedUah: true },
    }),
  ]);
  const activeCollection = openCol ? await collectionSummary(db, userId, openCol) : null;

  // Зібрано по кожному завершеному збору — одним groupBy (без N+1).
  const pastIds = pastCols.map((c) => c.id);
  const pastSums = pastIds.length
    ? await db.donation.groupBy({
        by: ['collectionId'],
        where: { userId, collectionId: { in: pastIds }, outOfGame: false },
        _sum: { amount: true },
      })
    : [];
  const sumByCol = new Map(pastSums.map((s) => [s.collectionId, s._sum.amount?.toNumber() ?? 0]));
  const pastCollections: PublicPastCollection[] = pastCols.map((c) => ({
    id: c.id,
    name: c.name,
    endAt: c.endAt,
    // Показове «зібрано» = стартова сума + реальні донати (як на живому барі).
    raisedUah: (sumByCol.get(c.id) ?? 0) + c.seedUah.toNumber(),
  }));

  return {
    userId,
    profile: {
      name: user.name,
      handle: user.handle,
      twitchUrl: user.twitchUrl,
      youtubeUrl: user.youtubeUrl,
      telegramUrl: user.telegramUrl,
      monobankJarUrl: user.monobankJarUrl,
      publicShowStreams: user.publicShowStreams,
      showCommentPublic: user.showCommentPublic,
    },
    state,
    fullLeaderboard,
    fullAbroad,
    totalAllTimeUah: allTimeAgg._sum.amount?.toNumber() ?? 0,
    battle: battleGap(fullLeaderboard),
    tiles: {
      todayRaisedUah: todayAgg._sum.amount?.toNumber() ?? 0,
      todayLeader: todayLeaderRows[0]
        ? { name: todayLeaderRows[0].name, points: todayLeaderRows[0].points }
        : null,
      biggestTodayUah: todayAgg._max.amount?.toNumber() ?? 0,
    },
    activeCollection,
    pastCollections,
    streams: user.publicShowStreams ? streams : [],
  };
}

// TTL-кеш на handle (за зразком lib/globalMap): наплив глядачів = шторм router.refresh()
// після кожного донату, а композитор — ~10 запитів у БД. Кешуємо ПРОМІС, а не дані:
// одночасні запити (усі глядачі рефрешаться майже водночас) ділять ОДИН виклик БД.
// SSE-роут скидає кеш донатом стрімера (bustPublicPage) — глядачі бачать свіжий донат
// одразу; TTL страхує решту змін (адмінка/налаштування/збори). maxAgeMs:0 — обхід (тести).
const pageCache = new Map<string, { at: number; promise: Promise<PublicPageData | null> }>();

/** Скинути кеш публічної сторінки стрімера (SSE-роут кличе на кожен його донат). */
export function bustPublicPage(handle: string): void {
  pageCache.delete(handle);
}

export async function getPublicPageCached(
  db: PrismaClient,
  handle: string,
  opts: { maxAgeMs?: number } = {},
): Promise<PublicPageData | null> {
  const maxAge = opts.maxAgeMs ?? 10_000;
  const hit = pageCache.get(handle);
  if (hit && Date.now() - hit.at < maxAge) return hit.promise;
  const entry = { at: Date.now(), promise: getPublicPage(db, handle) };
  pageCache.set(handle, entry);
  entry.promise.then(
    (data) => {
      // null (невідомий handle) не кешуємо — скрапери випадкових URL не роздувають Map.
      if (data === null && pageCache.get(handle) === entry) pageCache.delete(handle);
    },
    () => {
      // Помилка не «отруює» кеш до кінця TTL — наступний запит перерахує.
      if (pageCache.get(handle) === entry) pageCache.delete(handle);
    },
  );
  return entry.promise;
}

/** Архівна сторінка збору /<handle>/zbir/<id>. Дані живцем із журналу — снапшоти не потрібні. */
export async function getPublicCollectionArchive(
  db: PrismaClient,
  handle: string,
  collectionId: string,
): Promise<PublicCollectionArchive | null> {
  const userId = await userIdByHandle(db, handle);
  if (!userId) return null;
  const c = await db.collection.findFirst({ where: { id: collectionId, userId } });
  if (!c) return null;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, handle: true } });
  const [agg, cities, streams] = await Promise.all([
    db.donation.aggregate({ where: { userId, collectionId: c.id, outOfGame: false }, _sum: { amount: true }, _count: true }),
    leaderboard(db, userId, { collectionId: c.id, limit: null }),
    db.stream.findMany({
      where: { userId, collectionId: c.id },
      select: { id: true, name: true, startedAt: true, url: true },
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    startAt: c.startAt,
    endAt: c.endAt,
    goalUah: c.goalUah?.toNumber() ?? null,
    // Показове «зібрано» = стартова сума + реальні донати; к-сть донатів лишається реальною.
    raisedUah: (agg._sum.amount?.toNumber() ?? 0) + c.seedUah.toNumber(),
    donationCount: agg._count,
    cities,
    streams,
    profile: { name: user.name, handle: user.handle ?? handle },
  };
}
