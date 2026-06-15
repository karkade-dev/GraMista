// Чистий парсер query-конфігу донат-доку /dock. БЕЗ Prisma (імпортується клієнтським
// конструктором). Невідоме/відсутнє → дефолт; ніколи не кидає. Патерн — як lib/overlayConfig.

export type DockPeriod = 'all' | 'stream' | 'today' | 'week' | 'month';

export interface DockConfig {
  key: string;     // dockKey (?k=)
  period: DockPeriod;
  perPage: number; // 20 | 30 | 50
  page: number;    // ≥ 1 (верхню межу клемпить шар даних за pageCount)
  scale: number;   // % 50..200
  live: boolean;   // false у прев'ю конструктора (?preview=1)
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

export function parseDockConfig(q: Query): DockConfig {
  const perRaw = one(q.per);
  const perPage = perRaw === '30' ? 30 : perRaw === '50' ? 50 : 20;
  return {
    key: one(q.k) ?? '',
    period: oneOf(q.period, ['all', 'stream', 'today', 'week', 'month'] as const, 'all'),
    perPage,
    page: clampInt(q.page, 1, Number.MAX_SAFE_INTEGER, 1),
    scale: clampInt(q.scale, 50, 200, 100),
    live: one(q.preview) !== '1',
  };
}
