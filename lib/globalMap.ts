import type { PrismaClient } from '@prisma/client';
import type { MapPoint } from './map';
import { collectionSummary, type CollectionRow } from './collections';
import { anonymize } from './anonymize';

// Композитор глобальної мапи /ukraine: агрегує донати ВСІХ учасників (showOnGlobalMap=true)
// у гривнях. Лише публічні дані за побудовою — без email/ролей/повних імен/текстів повідомлень
// (анонімізація — реюз lib/anonymize). Бізнес-логіки не дублює, лише складає наявні запити.
// Спека: docs/specs/2026-06-10-global-map.md.

export type GlobalWindow = 'all' | 'month' | 'week';

export interface GlobalTopRow { settlementId: string; name: string; sumUah: number }
export interface GlobalFeedItem { externalId: string; who: string; city: string; amountUah: number; at: number }
export interface GlobalParticipant { name: string; handle: string; totalUah: number; lastDonationAt: number | null }
export interface GlobalLiveNow { streamName: string; url: string | null; streamer: { name: string; handle: string } }
export interface GlobalFeatured extends CollectionRow {
  streamer: { name: string; handle: string; monobankJarUrl: string | null };
}
export interface GlobalCityDetail {
  settlementId: string; name: string; oblast: string | null; totalUah: number;
  byStreamer: { name: string; handle: string; sumUah: number }[];
  recent: { who: string; amountUah: number; at: number }[];
}
export interface GlobalMapData {
  totalUah: number;            // ВСІ донати учасників (вкл. нерозпізнані)
  litCount: number;            // міст «запалено» (хоч один розпізнаний донат, незалежно від координат)
  settlementsTotal: number;    // усього НП у довіднику (29 242)
  litCities: MapPoint[];       // points = сума ₴ (керує розміром/кольором крапки); лише з координатами
  top: GlobalTopRow[];         // за вікном opts.window
  feed: GlobalFeedItem[];      // останні 12, лише розпізнані
  participants: GlobalParticipant[]; // лише з handle і сумою > 0; сортування за сумою desc
  liveNow: GlobalLiveNow[];
  featured: GlobalFeatured | null;
}

// Фільтр «учасник мапи» — застосовується скрізь через relation-фільтр donation.user / stream.user.
// hiddenFromGlobalMap: false — модерація адміном (прихований стрімер зникає з усіх зрізів).
const PARTICIPANT = { showOnGlobalMap: true, hiddenFromGlobalMap: false } as const;
const TOP_LIMIT = 30;
// Поріг показу стрімера в панелі «Учасники»: лише ті, хто зібрав щонайменше стільки ₴
// (дрібні/нульові не засмічують панель). Мапи/топу міст НЕ стосується.
const PARTICIPANT_MIN_UAH = 1000;
const DAY = 86_400_000;

function windowGte(window: GlobalWindow): Date | null {
  if (window === 'month') return new Date(Date.now() - 30 * DAY);
  if (window === 'week') return new Date(Date.now() - 7 * DAY);
  return null; // all
}

async function build(db: PrismaClient, window: GlobalWindow): Promise<GlobalMapData> {
  const gte = windowGte(window);

  const [totalAgg, recAll, recWin, settlementsTotal, feedRows, users, donAgg, liveRows, setting] = await Promise.all([
    db.donation.aggregate({ where: { user: PARTICIPANT, outOfGame: false }, _sum: { amount: true } }),
    db.donation.groupBy({ by: ['settlementId'], where: { status: 'recognized', settlementId: { not: null }, user: PARTICIPANT, outOfGame: false, settlement: { is: { country: 'UA' } } }, _sum: { amount: true } }),
    gte
      ? db.donation.groupBy({ by: ['settlementId'], where: { status: 'recognized', settlementId: { not: null }, user: PARTICIPANT, outOfGame: false, createdAt: { gte }, settlement: { is: { country: 'UA' } } }, _sum: { amount: true } })
      : null,
    db.settlement.count({ where: { country: 'UA' } }),
    db.donation.findMany({ where: { status: 'recognized', user: PARTICIPANT, outOfGame: false, settlement: { is: { country: 'UA' } } }, orderBy: { createdAt: 'desc' }, take: 12, select: { externalId: true, donorName: true, amount: true, createdAt: true, settlement: { select: { name: true } } } }),
    db.user.findMany({ where: { showOnGlobalMap: true, hiddenFromGlobalMap: false, handle: { not: null } }, select: { id: true, name: true, handle: true } }),
    db.donation.groupBy({ by: ['userId'], where: { user: PARTICIPANT, outOfGame: false }, _sum: { amount: true }, _max: { createdAt: true } }),
    db.stream.findMany({ where: { endedAt: null, user: { showOnGlobalMap: true, hiddenFromGlobalMap: false, handle: { not: null } } }, select: { name: true, url: true, user: { select: { name: true, handle: true } } } }),
    db.appSetting.findUnique({ where: { id: 'app' }, include: { featuredCollection: { include: { user: true } } } }),
  ]);

  const winGroups = recWin ?? recAll;

  // Назви/координати для всіх задіяних НП — одним запитом.
  const ids = [...new Set([...recAll, ...winGroups].map((g) => g.settlementId).filter((x): x is string => x != null))];
  const settlements = ids.length
    ? await db.settlement.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, lat: true, lon: true } })
    : [];
  const meta = new Map(settlements.map((s) => [s.id, s]));

  const litCities: MapPoint[] = [];
  for (const g of recAll) {
    const s = g.settlementId ? meta.get(g.settlementId) : undefined;
    if (!s || s.lat == null || s.lon == null) continue; // без координат — у лічильнику є, на мапі нема
    litCities.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, points: g._sum.amount?.toNumber() ?? 0, abroad: false });
  }

  const top: GlobalTopRow[] = winGroups
    .map((g) => ({ settlementId: g.settlementId as string, name: (g.settlementId ? meta.get(g.settlementId)?.name : '') ?? '', sumUah: g._sum.amount?.toNumber() ?? 0 }))
    .filter((r) => r.sumUah > 0 && r.settlementId)
    .sort((a, b) => b.sumUah - a.sumUah)
    .slice(0, TOP_LIMIT);

  const feed: GlobalFeedItem[] = feedRows.map((r) => ({
    externalId: r.externalId,
    who: anonymize(r.donorName),
    city: r.settlement?.name ?? '',
    amountUah: r.amount.toNumber(),
    at: r.createdAt.getTime(),
  }));

  const aggByUser = new Map(donAgg.map((g) => [g.userId, g]));
  const participants: GlobalParticipant[] = users
    .map((u) => {
      const a = aggByUser.get(u.id);
      return { name: u.name, handle: u.handle as string, totalUah: a?._sum.amount?.toNumber() ?? 0, lastDonationAt: a?._max.createdAt?.getTime() ?? null };
    })
    // Показуємо лише тих, хто зібрав ≥ порога (дрібні/нульові не засмічують панель); сортуємо
    // за сумою, тай-брейк — свіжість донату. Кількість для показу обмежує UI (топ-N + «ще N»).
    .filter((p) => p.totalUah >= PARTICIPANT_MIN_UAH)
    .sort((x, y) => y.totalUah - x.totalUah || (y.lastDonationAt ?? 0) - (x.lastDonationAt ?? 0));

  const liveNow: GlobalLiveNow[] = liveRows.map((s) => ({
    streamName: s.name,
    url: s.url,
    streamer: { name: s.user.name, handle: s.user.handle as string },
  }));

  let featured: GlobalFeatured | null = null;
  const col = setting?.featuredCollection;
  if (col && col.status === 'active' && col.user.showOnGlobalMap && !col.user.hiddenFromGlobalMap && col.user.handle) {
    const summary = await collectionSummary(db, col.userId, col);
    featured = { ...summary, streamer: { name: col.user.name, handle: col.user.handle, monobankJarUrl: col.user.monobankJarUrl } };
  }

  return {
    totalUah: totalAgg._sum.amount?.toNumber() ?? 0,
    litCount: recAll.length,
    settlementsTotal,
    litCities,
    top,
    feed,
    participants,
    liveNow,
    featured,
  };
}

// TTL-кеш на вікно: /ukraine — найвідвідуваніша сторінка, а router.refresh() від SSE не повинен
// довбати агрегати на кожен донат. maxAgeMs:0 — обхід кешу (тести/OG/перший рендер за потреби).
const cache = new Map<GlobalWindow, { at: number; data: GlobalMapData }>();

export async function getGlobalMap(
  db: PrismaClient,
  opts: { window?: GlobalWindow; maxAgeMs?: number } = {},
): Promise<GlobalMapData> {
  const win = opts.window ?? 'all';
  const maxAge = opts.maxAgeMs ?? 15_000;
  const hit = cache.get(win);
  if (hit && Date.now() - hit.at < maxAge) return hit.data;
  const data = await build(db, win);
  cache.set(win, { at: Date.now(), data });
  return data;
}

// Картка міста: розбивка ₴ по стрімерах (з лінками на /<handle>) + 5 останніх донатів,
// анонімно й без текстів. Без кешу — відкривається рідко. null, якщо місто нема в довіднику
// або жоден учасник за нього не донатив (не світиться — нема картки).
export async function globalCityDetail(db: PrismaClient, settlementId: string): Promise<GlobalCityDetail | null> {
  const s = await db.settlement.findUnique({ where: { id: settlementId }, select: { id: true, name: true, oblast: true } });
  if (!s) return null;

  const [totalAgg, byUser, recentRows] = await Promise.all([
    db.donation.aggregate({ where: { settlementId, status: 'recognized', user: PARTICIPANT, outOfGame: false, settlement: { is: { country: 'UA' } } }, _sum: { amount: true } }),
    db.donation.groupBy({ by: ['userId'], where: { settlementId, status: 'recognized', user: PARTICIPANT, outOfGame: false, settlement: { is: { country: 'UA' } } }, _sum: { amount: true } }),
    db.donation.findMany({ where: { settlementId, status: 'recognized', user: PARTICIPANT, outOfGame: false, settlement: { is: { country: 'UA' } } }, orderBy: { createdAt: 'desc' }, take: 5, select: { donorName: true, amount: true, createdAt: true } }),
  ]);
  if (byUser.length === 0) return null;

  const linkUsers = await db.user.findMany({ where: { id: { in: byUser.map((g) => g.userId) }, handle: { not: null } }, select: { id: true, name: true, handle: true } });
  const umeta = new Map(linkUsers.map((u) => [u.id, u]));
  const byStreamer = byUser
    .map((g) => {
      const u = umeta.get(g.userId);
      return u ? { name: u.name, handle: u.handle as string, sumUah: g._sum.amount?.toNumber() ?? 0 } : null;
    })
    .filter((x): x is { name: string; handle: string; sumUah: number } => x != null)
    .sort((a, b) => b.sumUah - a.sumUah);

  return {
    settlementId: s.id,
    name: s.name,
    oblast: s.oblast,
    totalUah: totalAgg._sum.amount?.toNumber() ?? 0,
    byStreamer,
    recent: recentRows.map((r) => ({ who: anonymize(r.donorName), amountUah: r.amount.toNumber(), at: r.createdAt.getTime() })),
  };
}
