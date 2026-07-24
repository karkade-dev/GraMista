import { readFileSync, createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { ADMIN1_TO_OBLAST } from '../lib/etl/geonames';
import { normalize } from '../lib/text';

// Одноразовий генератор курованого довідника НП Чорнобильської зони відчуження → prisma/seed-chornobyl.ts.
// Джерело — GeoNames (data/sources/, gitignored): покинуті НП (feature PPLQ) у межах зони + кілька
// відомих PPL (Дуга/Зимовище/Усів). Українські назви тягнемо з alternateNamesV2 (isolanguage=uk).
// Запуск: npx tsx scripts/gen-chornobyl-zone.ts  (потім переглянути вихідний файл очима).
const SRC = join(process.cwd(), 'data', 'sources');
const OUT = join(process.cwd(), 'prisma', 'seed-chornobyl.ts');

// Бокс зони (звірено по живих координатах Прип'яті/Чорнобиля); per-row область усе одно з admin1.
const BOX = { latMin: 50.9, latMax: 51.7, lonMin: 29.3, lonMax: 30.8 };
// Відомі НП зони, що в GeoNames мають PPL (не PPLQ) — додаємо явно за ascii-назвою.
const EXTRA_ASCII = new Set(['Chornobyl-2', 'Zymovyshche', 'Usiv']);
// Спец-дані для впізнаваних НП (geonameid → тип/історичне населення/аліаси). Населення —
// доевакуаційне (1986), бо в нас population = сигнал значущості/розміру (не «зараз живе»);
// без нього Прип'ять/Чорнобиль тонули б серед тезок і в пошуку, і в авто-розпізнаванні.
const SPECIAL: Record<string, { name?: string; type?: string; pop?: number; aliases?: string[] }> = {
  // Тип і населення відомих міст зони. Населення — реальні дані до евакуації 1986 (Прип'ять ~49 360,
  // Чорнобиль ~14 000); слугує лише сигналом значущості для ранжування пошуку (на мапу не впливає).
  '696269': { name: "Прип'ять", type: 'місто', pop: 49360, aliases: ['Pripyat', 'Prypiat', 'Припять'] },
  '710403': { name: 'Чорнобиль', type: 'місто', pop: 14000, aliases: ['Chornobyl', 'Chernobyl', 'ЧАЕС'] },
  '11280511': { name: 'Чорнобиль-2', type: 'селище', aliases: ['Дуга', 'Чорнобиль 2', 'Duga', 'Chornobyl-2'] },
};
// НП, що були селищами міського типу (районні/значні центри зони) — інакше всі «село».
const SMT_NAMES = new Set(['Поліське', 'Вільча']);

interface Target {
  gid: string;
  ascii: string;
  lat: number;
  lon: number;
  oblast: string;
  geoPop: number;
  alts: string[];
}

const CYR = /[а-яіїєґ]/i;
const NON_UK_CYR = /[ыэъёў]/i; // рос./біл. літери — ознака не-української форми

/** Найкраща українська форма серед alternatenames UA.txt (фолбек, коли в alternateNamesV2 нема uk). */
function bestCyrillic(alts: string[]): string | null {
  const cyr = alts.filter((a) => CYR.test(a));
  if (cyr.length === 0) return null;
  const uk = cyr.filter((a) => /[іїєґ']/i.test(a) && !NON_UK_CYR.test(a));
  return uk[0] ?? cyr.find((a) => !NON_UK_CYR.test(a)) ?? cyr[0] ?? null;
}

async function main(): Promise<void> {
  // 1) Цілі з UA.txt: PPLQ у боксі + явні extra за ascii.
  const targets = new Map<string, Target>();
  for (const line of readFileSync(join(SRC, 'UA.txt'), 'utf8').split('\n')) {
    const c = line.split('\t');
    if (c.length < 15 || c[6] !== 'P') continue;
    const ascii = (c[2] ?? '').trim();
    const lat = Number(c[4]);
    const lon = Number(c[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const inBox = lat >= BOX.latMin && lat <= BOX.latMax && lon >= BOX.lonMin && lon <= BOX.lonMax;
    // EXTRA теж лише в боксі — інакше by-name ловить тезок поза зоною (друге Зимовище за 60 км).
    const isTarget = inBox && (c[7] === 'PPLQ' || EXTRA_ASCII.has(ascii));
    if (!isTarget) continue;
    targets.set(c[0] ?? '', {
      gid: c[0] ?? '',
      ascii,
      lat,
      lon,
      oblast: ADMIN1_TO_OBLAST[(c[10] ?? '').trim()] ?? 'Київська',
      geoPop: Number(c[14]) || 0,
      alts: (c[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    });
  }
  console.log(`[gen] цілей із UA.txt: ${targets.size}`);

  // 2) Українські назви з alternateNamesV2 (стрімимо ~740 МБ; беремо лише наші geonameid, uk).
  const ukName = new Map<string, { name: string; pref: boolean }>();
  const rl = createInterface({
    input: createReadStream(join(SRC, 'alternateNamesV2.txt'), { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const c = line.split('\t');
    const gid = c[1];
    if (!gid || !targets.has(gid)) continue;
    if (c[2] !== 'uk') continue;
    const name = (c[3] ?? '').trim();
    // ЛИШЕ кирилична uk-форма: GeoNames часто має й романізовану uk-назву (Illintsi), яка інакше
    // перемагає справжню «Іллінці». Латиниця піде в аліаси, не в назву.
    if (!name || !CYR.test(name)) continue;
    const pref = c[4] === '1';
    const cur = ukName.get(gid);
    if (!cur || (pref && !cur.pref)) ukName.set(gid, { name, pref });
  }
  console.log(`[gen] укр. назв з alternateNamesV2: ${ukName.size}`);

  // 3) Збірка записів.
  const rows = [...targets.values()]
    .map((t) => {
      const sp = SPECIAL[t.gid] ?? {};
      const name = sp.name ?? ukName.get(t.gid)?.name ?? bestCyrillic(t.alts) ?? t.ascii;
      const nameNorm = normalize(name);
      const type = sp.type ?? (SMT_NAMES.has(name) ? 'селище міського типу' : 'село');
      const pop = sp.pop ?? (t.geoPop > 0 ? t.geoPop : null);
      // Аліаси: ascii-латиниця + кирилічні варіанти GeoNames, що відрізняються від назви + спец.
      const aliasSet = new Set<string>();
      const add = (a: string): void => {
        const an = normalize(a);
        if (an && an !== nameNorm) aliasSet.add(a);
      };
      add(t.ascii);
      for (const a of t.alts) if (CYR.test(a) && !NON_UK_CYR.test(a)) add(a);
      for (const a of sp.aliases ?? []) add(a);
      return {
        id: `cz-${t.gid}`,
        name,
        type,
        oblast: t.oblast,
        population: pop,
        lat: t.lat,
        lon: t.lon,
        aliases: [...aliasSet].slice(0, 5),
        _norm: nameNorm,
      };
    })
    .filter((r) => r._norm.length >= 2)
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0) || a.name.localeCompare(b.name, 'uk'));

  // 4) Запис TS-файлу.
  const body = rows
    .map(
      (r) =>
        `  { id: ${JSON.stringify(r.id)}, name: ${JSON.stringify(r.name)}, type: ${JSON.stringify(r.type)}, oblast: ${JSON.stringify(r.oblast)}, population: ${r.population === null ? 'null' : r.population}, lat: ${r.lat}, lon: ${r.lon}, aliases: ${JSON.stringify(r.aliases)} },`,
    )
    .join('\n');
  const file = `// АВТОЗГЕНЕРОВАНО scripts/gen-chornobyl-zone.ts — не редагувати вручну (перегенеруй).
// Курований довідник НП Чорнобильської зони відчуження (покинуті GeoNames-PPLQ + Дуга/Зимовище/Усів).
// КАТОТТГ не дає їх на рівні 4 (Прип'ять/Чорнобиль — рівень 1, решта зняті з обліку), тож сідаємо
// окремо з реальними координатами. Упсертять prisma/seed.ts і prisma/import-settlements.ts.

export interface ZoneSettlement {
  id: string;
  name: string;
  type: string;
  oblast: string;
  population: number | null;
  lat: number;
  lon: number;
  aliases: string[];
}

export const CHORNOBYL_ZONE: ZoneSettlement[] = [
${body}
];
`;
  writeFileSync(OUT, file, 'utf8');
  console.log(`[gen] записано ${rows.length} НП → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
