import { Prisma, type PrismaClient } from '@prisma/client';
import { normalize } from './text';
import { recordAdminAction } from './adminLog';
import { OBLAST_HINT_STEMS } from './oblastHints';

// Пошук поселень для автодоповнення в Адмінці (§17.5) і публічного «знайди своє місто»:
// за нормалізованою назвою або аліасом. Довідник глобальний (без userId).

export interface SettlementMatch {
  id: string;
  name: string;
  oblast: string | null;
  /** Розрізняє тезок у видачі («Іванівка — Сумська, Конотопський район»). */
  raion: string | null;
}

/**
 * Якщо в запиті є слово-область («Рокитне Київська», «Микільське Сумщина») — повертає цю область
 * і запит без неї, щоб фільтрувати тезок (десятки сіл з однаковою назвою). Спільні стеми з
 * розпізнаванням донату (lib/oblastHints). Решта-термін має лишитись змістовним (≥2 літери),
 * інакше це сам по собі запит («крим») — тоді області не виокремлюємо.
 */
function splitOblastQuery(q: string): { oblast: string | null; term: string } {
  const words = q.split(' ').filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w) continue;
    for (const [stem, oblast] of OBLAST_HINT_STEMS) {
      if (w.startsWith(stem)) {
        const term = [...words.slice(0, i), ...words.slice(i + 1)].join(' ');
        if (term.length >= 2) return { oblast, term };
      }
    }
  }
  return { oblast: null, term: q };
}

/**
 * Пошук для автодоповнення адмінки та публічного «знайди своє місто»: спершу збіг
 * префікса (людина друкує початок назви), далі pg_trgm-схожість (одруки) — по назві Й аліасах.
 * Ранжування: префікс → схожість → населення → область/район (тезки групуються за регіоном).
 * Підказка області в запиті («Рокитне Київщина») фільтрує тезок. GIN trgm-індекси — з міграції init.
 */
export async function searchSettlements(
  db: PrismaClient,
  query: string,
  limit = 25,
  userId?: string,
): Promise<SettlementMatch[]> {
  const { oblast, term } = splitOblastQuery(normalize(query));
  const q = term;
  if (q.length < 2) return [];
  // Власник аліаса (мультитенант): спільні (userId=null) + лише приватні цього стрімера;
  // без userId — лише спільні. Та сама межа, що і в resolveCity.
  const aliasUserSql = userId
    ? Prisma.sql`AND ("userId" IS NULL OR "userId" = ${userId})`
    : Prisma.sql`AND "userId" IS NULL`;
  // Підказка області з запиту фільтрує тезок (десятки однойменних сіл) — інакше потрібне
  // (мале, з невідомим населенням) могло б не вміститись у видачу.
  const oblastFilter = oblast ? Prisma.sql`WHERE s.oblast = ${oblast}` : Prisma.empty;
  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL pg_trgm.similarity_threshold = 0.35`);
    return tx.$queryRaw<
      { id: string; name: string; oblast: string | null; raion: string | null; population: number | null; pre: number; sim: number }[]
    >`
      SELECT DISTINCT ON (s.id)
             s.id, s.name, s.oblast, s.raion, s.population,
             (c.form LIKE ${q} || '%')::int AS pre,
             similarity(c.form, ${q})::float AS sim
      FROM (
        SELECT id AS sid, "nameNorm" AS form FROM "Settlement"
        WHERE "nameNorm" LIKE ${q} || '%' OR "nameNorm" % ${q}
        UNION ALL
        SELECT "settlementId", "aliasNorm" FROM "SettlementAlias"
        WHERE ("aliasNorm" LIKE ${q} || '%' OR "aliasNorm" % ${q})
          ${aliasUserSql}
      ) c
      JOIN "Settlement" s ON s.id = c.sid
      ${oblastFilter}
      ORDER BY s.id, pre DESC, sim DESC`;
  });
  // Ранжування: префікс → схожість → населення → область,район (тезки групуються за регіоном,
  // легко проглянути) → назва. Так мала тезка з population=null лишається досяжною й передбачуваною.
  rows.sort(
    (a, b) =>
      b.pre - a.pre ||
      b.sim - a.sim ||
      (b.population ?? 0) - (a.population ?? 0) ||
      (a.oblast ?? '').localeCompare(b.oblast ?? '', 'uk') ||
      (a.raion ?? '').localeCompare(b.raion ?? '', 'uk') ||
      a.name.localeCompare(b.name, 'uk'),
  );
  return rows.slice(0, limit).map(({ id, name, oblast: o, raion }) => ({ id, name, oblast: o, raion }));
}

/**
 * Додає ПРИВАТНИЙ синонім (аліас) місту для стрімера userId — надалі ЙОГО донати з цією формою
 * авто-розпізнаються; інших стрімерів не зачіпає (мультитенант, spec 2026-06-15). Дедуп за
 * нормою в межах міста серед спільних (userId=null) + власних. null, якщо міста нема або аліас
 * закороткий. Журналюється (відкат — прибрати створений аліас) ЛИШЕ коли реально додано новий.
 * Резолвер (resolveCity) ходить у БД наживо — новий аліас підхоплюється без рестарту.
 */
export async function addAlias(
  db: PrismaClient,
  userId: string,
  settlementId: string,
  alias: string,
): Promise<{ ok: true; aliasNorm: string } | null> {
  const aliasNorm = normalize(alias);
  if (aliasNorm.length < 2) return null;
  return db.$transaction(async (tx) => {
    const settlement = await tx.settlement.findUnique({ where: { id: settlementId }, select: { name: true } });
    if (!settlement) return null;
    // Дубль — якщо це написання вже покрите СПІЛЬНИМ аліасом (userId=null) або ВЛАСНИМ цього
    // стрімера: тоді воно вже розпізнається, нового приватного рядка не створюємо.
    const existing = await tx.settlementAlias.findFirst({
      where: { settlementId, aliasNorm, OR: [{ userId: null }, { userId }] },
      select: { id: true },
    });
    if (existing) return { ok: true, aliasNorm }; // дубль — без журналу
    // Приватний синонім стрімера: видимий лише в його розпізнаванні/пошуку (мультитенант).
    const created = await tx.settlementAlias.create({
      data: { settlementId, alias: alias.trim(), aliasNorm, source: 'manual', userId },
    });
    await recordAdminAction(tx, userId, {
      type: 'addAlias',
      summary: `Додано синонім «${alias.trim()}» місту «${settlement.name}»`,
      payload: { aliasId: created.id, settlementId },
      undoable: true,
    });
    return { ok: true, aliasNorm };
  });
}
