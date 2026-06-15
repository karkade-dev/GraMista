import type { PrismaClient } from '@prisma/client';
import { leaderboard, type LeaderRow } from './leaderboard';
import { streamSummary, type StreamSummary } from './streams';
import { collectionSummary, getActiveCollection } from './collections';
import { mapPoints, type MapPoint } from './map';
import { createdAtWhere, windowFor, type PeriodWindow } from './period';
import { anonymize } from './anonymize';
import { censorText, commentForDisplay, toCommentMode, type CommentSettings } from './censor';
import { cityOpeners, openerKey } from './newCity';

export interface RecentItem {
  externalId: string;
  who: string;
  amountUah: number;
  message: string;
  city: string | null;
  points: number;
  at: number;
  /** Збір, до якого зарахований донат (null — поза збором) — для дії «зарахувати в збір». */
  collectionId: string | null;
  /** Донат-відкривач: дав місту ПЕРШИЙ бал у межах збору (обчислюється з PointEvent). */
  newCity: boolean;
  /** Закордонне місто (country !== 'UA') — для мітки 🌍 у стрічці. */
  abroad: boolean;
}

/**
 * externalId найбільшого донату у стрічці (за сумою). При рівних сумах — новіший (більший at),
 * далі — детерміновано за externalId. null — порожня стрічка. Виділяємо лише серед ПОКАЗАНИХ у
 * стрічці донатів (що видно — те й позначаємо); чиста функція — щоб дашборд лишався тонким.
 */
export function biggestRecentId(recent: RecentItem[]): string | null {
  let best: RecentItem | null = null;
  for (const d of recent) {
    if (best === null || isBigger(d, best)) best = d;
  }
  return best?.externalId ?? null;
}

function isBigger(a: RecentItem, b: RecentItem): boolean {
  if (a.amountUah !== b.amountUah) return a.amountUah > b.amountUah;
  if (a.at !== b.at) return a.at > b.at;
  return a.externalId > b.externalId;
}

export interface DashboardState {
  activeStream: StreamSummary | null;
  /** «Гаманець» — сума ВСІХ донатів (з містом і без). Гроші рахуються завжди. */
  totalRaisedUah: number;
  /** Глобальний тумблер «битва міст»: коли false — нові донати лише гроші, без балів. */
  cityBattle: boolean;
  leaderboard: LeaderRow[];
  /** Окремий топ закордонних міст — лише в режимі 'separate' (інакше undefined). */
  leaderboardAbroad?: LeaderRow[];
  /** Режим закордону для рендеру списків: 'off' | 'shared' | 'separate'. */
  abroadMode: 'off' | 'shared' | 'separate';
  /** Чи показувати на мапі шар кордонів світу (керує стрімер через abroadWorldMap). */
  abroadWorldMap: boolean;
  recent: RecentItem[];
  map: MapPoint[];
}

export interface HeaderState {
  /** Активний стрім (назва + час старту + поточна тривалість) — для статусу й таймера. */
  activeStream: { name: string; startedAt: Date; durationMs: number } | null;
  /** Сума ВСІХ донатів за весь час (гаманець стрімера). */
  totalRaisedUah: number;
  /** Тумблер «битва міст». */
  cityBattle: boolean;
  /** Кількість донатів за весь час. */
  donationCount: number;
  /** Прогрес активного збору (найновішого зі status='active') — для плашки в шапці; null, якщо нема. goalUah null — збір без цілі. raisedUah/percent тут показові (з урахуванням стартової суми). */
  activeCollection: { name: string; raisedUah: number; goalUah: number | null; percent: number } | null;
  /**
   * Сума й к-сть донатів за кожен період — щоб шапка показувала те саме число, що й дашборд
   * (клієнтський компонент шапки читає `?period` з URL і обирає потрібне). `stream` — за активним
   * стрімом (null, якщо ефіру нема). `all` дублює totalRaisedUah/donationCount.
   */
  periodTotals: {
    all: PeriodTotal;
    week: PeriodTotal;
    month: PeriodTotal;
    stream: PeriodTotal | null;
    /** Сума/к-сть донатів активного збору (null, якщо активного збору нема). */
    collection: PeriodTotal | null;
  };
}

export interface PeriodTotal {
  sumUah: number;
  count: number;
}

export interface DashboardTiles {
  /** Сума донатів за сьогодні (від місцевої півночі). */
  todayRaisedUah: number;
  /** Місто-лідер серед сьогоднішніх балів; null, якщо балів сьогодні нема. */
  todayLeader: { name: string; points: number } | null;
  /** К-сть міст із балами (за весь час) — «активних міст». */
  activeCities: number;
  /** Сума/к-сть донатів активного стріму; null, якщо ефіру нема. */
  activeStream: { sumUah: number; donations: number } | null;
}

export interface CityDetail {
  settlementId: string;
  name: string;
  oblast: string | null;
  points: number;
  donations: number;
  raisedUah: number;
  /** Останні донати міста (анонімно). */
  recent: { who: string; amountUah: number; at: number; points: number }[];
  /** Топ-донатери міста за сумою (анонімно). */
  topDonors: { who: string; totalUah: number }[];
}

/**
 * Деталі одного міста (§17.1/§17.4: клік на місто → деталі): бали, к-сть/сума донатів,
 * останні донати й топ-донатери (ім'я анонімізоване назовні). window — опційний період.
 * null, якщо міста нема в довіднику.
 */
export async function cityDetail(
  db: PrismaClient,
  userId: string,
  settlementId: string,
  window: PeriodWindow = {},
  scope: { collectionId?: string } = {},
): Promise<CityDetail | null> {
  const s = await db.settlement.findUnique({
    where: { id: settlementId },
    select: { id: true, name: true, oblast: true },
  });
  if (!s) return null;

  const createdAt = createdAtWhere(window);
  const colScope = scope.collectionId ? { collectionId: scope.collectionId } : {};
  const donWhere = { userId, settlementId, ...colScope, ...(createdAt ? { createdAt } : {}) };
  const [agg, ptsAgg, recentRows, donorGroups] = await Promise.all([
    db.donation.aggregate({ where: donWhere, _sum: { amount: true }, _count: true }),
    db.pointEvent.aggregate({ where: { userId, settlementId, ...colScope, ...(createdAt ? { createdAt } : {}) }, _sum: { points: true } }),
    db.donation.findMany({ where: donWhere, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.donation.groupBy({
      by: ['donorName'],
      where: donWhere,
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    }),
  ]);

  return {
    settlementId: s.id,
    name: s.name,
    oblast: s.oblast,
    points: ptsAgg._sum.points?.toNumber() ?? 0,
    donations: agg._count,
    raisedUah: agg._sum.amount?.toNumber() ?? 0,
    recent: recentRows.map((d) => ({
      who: anonymize(d.donorName) || '(без імені)',
      amountUah: d.amount.toNumber(),
      at: d.createdAt.getTime(),
      points: d.pointsAwarded.toNumber(),
    })),
    topDonors: donorGroups.map((g) => ({
      who: anonymize(g.donorName) || '(без імені)',
      totalUah: g._sum.amount?.toNumber() ?? 0,
    })),
  };
}

/**
 * Дані для міні-плиток дашборду (§17.1): сьогодні зібрано · лідер дня · активних міст · за стрім.
 * Реюз leaderboard/mapPoints; «сьогодні» — від місцевої півночі now.
 */
export async function dashboardTiles(
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<DashboardTiles> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [open, activeCol] = await Promise.all([
    db.stream.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: 'desc' } }),
    getActiveCollection(db, userId),
  ]);
  const [today, leaderRows, mapPts, streamAgg] = await Promise.all([
    db.donation.aggregate({ where: { userId, createdAt: { gte: startOfDay } }, _sum: { amount: true } }),
    leaderboard(db, userId, { from: startOfDay, limit: 1 }),
    // «Активних міст» — у рамці поточного змагання (активний збір); нема збору → за весь час.
    mapPoints(db, userId, {}, activeCol ? { collectionId: activeCol.id } : {}),
    open
      ? db.donation.aggregate({ where: { userId, streamId: open.id }, _sum: { amount: true }, _count: true })
      : Promise.resolve(null),
  ]);

  return {
    todayRaisedUah: today._sum.amount?.toNumber() ?? 0,
    todayLeader: leaderRows[0] ? { name: leaderRows[0].name, points: leaderRows[0].points } : null,
    activeCities: mapPts.length,
    activeStream: streamAgg ? { sumUah: streamAgg._sum.amount?.toNumber() ?? 0, donations: streamAgg._count } : null,
  };
}

/** Сума + к-сть донатів за фільтром (для periodTotals у шапці). */
async function donationTotal(
  db: PrismaClient,
  userId: string,
  extra: { createdAt?: { gte?: Date; lt?: Date }; streamId?: string; collectionId?: string },
): Promise<PeriodTotal> {
  const a = await db.donation.aggregate({ where: { userId, ...extra }, _sum: { amount: true }, _count: true });
  return { sumUah: a._sum.amount?.toNumber() ?? 0, count: a._count };
}

/**
 * Легкий стан для спільної шапки (показується на ВСІХ вкладках): активний стрім,
 * загальна сума й кількість донатів — ЗА ВЕСЬ ЧАС (період керує лише вмістом дашборду,
 * не шапкою), тумблер «битва міст». Без важких агрегацій (топ/мапа/стрічка).
 */
export async function getHeader(db: PrismaClient, userId: string): Promise<HeaderState> {
  const open = await db.stream.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: 'desc' } });
  const weekW = createdAtWhere(windowFor('week'));
  const monthW = createdAtWhere(windowFor('month'));
  const openCol = await db.collection.findFirst({ where: { userId, status: 'active' }, orderBy: { startAt: 'desc' } });
  const [user, allT, weekT, monthT, streamT, collectionT] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { cityBattle: true } }),
    donationTotal(db, userId, {}),
    donationTotal(db, userId, weekW ? { createdAt: weekW } : {}),
    donationTotal(db, userId, monthW ? { createdAt: monthW } : {}),
    open ? donationTotal(db, userId, { streamId: open.id }) : Promise.resolve(null),
    openCol ? donationTotal(db, userId, { collectionId: openCol.id }) : Promise.resolve(null),
  ]);
  // Прогрес рахуємо через collectionSummary (єдине джерело: зібрано/відсоток із кепом 100).
  const cs = openCol ? await collectionSummary(db, userId, openCol) : null;
  return {
    activeStream: open
      ? { name: open.name, startedAt: open.startedAt, durationMs: Date.now() - open.startedAt.getTime() }
      : null,
    totalRaisedUah: allT.sumUah,
    cityBattle: user?.cityBattle ?? true,
    donationCount: allT.count,
    // Плашка показує «накопичено» з урахуванням стартової суми (displayed); periodTotals.collection нижче лишається реальним.
    activeCollection: cs ? { name: cs.name, raisedUah: cs.displayedUah, goalUah: cs.goalUah, percent: cs.displayedPercent } : null,
    periodTotals: { all: allT, week: weekT, month: monthT, stream: streamT, collection: collectionT },
  };
}

/**
 * Зведений стан для панелі: активний стрім, загальна сума, топ-20, стрічка донатів (анонімно), точки мапи.
 * window — період (Тиждень/Місяць/Весь час): впливає на суму, топ, стрічку й мапу.
 * opts.streamId — скоуп «поточний стрім»: фільтрує донати/бали за стрімом (точніше, ніж час)
 *   замість часового вікна. Активний стрім у відповіді завжди поточний (не залежить від скоупу).
 */
export async function getState(
  db: PrismaClient,
  userId: string,
  window: PeriodWindow = {},
  opts: { streamId?: string; collectionId?: string; audience?: 'admin' | 'viewer' } = {},
): Promise<DashboardState> {
  const open = await db.stream.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: 'desc' } });
  const activeStream = open ? await streamSummary(db, userId, open) : null;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { cityBattle: true, commentMode: true, bannedWordsAdded: true, bannedWordsAllowed: true, abroadCities: true, abroadWorldMap: true, abroadTopMode: true },
  });
  const cityBattle = user?.cityBattle ?? true;
  const abroadCities = user?.abroadCities ?? false;
  const abroadWorldMap = user?.abroadWorldMap ?? false;
  const abroadMode: 'off' | 'shared' | 'separate' = !abroadCities
    ? 'off'
    : user?.abroadTopMode === 'shared'
      ? 'shared'
      : 'separate';
  // Коментар чиститься ТУТ (єдине місце) — на клієнти (оверлеї/публічна/панель) сирий мат
  // не потрапляє. Адмінська історія /donations — окремий шлях (lib/donations), лишається сирою.
  const comments: CommentSettings = {
    mode: toCommentMode(user?.commentMode),
    added: user?.bannedWordsAdded ?? '',
    allowed: user?.bannedWordsAllowed ?? '',
  };

  const createdAt = createdAtWhere(window);
  // Скоуп донатів/балів: за стрімом, за активним збором (точні фільтри) АБО за часовим вікном.
  const donWhere = opts.streamId
    ? { userId, streamId: opts.streamId }
    : opts.collectionId
      ? { userId, collectionId: opts.collectionId }
      : { userId, ...(createdAt ? { createdAt } : {}) };

  const totals = await db.donation.aggregate({ where: donWhere, _sum: { amount: true } });
  const totalRaisedUah = totals._sum.amount?.toNumber() ?? 0;

  const baseLb = opts.streamId
    ? { streamIds: [opts.streamId] }
    : opts.collectionId
      ? { collectionId: opts.collectionId }
      : { ...window };
  // shared → один рейтинг (UA+світ); off/separate → основний лише UA, окремий список — лише в separate.
  const lb = await leaderboard(db, userId, { ...baseLb, limit: 20, country: abroadMode === 'shared' ? undefined : 'ua' });
  const leaderboardAbroad = abroadMode === 'separate'
    ? await leaderboard(db, userId, { ...baseLb, limit: 20, country: 'abroad' })
    : undefined;

  const rows = await db.donation.findMany({
    where: donWhere,
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { settlement: { select: { name: true, country: true } } },
  });
  const openers = await cityOpeners(
    db,
    userId,
    rows
      .filter((d) => d.settlementId !== null)
      .map((d) => ({ settlementId: d.settlementId!, collectionId: d.collectionId })),
  );
  // Дашборд (audience 'admin') — приватний робочий екран стрімера: коментар видно ЗАВЖДИ,
  // лише з маскуванням мату. Глядацькі режими city/hide ховають коментар від ГЛЯДАЧІВ, а не
  // від стрімера — інакше він не бачив би, що пишуть, і не міг призначити місто, якого не вгадали.
  const adminView = opts.audience === 'admin';
  const recent: RecentItem[] = rows.map((d) => ({
    externalId: d.externalId,
    who: anonymize(d.donorName) || '(без імені)',
    amountUah: d.amount.toNumber(),
    message: adminView
      ? censorText(d.message, { mode: 'mask', added: comments.added, allowed: comments.allowed }).trim()
      : commentForDisplay(d.message, d.settlement?.name ?? null, comments),
    city: d.settlement?.name ?? null,
    points: d.pointsAwarded.toNumber(),
    at: d.createdAt.getTime(),
    collectionId: d.collectionId,
    newCity: d.settlementId !== null && openers.get(openerKey(d.settlementId, d.collectionId)) === d.id,
    abroad: d.settlement != null && d.settlement.country !== 'UA',
  }));

  const map = await mapPoints(db, userId, window, {
    streamId: opts.streamId,
    collectionId: opts.collectionId,
    includeAbroad: abroadWorldMap,
  });

  return { activeStream, totalRaisedUah, cityBattle, leaderboard: lb, leaderboardAbroad, abroadMode, abroadWorldMap, recent, map };
}
