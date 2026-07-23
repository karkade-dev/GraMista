import type { PrismaClient } from '@prisma/client';
import { getStream } from './streams';
import { getCollection } from './collections';
import { mapPoints } from './map';
import { formatUahWhole, formatPoints, formatDate, formatDateTime, formatDuration } from './format';

// Єдине джерело типів картинки-звіту: data-шар format-agnostic, layout-компоненти лише малюють (DRY).
export type ReportFormat = 'landscape' | 'square' | 'vertical' | 'portrait';

export interface ReportTopCity {
  rank: number;
  name: string;
  /** Бали вже відформатовані (formatPoints) — layout не рахує. */
  points: string;
  /** Частка балів відносно топ-1 (0..1) — ширина смужки. */
  pct: number;
  /** Місто за кордоном (country !== 'UA') — мітка в списку; на мапу не йде. */
  abroad: boolean;
}

export interface ReportData {
  kind: 'stream' | 'collection';
  title: string;
  subtitle: string;
  /** Головне число картки — сума зібраного (герой композиції). Показуємо великим. */
  hero: { label: string; value: string };
  /** Два другорядні числа (без дублю суми/% — вони живуть у hero/goal). */
  stats: { label: string; value: string }[];
  /** До topN міст, відсортовано за балами (спадання). */
  top: ReportTopCity[];
  /** UA-точки цього стріму/збору (крапки на мапі). */
  map: { lat: number; lon: number; points: number }[];
  /** Топ UA-міста для підписів на мапі (координати+назви, за спаданням балів, до 10). Layout
   *  малює обрану стрімером кількість (HTML-підписи поверх — resvg не рендерить текст SVG). */
  mapLabels: { lat: number; lon: number; name: string }[];
  /** Прогрес цілі збору — лише коли ціль задана; pct фактичний (може >100), бар клампимо. */
  goal?: { raisedUah: number; goalUah: number; pct: number };
  /** Публічна сторінка стрімера для QR; null, якщо хендл не задано. */
  qr: { url: string } | null;
  /** true — жодного міста з балами (empty-state картки). */
  empty: boolean;
}

/**
 * Які з переданих settlementId — закордонні (country !== 'UA'). Спільний хелпер звіту стріму
 * й збору (DRY): мітка «за кордоном» у топ-списку; на мапу закордон і так не йде (mapPoints UA-only).
 */
async function abroadIdSet(db: PrismaClient, settlementIds: string[]): Promise<Set<string>> {
  if (settlementIds.length === 0) return new Set<string>();
  const rows = await db.settlement.findMany({
    where: { id: { in: settlementIds }, country: { not: 'UA' } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/** Топ UA-міста мапи (за спаданням балів) для підписів — з уже готових UA-точок (mapPoints). */
function topMapCities(
  points: { lat: number; lon: number; points: number; name: string }[],
  max = 10,
): ReportData['mapLabels'] {
  return [...points]
    .sort((a, b) => b.points - a.points)
    .slice(0, max)
    .map((p) => ({ lat: p.lat, lon: p.lon, name: p.name }));
}

/** Хендл стрімера для QR: абсолютний URL публічної сторінки, або null (нема хендла / базового URL). */
async function qrUrl(db: PrismaClient, userId: string): Promise<{ url: string } | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { handle: true } });
  const handle = user?.handle ?? null;
  // Без абсолютного APP_BASE_URL вийшов би відносний «/<handle>», нескановний з картинки — тоді без QR.
  const base = process.env.APP_BASE_URL?.trim();
  return handle && base ? { url: `${base}/${handle}` } : null;
}

/**
 * Дані звіту одного стріму (format-agnostic). null — стрім не знайдено або чужий.
 * Скоуп за userId наскрізь (мультитенант); закордонні міста лишаються в топ-списку з міткою,
 * але не на мапі (mapPoints і так UA-only).
 */
export async function buildStreamReportData(
  db: PrismaClient,
  userId: string,
  streamId: string,
  topN: 5 | 10,
): Promise<ReportData | null> {
  const got = await getStream(db, userId, streamId);
  if (!got) return null;
  const s = got.summary;

  const cities = s.cities.slice(0, topN);
  const maxPts = s.cities[0]?.points ?? 0;

  const abroadIds = await abroadIdSet(db, cities.map((c) => c.settlementId));
  const points = await mapPoints(db, userId, {}, { streamId });

  return {
    kind: 'stream',
    title: s.name,
    subtitle: `${formatDateTime(s.startedAt.getTime())} · ${formatDuration(s.durationMs)}`,
    hero: { label: 'зібрано за стрім', value: formatUahWhole(s.sumUah) },
    stats: [
      { label: 'донатів', value: String(s.donations) },
      { label: 'балів', value: formatPoints(s.points) },
    ],
    top: cities.map((c, i) => ({
      rank: i + 1,
      name: c.name,
      points: formatPoints(c.points),
      pct: maxPts > 0 ? c.points / maxPts : 0,
      abroad: abroadIds.has(c.settlementId),
    })),
    map: points.map((p) => ({ lat: p.lat, lon: p.lon, points: p.points })),
    mapLabels: topMapCities(points),
    qr: await qrUrl(db, userId),
    empty: s.cities.length === 0,
  };
}

/**
 * Дані звіту одного збору (format-agnostic). null — збір не знайдено або чужий.
 * Дзеркалить стрім-білдер, але з числами збору й прогрес-баром цілі: топ/мапа скоуплені
 * collectionId; «зібрано» = displayedUah (seed + донати); відсоток фактичний (може >100).
 */
export async function buildCollectionReportData(
  db: PrismaClient,
  userId: string,
  collectionId: string,
  topN: 5 | 10,
): Promise<ReportData | null> {
  const got = await getCollection(db, userId, collectionId);
  if (!got) return null;
  const c = got.collection;

  const cities = c.cities.slice(0, topN);
  const maxPts = c.cities[0]?.points ?? 0;
  const goalUah = c.goalUah;
  const hasGoal = goalUah != null && goalUah > 0;
  // Фактичний відсоток виконання (може >100 при перевиконанні) — бар клампимо, число показує факт.
  const pct = hasGoal ? Math.round((c.displayedUah / goalUah) * 100) : 0;

  const abroadIds = await abroadIdSet(db, cities.map((x) => x.settlementId));
  const points = await mapPoints(db, userId, {}, { collectionId });

  return {
    kind: 'collection',
    title: c.name,
    // Діапазон дат збору: «старт – кінець», або лише старт, якщо збір ще триває.
    subtitle: c.endAt
      ? `${formatDate(c.startAt.getTime())} – ${formatDate(c.endAt.getTime())}`
      : formatDate(c.startAt.getTime()),
    hero: { label: 'зібрано', value: formatUahWhole(c.displayedUah) },
    // Сума й % — у hero/goal, тож другорядні числа їх не дублюють: масштаб гри (міста) і стріми.
    stats: [
      { label: 'міст у грі', value: String(c.cities.length) },
      { label: 'стрімів', value: String(c.streamCount) },
    ],
    top: cities.map((x, i) => ({
      rank: i + 1,
      name: x.name,
      points: formatPoints(x.points),
      pct: maxPts > 0 ? x.points / maxPts : 0,
      abroad: abroadIds.has(x.settlementId),
    })),
    map: points.map((p) => ({ lat: p.lat, lon: p.lon, points: p.points })),
    mapLabels: topMapCities(points),
    goal: hasGoal ? { raisedUah: c.displayedUah, goalUah, pct } : undefined,
    qr: await qrUrl(db, userId),
    empty: c.cities.length === 0,
  };
}
