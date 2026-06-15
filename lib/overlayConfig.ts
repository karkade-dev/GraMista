// Чистий парсер query-конфігу оверлея. БЕЗ Prisma — імпортується і клієнтським конструктором.
// Невідоме/відсутнє значення → дефолт; ніколи не кидає (силка оверлея має завжди рендеритись).

export type OverlayStyle = 'glass' | 'solid' | 'minimal';
export type OverlayPeriod = 'collection' | 'stream' | 'week' | 'month' | 'all';
export type FeedMode = 'card' | 'list';
export type Chroma = 'none' | 'green' | 'blue' | 'magenta';

export interface OverlayConfig {
  style: OverlayStyle;
  period: OverlayPeriod;
  rows: number;
  sort: 'asc' | 'desc';
  feed: FeedMode;
  scale: number; // %
  chroma: Chroma;
  title: boolean;
  /** Показувати коментар донату (feed/alert); вимикається в конструкторі (&comment=0). */
  comment: boolean;
  /** Топ міст: 'ua' (лише Україна, дефолт) | 'abroad' (лише закордон) | 'both' (разом). */
  scope: 'ua' | 'abroad' | 'both';
  live: boolean; // живе SSE-оновлення; false у прев'ю конструктора (preview=1), щоб не плодити з'єднань
}

export interface OverlayDefaults {
  period?: OverlayPeriod;
  rows?: number;
}

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function oneOf<T extends string>(v: string | string[] | undefined, allowed: readonly T[], def: T): T {
  const s = one(v);
  return (allowed as readonly string[]).includes(s ?? '') ? (s as T) : def;
}

function clampInt(v: string | string[] | undefined, min: number, max: number, def: number): number {
  const n = Number.parseInt(one(v) ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function parseOverlayConfig(q: Query, defaults: OverlayDefaults = {}): OverlayConfig {
  return {
    style: oneOf(q.style, ['glass', 'solid', 'minimal'] as const, 'glass'),
    period: oneOf(q.period, ['collection', 'stream', 'week', 'month', 'all'] as const, defaults.period ?? 'all'),
    rows: clampInt(q.rows, 1, 20, defaults.rows ?? 5),
    sort: oneOf(q.sort, ['asc', 'desc'] as const, 'desc'),
    feed: oneOf(q.feed, ['card', 'list'] as const, 'card'),
    scale: clampInt(q.scale, 50, 200, 100),
    chroma: oneOf(q.chroma, ['none', 'green', 'blue', 'magenta'] as const, 'none'),
    title: one(q.title) !== '0',
    comment: one(q.comment) !== '0',
    scope: oneOf(q.scope, ['ua', 'abroad', 'both'] as const, 'ua'),
    live: one(q.preview) !== '1',
  };
}
