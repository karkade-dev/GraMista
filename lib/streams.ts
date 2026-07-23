import type { PrismaClient, Stream } from '@prisma/client';
import { leaderboard, type LeaderRow } from './leaderboard';
import { windowFor, type Range } from './period';
import { formatUah, formatPoints, formatDateTime } from './format';

export type { Range };

export interface StreamRow {
  id: string;
  name: string;
  /** Посилання на VOD/трансляцію (Twitch/YouTube); null, якщо не задано. */
  url: string | null;
  /** Приватні нотатки оператора; null, якщо не задано. */
  notes: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

export interface StreamSummary extends StreamRow {
  durationMs: number;
  sumUah: number;
  donations: number;
  points: number;
  /** Топ-3 — чипи в списку стрімів і картинка-банер. Зріз cities. */
  topCities: LeaderRow[];
  /** Повний список міст стріму з балами (без обмеження) — звіт-пост і drill-down. */
  cities: LeaderRow[];
}

function toRow(s: Stream): StreamRow {
  return { id: s.id, name: s.name, url: s.url, notes: s.notes, startedAt: s.startedAt, endedAt: s.endedAt };
}

/** Текст звіту-посту по стріму (для копіювання й публікації) — §17.3. */
export function streamReportText(s: StreamSummary): string {
  const lines = [
    `🎬 ${s.name}`,
    `📅 ${formatDateTime(s.startedAt.getTime())}`,
    `💰 Зібрано ${formatUah(s.sumUah)} · ${s.donations} донат.`,
    `🏙️ Балів містам: ${formatPoints(s.points)}`,
  ];
  if (s.cities.length > 0) {
    lines.push('🏆 Міста стріму:');
    for (const [i, c] of s.cities.entries()) lines.push(`${i + 1}. ${c.name} — ${formatPoints(c.points)}`);
  }
  if (s.url) lines.push(`▶ ${s.url}`);
  return lines.join('\n');
}

export interface ComparisonBar {
  id: string;
  name: string;
  sumUah: number;
  points: number;
  /** Ширина смужки суми, 0..100 (відносно найбільшої суми в наборі). */
  sumPct: number;
  /** Ширина смужки балів, 0..100 (відносно найбільших балів у наборі). */
  pointsPct: number;
}

/**
 * Дані для графіка порівняння стрімів (§17.3): нормалізує суму й бали кожного стріму до
 * максимуму в наборі → відсотки для CSS-смужок. Чиста функція; нульовий максимум → 0% (без /0).
 */
export function streamComparison(
  streams: { id: string; name: string; sumUah: number; points: number }[],
): ComparisonBar[] {
  const maxSum = Math.max(0, ...streams.map((s) => s.sumUah));
  const maxPts = Math.max(0, ...streams.map((s) => s.points));
  return streams.map((s) => ({
    id: s.id,
    name: s.name,
    sumUah: s.sumUah,
    points: s.points,
    sumPct: maxSum > 0 ? (s.sumUah / maxSum) * 100 : 0,
    pointsPct: maxPts > 0 ? (s.points / maxPts) * 100 : 0,
  }));
}

/** Підсумок одного стріму: тривалість, сума, кількість донатів, бали, всі міста з балами. */
export async function streamSummary(db: PrismaClient, userId: string, s: StreamRow): Promise<StreamSummary> {
  const don = await db.donation.aggregate({ where: { userId, streamId: s.id, outOfGame: false }, _sum: { amount: true }, _count: true });
  const pts = await db.pointEvent.aggregate({ where: { userId, streamId: s.id }, _sum: { points: true } });
  const cities = await leaderboard(db, userId, { streamIds: [s.id], limit: null });
  return {
    ...s,
    durationMs: (s.endedAt ?? new Date()).getTime() - s.startedAt.getTime(),
    sumUah: don._sum.amount?.toNumber() ?? 0,
    donations: don._count,
    points: pts._sum.points?.toNumber() ?? 0,
    topCities: cities.slice(0, 3),
    cities,
  };
}

/** Старт стріму: закриває будь-який відкритий (інваріант — один активний), створює новий. */
export async function startStream(db: PrismaClient, userId: string, name: string): Promise<StreamRow> {
  await db.stream.updateMany({ where: { userId, endedAt: null }, data: { endedAt: new Date() } });
  const count = await db.stream.count({ where: { userId } });
  const s = await db.stream.create({
    data: { userId, name: name.trim() || `Стрім ${count + 1}`, startedAt: new Date() },
  });
  return toRow(s);
}

/** Стоп активного стріму (відкритий = endedAt IS NULL). */
export async function stopStream(db: PrismaClient, userId: string): Promise<StreamRow | null> {
  const open = await db.stream.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: 'desc' } });
  if (!open) return null;
  const s = await db.stream.update({ where: { id: open.id }, data: { endedAt: new Date() } });
  return toRow(s);
}

/**
 * Редагування: назва і/або час початку/кінця, і/або прив'язка до збору.
 * Кінець не може бути раніше початку. collectionId: рядок — прив'язати, null — відв'язати,
 * undefined — не чіпати.
 */
export async function updateStream(
  db: PrismaClient,
  userId: string,
  id: string,
  patch: {
    name?: string;
    url?: string | null;
    notes?: string | null;
    startedAt?: Date;
    endedAt?: Date | null;
    collectionId?: string | null;
  },
): Promise<StreamSummary | null> {
  const s = await db.stream.findFirst({ where: { id, userId } });
  if (!s) return null;

  const name = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : s.name;
  const startedAt = patch.startedAt ?? s.startedAt;
  let endedAt: Date | null;
  if (patch.endedAt === null) endedAt = null;
  else if (patch.endedAt) endedAt = patch.endedAt;
  else endedAt = s.endedAt;
  if (endedAt != null && endedAt < startedAt) endedAt = startedAt;

  const updated = await db.stream.update({
    where: { id: s.id },
    data: {
      name,
      startedAt,
      endedAt,
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.collectionId !== undefined ? { collectionId: patch.collectionId } : {}),
    },
  });
  return streamSummary(db, userId, toRow(updated));
}

/**
 * Видалення стріму: донати/бали лишаються (у часових топах), але відв'язуються від
 * стріму — FK onDelete: SetNull робить це автоматично. Атомарно одним запитом.
 */
export async function deleteStream(db: PrismaClient, userId: string, id: string): Promise<boolean> {
  const r = await db.stream.deleteMany({ where: { id, userId } });
  return r.count > 0;
}

/**
 * Перенести донат в інший стрім (або «без стріму», streamId=null). Атомарно переміщує
 * прив'язку донату ТА його балів (PointEvent.streamId) — щоб бали поїхали разом у топах стрімів.
 * Бали НЕ перераховуються (та сама сума, інша приналежність). Скарбничка глобальна — не чіпаємо.
 * false, якщо донату нема або цільовий стрім чужий/неіснуючий.
 */
export async function moveDonationToStream(
  db: PrismaClient,
  userId: string,
  externalId: string,
  streamId: string | null,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const d = await tx.donation.findUnique({
      where: { userId_externalId: { userId, externalId } },
      select: { id: true },
    });
    if (!d) return false;
    if (streamId) {
      const s = await tx.stream.findFirst({ where: { id: streamId, userId }, select: { id: true } });
      if (!s) return false;
    }
    await tx.donation.update({ where: { id: d.id }, data: { streamId } });
    await tx.pointEvent.updateMany({ where: { userId, donationId: d.id }, data: { streamId } });
    return true;
  });
}

/** Усі стріми з підсумками, сортування sum | points | date (спадання). */
export async function getStreams(
  db: PrismaClient,
  userId: string,
  sort: 'sum' | 'points' | 'date' = 'date',
): Promise<StreamSummary[]> {
  const streams = await db.stream.findMany({ where: { userId } });
  const out = await Promise.all(streams.map((s) => streamSummary(db, userId, toRow(s))));
  out.sort((a, b) =>
    sort === 'sum'
      ? b.sumUah - a.sumUah
      : sort === 'points'
        ? b.points - a.points
        : b.startedAt.getTime() - a.startedAt.getTime(),
  );
  return out;
}

/** Drill-down: підсумок стріму + топ міст усередині нього (той самий список, що в summary.cities). */
export async function getStream(
  db: PrismaClient,
  userId: string,
  id: string,
): Promise<{ summary: StreamSummary; cities: LeaderRow[] } | null> {
  const s = await db.stream.findFirst({ where: { id, userId } });
  if (!s) return null;
  const summary = await streamSummary(db, userId, toRow(s));
  return { summary, cities: summary.cities };
}

/** Комбо: об'єднаний топ + сума по кількох стрімах. */
export async function getCombined(
  db: PrismaClient,
  userId: string,
  ids: string[],
  asc = false,
): Promise<{ streams: StreamSummary[]; leaderboard: LeaderRow[]; sumUah: number }> {
  const streams = await db.stream.findMany({ where: { userId, id: { in: ids } } });
  const summaries = await Promise.all(streams.map((s) => streamSummary(db, userId, toRow(s))));
  const lb = await leaderboard(db, userId, { streamIds: ids, limit: null, asc });
  const sum = await db.donation.aggregate({ where: { userId, streamId: { in: ids }, outOfGame: false }, _sum: { amount: true } });
  return { streams: summaries, leaderboard: lb, sumUah: sum._sum.amount?.toNumber() ?? 0 };
}

/** Топ за період (тиждень/місяць/весь час) + стріми цього періоду (для drill-down). */
export async function getPeriod(
  db: PrismaClient,
  userId: string,
  range: Range,
  asc = false,
  now: Date = new Date(),
): Promise<{ range: Range; leaderboard: LeaderRow[]; streams: StreamSummary[] }> {
  const w = windowFor(range, now);
  const streams = await db.stream.findMany({
    where: { userId, startedAt: { ...(w.from ? { gte: w.from } : {}), ...(w.to ? { lt: w.to } : {}) } },
    orderBy: { startedAt: 'desc' },
  });
  const summaries = await Promise.all(streams.map((s) => streamSummary(db, userId, toRow(s))));
  const lb = await leaderboard(db, userId, { from: w.from, to: w.to, asc, limit: 100 });
  return { range, leaderboard: lb, streams: summaries };
}
