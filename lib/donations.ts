import { Prisma, type PrismaClient, type DonationStatus } from '@prisma/client';
import { z } from 'zod';
import { formatDateTime } from './format';
import { windowFor, createdAtWhere, type Range } from './period';
import { cityOpeners, openerKey } from './newCity';

// Повна історія донатів (§17.2): keyset-пагінація (30/стор., без штучного ліміту),
// пошук за донатером, фільтр діапазону суми, статус; експорт у CSV.
// Логіка журналу/балів — не тут; це лише читання донатів для вкладки «Донати».

export const DONATIONS_PER_PAGE = 30;

export interface DonationRow {
  externalId: string;
  /**
   * ПОВНЕ ім'я донатера — це приватна панель стрімера (за логіном, власні донати),
   * як і док /dock. Анонімізація («Ім'я П.») — лише назовні (публічна, /ukraine, оверлеї).
   * Показ = те, за чим шукаємо (buildWhere по donorName+message), інакше пошук за видимим ім'ям мовчить.
   */
  who: string;
  amountUah: number;
  message: string;
  city: string | null;
  /** id розпізнаного міста (для навчання синоніму кліком по коментарю); null — нерозпізнано. */
  settlementId: string | null;
  status: DonationStatus;
  points: number;
  /** createdAt у мс. */
  at: number;
  /** Стрім, до якого прив'язаний донат (для перенесення); null — без стріму. */
  streamId: string | null;
  /** Донат поза грою (балів не дає, схований від глядачів). */
  outOfGame: boolean;
}

/** Статус для фільтра (§17.2): розпізнано (з балами) / скарбничка (місто є, балів ще 0) / нерозпізнано. */
export type DonationStatusFilter = 'recognized' | 'pocket' | 'unrecognized';

export interface DonationFilter {
  /** Пошук за іменем донатера (підрядок, регістронезалежно). */
  search?: string;
  minUah?: number;
  maxUah?: number;
  status?: DonationStatusFilter;
  /** Місто (settlementId). */
  settlementId?: string;
  /** Стрім (streamId). */
  streamId?: string;
  /** Період (тиждень/місяць/весь час) — фільтр за createdAt. */
  range?: Range;
  /** Нижня межа createdAt (включно) — для періоду «сьогодні» доку. Має пріоритет над range. */
  since?: Date;
}

/** Поле сортування: дата (createdAt) або сума (amount). */
export type DonationSort = 'date' | 'amount';
/** Напрямок сортування, обраний користувачем. */
export type DonationSortDir = 'asc' | 'desc';

/**
 * Курсор keyset-пагінації — стабільна пара (значення поля сортування, id).
 * val — timestamp(мс) при сортуванні за датою або сума при сортуванні за сумою; id — tiebreak.
 */
export interface DonationCursor {
  val: number;
  id: string;
}

export interface DonationPage {
  rows: DonationRow[];
  /** Курсор для «Далі →» (старіші донати), або null якщо це остання сторінка. */
  nextCursor: DonationCursor | null;
  /** Курсор для «← Назад» (новіші донати), або null якщо це перша сторінка. */
  prevCursor: DonationCursor | null;
}

type DonationRecord = Prisma.DonationGetPayload<{ include: { settlement: { select: { name: true } } } }>;

function buildWhere(userId: string, f: DonationFilter): Prisma.DonationWhereInput {
  const where: Prisma.DonationWhereInput = { userId };
  const search = f.search?.trim();
  // Одне поле пошуку покриває і донатера, і фразу з коментаря. OR тут безпечний:
  // із курсорною умовою buildWhere комбінується через AND: [base, beyond(...)].
  if (search) {
    where.OR = [
      { donorName: { contains: search, mode: 'insensitive' } },
      { message: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (f.minUah != null || f.maxUah != null) {
    where.amount = {
      ...(f.minUah != null ? { gte: f.minUah } : {}),
      ...(f.maxUah != null ? { lte: f.maxUah } : {}),
    };
  }
  // Статус: розпізнано = є бали; скарбничка = місто є, але балів ще 0; нерозпізнано = без міста.
  if (f.status === 'recognized') {
    where.status = 'recognized';
    where.pointsAwarded = { gt: 0 };
  } else if (f.status === 'pocket') {
    where.status = 'recognized';
    where.pointsAwarded = 0;
  } else if (f.status === 'unrecognized') {
    where.status = 'unrecognized';
  }
  if (f.settlementId) where.settlementId = f.settlementId;
  if (f.streamId) where.streamId = f.streamId;
  if (f.since) {
    where.createdAt = { gte: f.since };
  } else if (f.range && f.range !== 'all') {
    const w = createdAtWhere(windowFor(f.range));
    if (w) where.createdAt = w;
  }
  return where;
}

// Рядки строго «далі» за курсором у напрямку op (lt — менше значення поля, gt — більше).
// Tiebreak за id у тому ж напрямку — стабільний keyset для будь-якого поля сортування.
function beyond(sort: DonationSort, c: DonationCursor, op: 'lt' | 'gt'): Prisma.DonationWhereInput {
  const idCmp = op === 'lt' ? { lt: c.id } : { gt: c.id };
  if (sort === 'amount') {
    const cmp = op === 'lt' ? { lt: c.val } : { gt: c.val };
    return { OR: [{ amount: cmp }, { amount: c.val, id: idCmp }] };
  }
  const at = new Date(c.val);
  const cmp = op === 'lt' ? { lt: at } : { gt: at };
  return { OR: [{ createdAt: cmp }, { createdAt: at, id: idCmp }] };
}

function orderByFor(sort: DonationSort, dir: DonationSortDir): Prisma.DonationOrderByWithRelationInput[] {
  return sort === 'amount' ? [{ amount: dir }, { id: dir }] : [{ createdAt: dir }, { id: dir }];
}

function cursorOf(sort: DonationSort, d: DonationRecord): DonationCursor {
  return { val: sort === 'amount' ? d.amount.toNumber() : d.createdAt.getTime(), id: d.id };
}

// op руху УПЕРЕД (наступна сторінка) у display-порядку: desc → менші (lt), asc → більші (gt).
const fwdOp = (dir: DonationSortDir): 'lt' | 'gt' => (dir === 'desc' ? 'lt' : 'gt');
// op руху НАЗАД (попередня сторінка) — протилежний.
const bwdOp = (dir: DonationSortDir): 'lt' | 'gt' => (dir === 'desc' ? 'gt' : 'lt');
const flip = (dir: DonationSortDir): DonationSortDir => (dir === 'desc' ? 'asc' : 'desc');

function toRow(d: DonationRecord): DonationRow {
  return {
    externalId: d.externalId,
    who: d.donorName || '(без імені)',
    amountUah: d.amount.toNumber(),
    message: d.message,
    city: d.settlement?.name ?? null,
    settlementId: d.settlementId,
    status: d.status,
    points: d.pointsAwarded.toNumber(),
    at: d.createdAt.getTime(),
    streamId: d.streamId,
    outOfGame: d.outOfGame,
  };
}

/**
 * Сторінка історії донатів (keyset) із сортуванням за датою або сумою, в обидва боки.
 * Рядки повертаються у display-порядку (sort+dir). nav='prev' із курсором → попередня сторінка;
 * інакше → наступна (або від початку). Межі (prev/next) — точними existence-перевірками.
 */
export async function listDonations(
  db: PrismaClient,
  userId: string,
  filter: DonationFilter = {},
  opts: {
    cursor?: DonationCursor;
    nav?: 'next' | 'prev';
    sort?: DonationSort;
    dir?: DonationSortDir;
    limit?: number;
  } = {},
): Promise<DonationPage> {
  const limit = opts.limit ?? DONATIONS_PER_PAGE;
  const sort = opts.sort ?? 'date';
  const dir = opts.dir ?? 'desc';
  const base = buildWhere(userId, filter);
  const include = { settlement: { select: { name: true } } } as const;

  let records: DonationRecord[];
  if (opts.nav === 'prev' && opts.cursor) {
    // Попередня сторінка: беремо у зворотному порядку від курсора, тоді перевертаємо назад.
    const rev = await db.donation.findMany({
      where: { AND: [base, beyond(sort, opts.cursor, bwdOp(dir))] },
      orderBy: orderByFor(sort, flip(dir)),
      take: limit,
      include,
    });
    records = rev.reverse();
  } else {
    records = await db.donation.findMany({
      where: opts.cursor ? { AND: [base, beyond(sort, opts.cursor, fwdOp(dir))] } : base,
      orderBy: orderByFor(sort, dir),
      take: limit,
      include,
    });
  }

  let nextCursor: DonationCursor | null = null;
  let prevCursor: DonationCursor | null = null;
  if (records.length > 0) {
    const topC = cursorOf(sort, records[0]!);
    const bottomC = cursorOf(sort, records[records.length - 1]!);
    const [hasPrev, hasNext] = await Promise.all([
      db.donation.findFirst({ where: { AND: [base, beyond(sort, topC, bwdOp(dir))] }, select: { id: true } }),
      db.donation.findFirst({ where: { AND: [base, beyond(sort, bottomC, fwdOp(dir))] }, select: { id: true } }),
    ]);
    prevCursor = hasPrev ? topC : null;
    nextCursor = hasNext ? bottomC : null;
  }

  return { rows: records.map(toRow), nextCursor, prevCursor };
}

/** Усі донати за фільтром (без пагінації) — для експорту CSV; той самий порядок, що на сторінці. */
export async function listAllDonations(
  db: PrismaClient,
  userId: string,
  filter: DonationFilter = {},
  sort: DonationSort = 'date',
  dir: DonationSortDir = 'desc',
): Promise<DonationRow[]> {
  const records = await db.donation.findMany({
    where: buildWhere(userId, filter),
    orderBy: orderByFor(sort, dir),
    include: { settlement: { select: { name: true } } },
  });
  return records.map(toRow);
}

// — Донат-док (/dock): сирий шлях (повне ім'я + сирий коментар), offset-пагінація. —
// Це ВНУТРІШНІЙ операторський перегляд за приватним dockKey — на відміну від listDonations
// (анонімізує ім'я) і getState (анонімізує+цензурить). PII лише тут, за приватною силкою.

export const DOCK_PER_PAGE_DEFAULT = 20;

export interface DockDonationRow {
  externalId: string;
  /** ПОВНЕ ім'я (внутрішньо, за приватним ключем) — не анонімізоване. */
  who: string;
  amountUah: number;
  /** Сирий коментар (не цензурований) — як адмінська історія. */
  message: string;
  city: string | null;
  /** id розпізнаного міста (для навчання синоніму кліком по коментарю); null — нерозпізнано. */
  settlementId: string | null;
  status: DonationStatus;
  points: number;
  at: number;
  /** Збір, до якого прив'язаний донат (для інлайн-перенесення в доку); null — поза збором. */
  collectionId: string | null;
  /** Донат відкрив місто (перший PointEvent у його зборі) — бейдж 🆕. */
  newCity: boolean;
  /** Донат поза грою (балів не дає, схований від глядачів). */
  outOfGame: boolean;
}

export interface DockDonationPage {
  rows: DockDonationRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
}

/**
 * Сторінка журналу донатів для доку: offset-пагінація (нумеровані сторінки), найновіші зверху,
 * ПОВНЕ ім'я + сирий коментар. Реюзає buildWhere (фільтр) і cityOpeners (🆕). page клемпиться
 * до [1..pageCount]. 🆕 рахується лише для рядків поточної сторінки (дешево).
 */
export async function listDonationsForDock(
  db: PrismaClient,
  userId: string,
  filter: DonationFilter = {},
  opts: { page?: number; perPage?: number } = {},
): Promise<DockDonationPage> {
  const perPage = opts.perPage ?? DOCK_PER_PAGE_DEFAULT;
  const where = buildWhere(userId, filter);
  const total = await db.donation.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, opts.page ?? 1), pageCount);

  const records = await db.donation.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * perPage,
    take: perPage,
    select: {
      id: true, externalId: true, donorName: true, amount: true, message: true,
      status: true, pointsAwarded: true, createdAt: true, outOfGame: true,
      settlementId: true, collectionId: true,
      settlement: { select: { name: true } },
    },
  });

  const pairs = records
    .filter((r) => r.settlementId)
    .map((r) => ({ settlementId: r.settlementId as string, collectionId: r.collectionId }));
  const openers = await cityOpeners(db, userId, pairs);

  const rows: DockDonationRow[] = records.map((d) => ({
    externalId: d.externalId,
    who: d.donorName || '(без імені)',
    amountUah: d.amount.toNumber(),
    message: d.message,
    city: d.settlement?.name ?? null,
    settlementId: d.settlementId,
    status: d.status,
    points: d.pointsAwarded.toNumber(),
    at: d.createdAt.getTime(),
    collectionId: d.collectionId,
    newCity: d.settlementId ? openers.get(openerKey(d.settlementId, d.collectionId)) === d.id : false,
    outOfGame: d.outOfGame,
  }));

  return { rows, total, page, perPage, pageCount };
}

// — CSV —

// RFC 4180: поле в лапках, якщо містить кому/лапки/перенесення; внутрішні лапки подвоюємо.
function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATUS_LABEL: Record<DonationStatus, string> = {
  recognized: 'розпізнано',
  unrecognized: 'не розпізнано',
};

/**
 * Рядки → CSV-рядок (UTF-8 з BOM, щоб Excel правильно показав кирилицю).
 * Ім'я — повне (як на екрані вкладки «Донати»): це приватний експорт стрімером власних даних.
 */
export function donationsToCsv(rows: DonationRow[]): string {
  const header = ['Дата/час', 'Донатер', 'Сума, ₴', 'Місто', 'Статус', 'Бали', 'Повідомлення'];
  const lines = [header.map(csvField).join(',')];
  for (const r of rows) {
    lines.push(
      [
        formatDateTime(r.at),
        r.who,
        r.amountUah,
        r.city ?? '',
        STATUS_LABEL[r.status],
        r.points,
        r.message,
      ]
        .map(csvField)
        .join(','),
    );
  }
  return '﻿' + lines.join('\r\n');
}

// — Розбір параметрів URL (єдине джерело для сторінки й роуту експорту) —

const emptyToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);

const FilterSchema = z.object({
  q: z.preprocess(emptyToUndef, z.string().trim().max(120).optional()),
  min: z.preprocess(emptyToUndef, z.coerce.number().nonnegative().optional()),
  max: z.preprocess(emptyToUndef, z.coerce.number().nonnegative().optional()),
  status: z.preprocess(emptyToUndef, z.enum(['recognized', 'pocket', 'unrecognized']).optional()),
  city: z.preprocess(emptyToUndef, z.string().max(64).optional()),
  stream: z.preprocess(emptyToUndef, z.string().max(64).optional()),
  period: z.preprocess(emptyToUndef, z.enum(['week', 'month', 'all']).optional()),
});

/** Безпечно розбирає query-параметри у DonationFilter (порожні значення → без фільтра). */
export function parseDonationFilter(input: Record<string, string | undefined>): DonationFilter {
  const parsed = FilterSchema.safeParse(input);
  if (!parsed.success) return {};
  const { q, min, max, status, city, stream, period } = parsed.data;
  const search = q?.trim();
  return {
    ...(search ? { search } : {}),
    ...(min != null ? { minUah: min } : {}),
    ...(max != null ? { maxUah: max } : {}),
    ...(status ? { status } : {}),
    ...(city ? { settlementId: city } : {}),
    ...(stream ? { streamId: stream } : {}),
    ...(period && period !== 'all' ? { range: period } : {}),
  };
}

/** Міста, що зустрічаються в донатах користувача (для селекта фільтра «місто»), за назвою. */
export async function listDonationCities(
  db: PrismaClient,
  userId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await db.donation.findMany({
    where: { userId, settlementId: { not: null } },
    distinct: ['settlementId'],
    select: { settlement: { select: { id: true, name: true } } },
  });
  return rows
    .map((r) => r.settlement)
    .filter((s): s is { id: string; name: string } => s != null)
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
}

const SortSchema = z.object({
  sort: z.preprocess(emptyToUndef, z.enum(['date', 'amount']).optional()),
  dir: z.preprocess(emptyToUndef, z.enum(['asc', 'desc']).optional()),
});

/** Безпечно розбирає параметри сортування з URL (дефолт — дата, спадання). */
export function parseDonationSort(input: Record<string, string | undefined>): {
  sort: DonationSort;
  dir: DonationSortDir;
} {
  const p = SortSchema.safeParse(input);
  return {
    sort: p.success && p.data.sort ? p.data.sort : 'date',
    dir: p.success && p.data.dir ? p.data.dir : 'desc',
  };
}

export function encodeCursor(c: DonationCursor): string {
  return `${c.val}_${c.id}`;
}

export function parseCursor(s: string | undefined): DonationCursor | undefined {
  if (!s) return undefined;
  const i = s.indexOf('_');
  if (i <= 0) return undefined;
  const val = Number(s.slice(0, i));
  const id = s.slice(i + 1);
  if (!Number.isFinite(val) || !id) return undefined;
  return { val, id };
}
