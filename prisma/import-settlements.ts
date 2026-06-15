import 'dotenv/config';
import { readFileSync, createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { parseKatottgCsv, mapSettlements, type ImportSettlement } from '../lib/etl/katottg';
import { parseGeonames, buildGeoIndex, type GeoEnrich } from '../lib/etl/geonames';
import { collectGeoForms } from '../lib/etl/vesum';
import { buildWorldSettlements } from '../lib/etl/worldCities';
import { buildCentroidIndex, centroidFor } from '../lib/etl/centroid';
import { normalize } from '../lib/text';

// Імпорт повного довідника НП (КАТОТТГ + GeoNames + ВЕСУМ) у Settlement/SettlementAlias.
// Ідемпотентний: повторний запуск не дублює; 27 seed-слагів (kyiv, lviv…) ЗБЕРІГАЮТЬСЯ
// (їм лише дописується katottg/район/громада). Аліаси vesum/geonames перебудовуються,
// seed/manual — недоторканні.
//
// Джерела — відкриті дані, поклади в data/sources/ (тека gitignored, ~50 МБ):
//   katottg.csv        https://github.com/mykhailoklimnyk/ua-administrative-codes/releases/download/0.1.0/katottg.csv
//   UA.txt             з архіву https://download.geonames.org/export/dump/UA.zip
//   dict_corp_vis.txt  розпакований https://github.com/brown-uk/dict_uk/releases/download/v6.8.0/dict_corp_vis.txt.bz2
//   cities15000.txt        з архіву https://download.geonames.org/export/dump/cities15000.zip
//   alternateNamesV2.txt   з архіву https://download.geonames.org/export/dump/alternateNamesV2.zip
const SRC = join(process.cwd(), 'data', 'sources');
const prisma = new PrismaClient();

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const TYPE_RANK: Record<string, number> = { місто: 3, 'селище міського типу': 2, селище: 1 };

async function main(): Promise<void> {
  const t0 = Date.now();
  const katottgPath = join(SRC, 'katottg.csv');
  if (!existsSync(katottgPath)) throw new Error(`Нема ${katottgPath} — URL джерел у коментарі на початку цього файлу`);

  const settlements = mapSettlements(parseKatottgCsv(readFileSync(katottgPath, 'utf8')));
  console.log(`[import] КАТОТТГ: ${settlements.length} НП`);

  const geoPath = join(SRC, 'UA.txt');
  const geo: Map<string, GeoEnrich> = existsSync(geoPath)
    ? buildGeoIndex(parseGeonames(readFileSync(geoPath, 'utf8')))
    : new Map();
  if (geo.size === 0) console.warn('[import] UA.txt не знайдено — без координат/населення');
  else console.log(`[import] GeoNames: ${geo.size} ключів збагачення`);

  // Наявні рядки: швидкі — за katottg; legacy (27 seed-слагів без коду) — за (назваNorm|область).
  const existing = await prisma.settlement.findMany({
    select: {
      id: true, katottg: true, nameNorm: true, oblast: true,
      lat: true, lon: true, coordsDerived: true, population: true, raion: true, hromada: true, type: true,
    },
  });
  const byKatottg = new Map(existing.filter((e) => e.katottg).map((e) => [e.katottg as string, e] as const));
  const legacyByKey = new Map(existing.filter((e) => !e.katottg).map((e) => [`${e.nameNorm}|${e.oblast ?? ''}`, e] as const));

  // Серед CSV-тезок на один legacy-ключ обираємо «місто» (обласні центри — завжди міста).
  const bestForLegacy = new Map<string, ImportSettlement>();
  for (const s of settlements) {
    const key = `${s.nameNorm}|${s.oblast}`;
    if (!legacyByKey.has(key)) continue;
    const cur = bestForLegacy.get(key);
    if (!cur || (TYPE_RANK[s.type ?? ''] ?? 0) > (TYPE_RANK[cur.type ?? ''] ?? 0)) bestForLegacy.set(key, s);
  }

  let updated = 0;
  let unchanged = 0;
  const toCreate: Prisma.SettlementCreateManyInput[] = [];
  for (const s of settlements) {
    const key = `${s.nameNorm}|${s.oblast}`;
    const enrich = geo.get(key);
    // coordsReliable: одинокий НП або тезка-лідер за населенням. Решту (лідера нема) лишаємо
    // без координат — другим проходом їх поставить центроїд громади.
    const lat = enrich?.coordsReliable ? enrich.lat : null;
    const lon = enrich?.coordsReliable ? enrich.lon : null;
    const population = enrich?.population ?? null;

    const legacy = bestForLegacy.get(key) === s ? legacyByKey.get(key) : undefined;
    const ex = byKatottg.get(s.katottg) ?? legacy;
    if (ex) {
      // Доповнюємо лише відсутнє: seed-координати/населення кураторські — не перетираємо.
      const data: Record<string, unknown> = {};
      if (ex.katottg !== s.katottg) data.katottg = s.katottg;
      if (!ex.raion && s.raion) data.raion = s.raion;
      if (!ex.hromada && s.hromada) data.hromada = s.hromada;
      if (!ex.type && s.type) data.type = s.type;
      // Справжня точка GeoNames перекриває як порожнечу, так і раніше виведений центроїд.
      if (lat != null && (ex.lat == null || ex.coordsDerived)) {
        data.lat = lat;
        data.lon = lon;
        if (ex.coordsDerived) data.coordsDerived = false;
      }
      if (ex.population == null && population != null) data.population = population;
      if (Object.keys(data).length > 0) {
        await prisma.settlement.update({ where: { id: ex.id }, data });
        updated++;
      } else unchanged++;
    } else {
      // id = код КАТОТТГ: стабільний між перезапусками, ідемпотентно.
      toCreate.push({
        id: s.katottg, katottg: s.katottg, name: s.name, nameNorm: s.nameNorm,
        type: s.type, oblast: s.oblast, raion: s.raion, hromada: s.hromada, lat, lon, population,
      });
    }
  }
  for (const batch of chunks(toCreate, 2000)) {
    await prisma.settlement.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`[import] НП: +${toCreate.length} нових · ${updated} оновлено · ${unchanged} без змін`);

  // Іноземні НП (GeoNames cities + alternateNamesV2). Ідемпотентно за id = 'g'+geonameid.
  // Лишаємо лише міста з українською назвою (кирилице-only). Їхні відмінки причепить нижчий
  // ВЕСУМ-крок (їхній nameNorm входить у idsByNameNorm).
  const citiesPath = join(SRC, 'cities15000.txt');
  const altPath = join(SRC, 'alternateNamesV2.txt');
  const worldAliasRows: Prisma.SettlementAliasCreateManyInput[] = [];
  if (existsSync(citiesPath) && existsSync(altPath)) {
    const world = buildWorldSettlements(readFileSync(citiesPath, 'utf8'), readFileSync(altPath, 'utf8'));
    const existingWorld = new Set(
      (await prisma.settlement.findMany({ where: { id: { startsWith: 'g' } }, select: { id: true } })).map((s) => s.id),
    );
    const toCreateWorld: Prisma.SettlementCreateManyInput[] = world
      .filter((w) => !existingWorld.has(w.id))
      .map((w) => ({ id: w.id, name: w.name, nameNorm: w.nameNorm, country: w.country, lat: w.lat, lon: w.lon, population: w.population }));
    for (const batch of chunks(toCreateWorld, 2000)) {
      await prisma.settlement.createMany({ data: batch, skipDuplicates: true });
    }
    for (const w of world) {
      for (const a of w.aliases) {
        const aliasNorm = normalize(a);
        if (aliasNorm && aliasNorm !== w.nameNorm) {
          worldAliasRows.push({ settlementId: w.id, alias: a, aliasNorm, source: 'geonames-world' });
        }
      }
    }
    console.log(`[import] світ: +${toCreateWorld.length} НП · ${worldAliasRows.length} аліасів`);
  } else {
    console.warn('[import] cities15000.txt/alternateNamesV2.txt не знайдено — без закордонних міст');
  }

  // Центроїд громади для НП БЕЗ власних координат (нема в GeoNames або тезки без лідера).
  // Опори — лише СПРАВЖНІ точки (coordsDerived=false), щоб центроїди не дрейфували від себе.
  // Україна-only: закордонні НП (oblast=null) сюди не входять. Раніше виведені центроїди
  // перераховуються щоразу — імпорт сходиться й лишається ідемпотентним.
  const uaForCentroid = await prisma.settlement.findMany({
    where: { country: 'UA' },
    select: { id: true, oblast: true, raion: true, hromada: true, lat: true, lon: true, coordsDerived: true },
  });
  const centroidIdx = buildCentroidIndex(
    uaForCentroid.filter((s) => s.lat != null && s.lon != null && !s.coordsDerived),
  );
  const centroidUpdates: { id: string; lat: number; lon: number }[] = [];
  for (const s of uaForCentroid) {
    if (s.lat != null && s.lon != null && !s.coordsDerived) continue; // має справжню точку
    const c = centroidFor(s, centroidIdx);
    if (!c) continue;
    if (s.coordsDerived && s.lat != null && Math.abs(s.lat - c.lat) < 1e-9 && Math.abs((s.lon ?? 0) - c.lon) < 1e-9) {
      continue; // центроїд не змінився — не чіпаємо (ідемпотентність)
    }
    centroidUpdates.push({ id: s.id, lat: c.lat, lon: c.lon });
  }
  for (const batch of chunks(centroidUpdates, 100)) {
    await Promise.all(
      batch.map((u) =>
        prisma.settlement.update({ where: { id: u.id }, data: { lat: u.lat, lon: u.lon, coordsDerived: true } }),
      ),
    );
  }
  console.log(`[import] центроїд громади/району: ${centroidUpdates.length} НП без власних координат`);

  // Аліаси: перебудовуємо ЛИШЕ vesum/geonames/geonames-world (seed/manual — ручна робота, недоторканна).
  await prisma.settlementAlias.deleteMany({ where: { source: { in: ['vesum', 'geonames', 'geonames-world'] } } });

  const all = await prisma.settlement.findMany({ select: { id: true, nameNorm: true, oblast: true } });
  const idsByNameNorm = new Map<string, string[]>();
  for (const s of all) {
    const list = idsByNameNorm.get(s.nameNorm) ?? [];
    list.push(s.id);
    idsByNameNorm.set(s.nameNorm, list);
  }

  // Що вже зайнято (щоб не дублювати): власна назва + наявні seed/manual-аліаси.
  const keepAliases = await prisma.settlementAlias.findMany({ select: { settlementId: true, aliasNorm: true } });
  const taken = new Set<string>(keepAliases.map((a) => `${a.settlementId}|${a.aliasNorm}`));
  for (const s of all) taken.add(`${s.id}|${s.nameNorm}`);

  const aliasRows: Prisma.SettlementAliasCreateManyInput[] = [];
  const pushAlias = (settlementId: string, alias: string, source: string): void => {
    const aliasNorm = normalize(alias);
    if (!aliasNorm) return;
    const k = `${settlementId}|${aliasNorm}`;
    if (taken.has(k)) return;
    taken.add(k);
    aliasRows.push({ settlementId, alias, aliasNorm, source });
  };

  // Відмінкові форми ВЕСУМ: та сама форма «Іванівки» застосовна до КОЖНОЇ Іванівки.
  const vesumPath = join(SRC, 'dict_corp_vis.txt');
  if (existsSync(vesumPath)) {
    const rl = createInterface({ input: createReadStream(vesumPath, { encoding: 'utf8' }), crlfDelay: Infinity });
    const forms = await collectGeoForms(rl, new Set(idsByNameNorm.keys()));
    let covered = 0;
    for (const [lemmaNorm, set] of forms) {
      const ids = idsByNameNorm.get(lemmaNorm);
      if (!ids) continue;
      covered++;
      for (const id of ids) for (const f of set) pushAlias(id, f, 'vesum');
    }
    console.log(`[import] ВЕСУМ: відмінки для ${covered} різних назв`);
  } else console.warn('[import] dict_corp_vis.txt не знайдено — без відмінкових аліасів');

  // GeoNames-варіанти: латиниця (Brovary) + інші кирилічні написання (рос. тощо).
  for (const s of all) {
    const enrich = geo.get(`${s.nameNorm}|${s.oblast ?? ''}`);
    if (!enrich) continue;
    for (const a of enrich.aliasCandidates) pushAlias(s.id, a, 'geonames');
  }

  // Аліаси іноземних НП (geonames-world) — додаємо до спільного пакету.
  for (const row of worldAliasRows) aliasRows.push(row);

  for (const batch of chunks(aliasRows, 5000)) {
    await prisma.settlementAlias.createMany({ data: batch });
  }
  console.log(`[import] аліасів створено: ${aliasRows.length} · ${((Date.now() - t0) / 1000).toFixed(0)}с`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
