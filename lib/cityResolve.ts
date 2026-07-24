import { Prisma, type PrismaClient } from '@prisma/client';
import { normalize } from './text';
import { CITY_STOP_FORMS } from './cityStopForms';
import { detectOblastHints } from './oblastHints';

export interface CityMatch {
  settlementId: string;
  name: string;
  matchedForm: string;
}

// Пороги fuzzy закріплені тестами. Відмінки покриває ВЕСУМ-аліасами ТОЧНИЙ збіг, тож fuzzy
// лишається тільки для ОДРУКІВ — вони дають високу схожість (≥0.66 на замірах), а звичайні слова
// проти 29 тис. назв сіл — нижчу («просто»→«Просторе» 0.6): поріг 0.55 відсікає такі хибні бали.
const SIMILARITY_THRESHOLD = 0.55;
/** Одрук майже не змінює довжину слова; «просто»(6)≠«просторе»(8) — різниця 2 видає НЕ-одрук. */
const MAX_FUZZY_LEN_DIFF = 1;
/** Коротким назвам (Суми, Київ) fuzzy не довіряємо — лише точний збіг/аліас. */
const MIN_FUZZY_FORM_LEN = 5;
/** Слова коментаря, коротші за 4 літери, не стають fuzzy-кандидатами. */
const MIN_FUZZY_WORD_LEN = 4;
const MAX_WORDS = 40;
const MAX_FUZZY_QS = 24;
/** Скільки fuzzy-кандидатів дістаємо з БД (топ-1 може програти підказці області). */
const FUZZY_CANDIDATES = 5;

/** Країни-агресори — виключаються з пулу, коли стрімер увімкнув відповідну опцію. */
const AGGRESSOR = ['RU', 'BY'];

// Підказка області в коментарі («Іванівка Сумська», «з Іванівки на Сумщині») — розвʼязує тезок.
// Хибна підказка НЕшкідлива: вона лише фільтрує вже знайдених кандидатів і ніколи не додає нових
// (нема тезок — нема ефекту). Стеми/детектор — спільні з пошуком пікера (lib/oblastHints).

// Стоп-правило для назв-звичайних-слів (Добре, Веселе, Надія… — список згенеровано з ВЕСУМ):
// малі НП з такою назвою отримують бали ЛИШЕ з маркером «село/місто…» перед назвою або
// підказкою області — інакше «все буде добре» чи «Слава Україні» дають бали випадковому селу.
// Великі міста (Суми, Рівне, Бровари…) виключені за населенням — їх пишуть одним словом.
const STOP_EXEMPT_POPULATION = 50_000;
const MARKER_FORMS = new Set([
  'с', 'м', 'смт', 'село', 'села', 'селі', 'селом', 'селище', 'селища', 'селищі',
  'місто', 'міста', 'місті', 'містом', 'містечко', 'містечка', 'хутір', 'хутора', 'хуторі',
]);

/** Позиція форми (можливо багатослівної) серед слів коментаря; -1 — не знайдено. */
function formPosition(words: string[], form: string): number {
  const flen = form.split(' ').length;
  for (let i = 0; i + flen <= words.length; i++) {
    if (words.slice(i, i + flen).join(' ') === form) return i;
  }
  return -1;
}

/** form — форма з довідника, occur — як вона зустрілась у коментарі (для fuzzy це слово з одруком). */
function passesStopRule(
  form: string,
  occur: string,
  population: number,
  oblast: string | null,
  words: string[],
  hints: Set<string>,
): boolean {
  if (!CITY_STOP_FORMS.has(form)) return true;
  if (population >= STOP_EXEMPT_POPULATION) return true;
  if (oblast !== null && hints.has(oblast)) return true;
  const i = formPosition(words, occur);
  if (i > 0) {
    const prev = words[i - 1];
    if (prev !== undefined && MARKER_FORMS.has(prev)) return true;
  }
  return false;
}

type Cand = { id: string; name: string; form: string; population: number; oblast: string | null; country: string };

/** Кращий кандидат: Україна перемагає закордон → довша форма → більше населення → id (детермінізм). */
function better(c: Cand, best: Cand): boolean {
  const cua = c.country === 'UA';
  const bua = best.country === 'UA';
  if (cua !== bua) return cua;
  if (c.form.length !== best.form.length) return c.form.length > best.form.length;
  if (c.population !== best.population) return c.population > best.population;
  return c.id < best.id;
}

/**
 * Форма сама є підказкою області? («івано франківська» → стем «франківськ»; «донецька» → «донецьк»).
 * Такі форми (назва/відмінок обласного центру) — це орієнтир «де», а не ціль донату.
 */
function isOblastQualifier(form: string): boolean {
  return detectOblastHints(form.split(' ')).size > 0;
}

function pickBest(cands: Cand[], hints: Set<string>): Cand | null {
  const inHint = hints.size > 0 ? cands.filter((c) => c.oblast !== null && hints.has(c.oblast)) : [];
  // Уточнювач-«де» не виграє, КОЛИ в підказаній області названо інше місто — тоді він лише орієнтир
  // («Долина Івано-Франківськ» → Долина, не центр). Якщо названо ЛИШЕ центр — він і лишається (fallback).
  const targets = inHint.filter((c) => !isOblastQualifier(c.form));
  const pool = targets.length > 0 ? targets : inHint.length > 0 ? inHint : cands;
  let best: Cand | null = null;
  for (const c of pool) if (!best || better(c, best)) best = c;
  return best;
}

/**
 * Розпізнає місто в коментарі донату по довіднику в БД (один донат = одне місто).
 * 1) Точний збіг: усі 1..4-грами нормалізованого коментаря lookup-ом по nameNorm/aliasNorm
 *    (btree-індекси) — еквівалент старого «ціла форма як слово», але без 250 тис. форм у памʼяті.
 * 2) Fuzzy: pg_trgm similarity по словах/біграмах (GIN trgm-індекси вже існують з міграції init).
 * Тезки розвʼязуються підказкою області з коментаря, інакше — населенням. Нижче порогу — null:
 * донат лишиться нерозпізнаним і потрапить у чергу адмінки (свідомо, замість «нарахувати наосліп»).
 */
export async function resolveCity(
  db: PrismaClient,
  message: string,
  opts: { abroad?: boolean; hideAggressor?: boolean; userId?: string } = {},
): Promise<CityMatch | null> {
  const norm = normalize(message);
  if (!norm) return null;
  const words = norm.split(' ').slice(0, MAX_WORDS);
  const hints = detectOblastHints(words);

  // Пул кандидатів за країною: вимкнено abroad → лише UA (повна поточна поведінка);
  // увімкнено → UA + світ (з опційним виключенням рф/рб).
  const countryWhere: Prisma.SettlementWhereInput = !opts.abroad
    ? { country: 'UA' }
    : opts.hideAggressor
      ? { country: { notIn: AGGRESSOR } }
      : {};

  // Власник аліаса (мультитенант): спільні (userId=null) + лише приватні цього стрімера; без
  // userId — лише спільні. Дія одного стрімера не впливає на інших. Те саме правило у fuzzy нижче.
  const aliasOwner: Prisma.SettlementAliasWhereInput = opts.userId
    ? { OR: [{ userId: null }, { userId: opts.userId }] }
    : { userId: null };
  const aliasUserSql = opts.userId
    ? Prisma.sql`AND (a."userId" IS NULL OR a."userId" = ${opts.userId})`
    : Prisma.sql`AND a."userId" IS NULL`;

  const ngrams: string[] = [];
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i + n <= words.length; i++) ngrams.push(words.slice(i, i + n).join(' '));
  }
  if (ngrams.length === 0) return null;

  const [byName, byAlias] = await Promise.all([
    db.settlement.findMany({
      where: { nameNorm: { in: ngrams }, ...countryWhere },
      select: { id: true, name: true, nameNorm: true, population: true, oblast: true, country: true },
    }),
    db.settlementAlias.findMany({
      where: { aliasNorm: { in: ngrams }, settlement: countryWhere, ...aliasOwner },
      select: { aliasNorm: true, settlement: { select: { id: true, name: true, population: true, oblast: true, country: true } } },
    }),
  ]);
  const exactCands: Cand[] = [
    ...byName.map((s) => ({ id: s.id, name: s.name, form: s.nameNorm, population: s.population ?? 0, oblast: s.oblast, country: s.country })),
    ...byAlias.map((a) => ({
      id: a.settlement.id, name: a.settlement.name, form: a.aliasNorm,
      population: a.settlement.population ?? 0, oblast: a.settlement.oblast, country: a.settlement.country,
    })),
  ].filter((c) => passesStopRule(c.form, c.form, c.population, c.oblast, words, hints));
  const exact = pickBest(exactCands, hints);
  if (exact) return { settlementId: exact.id, name: exact.name, matchedForm: exact.form };

  // Fuzzy-кандидати: окремі слова (одруки коротких слів свідомо не ловимо) + сусідні біграми
  // (складені назви на кшталт «кривий ріг» з одруком).
  const fuzzyQs = new Set<string>();
  for (const w of words) if (w.length >= MIN_FUZZY_WORD_LEN) fuzzyQs.add(w);
  for (let i = 0; i + 1 < words.length; i++) {
    const a = words[i];
    const b = words[i + 1];
    if (a && b && a.length + b.length + 1 >= MIN_FUZZY_FORM_LEN + 2) fuzzyQs.add(`${a} ${b}`);
  }
  if (fuzzyQs.size === 0) return null;
  const qs = [...fuzzyQs].slice(0, MAX_FUZZY_QS);

  // Fuzzy лишається лише UA — головний вектор хибних збігів; закордон матчиться точним збігом
  // + відмінковим аліасом (ВЕСУМ). Фільтр opts.abroad/hideAggressor тут НЕ застосовується.
  const rows = await db.$transaction(async (tx) => {
    // Поріг оператора % — SET LOCAL (живе рівно до кінця транзакції; зʼєднання гарантовано те саме).
    await tx.$executeRawUnsafe(`SET LOCAL pg_trgm.similarity_threshold = ${SIMILARITY_THRESHOLD}`);
    return tx.$queryRaw<
      { id: string; name: string; oblast: string | null; population: number | null; form: string; q: string; sim: number }[]
    >`
      SELECT s.id, s.name, s.oblast, s.population, c.form, c.q, c.sim::float AS sim
      FROM (
        SELECT a."settlementId" AS sid, a."aliasNorm" AS form, w.q AS q, similarity(a."aliasNorm", w.q) AS sim
        FROM unnest(ARRAY[${Prisma.join(qs)}]::text[]) AS w(q)
        JOIN "SettlementAlias" a ON a."aliasNorm" % w.q
        WHERE length(a."aliasNorm") >= ${MIN_FUZZY_FORM_LEN}
          AND abs(length(a."aliasNorm") - length(w.q)) <= ${MAX_FUZZY_LEN_DIFF}
          ${aliasUserSql}
        UNION ALL
        SELECT s2.id, s2."nameNorm", w.q, similarity(s2."nameNorm", w.q)
        FROM unnest(ARRAY[${Prisma.join(qs)}]::text[]) AS w(q)
        JOIN "Settlement" s2 ON s2."nameNorm" % w.q
        WHERE length(s2."nameNorm") >= ${MIN_FUZZY_FORM_LEN}
          AND abs(length(s2."nameNorm") - length(w.q)) <= ${MAX_FUZZY_LEN_DIFF}
      ) c
      JOIN "Settlement" s ON s.id = c.sid
      WHERE s.country = 'UA'
      ORDER BY c.sim DESC, s.population DESC NULLS LAST, s.id ASC
      LIMIT ${FUZZY_CANDIDATES}`;
  });
  const ok = rows.filter(
    (r) =>
      r.sim >= SIMILARITY_THRESHOLD &&
      // Стоп-правило і для fuzzy: маркер шукаємо біля слова коментаря (q), бо form — з довідника.
      passesStopRule(r.form, r.q, r.population ?? 0, r.oblast, words, hints),
  );
  // Підказка області перемагає вищу схожість: «з Тестівки на Сумщині» → сумська тезка. Те саме
  // правило уточнювача, що й у точному збігу: форма-орієнтир («донецька») не виграє за наявності цілі.
  const inHint = ok.filter((r) => r.oblast !== null && hints.has(r.oblast));
  const top = inHint.find((r) => !isOblastQualifier(r.form)) ?? inHint[0] ?? ok[0];
  if (!top) return null;
  return { settlementId: top.id, name: top.name, matchedForm: top.form };
}
