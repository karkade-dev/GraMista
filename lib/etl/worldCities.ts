import { normalize } from '../text';

export interface WorldSettlement {
  id: string;        // 'g' + geonameid (не конфліктує з КАТОТТГ-id)
  name: string;      // українська назва
  nameNorm: string;
  country: string;   // ISO-3166-1 alpha-2 (countryCode GeoNames)
  lat: number;
  lon: number;
  population: number | null;
  aliases: string[]; // інші укр. назви + кирилічні рос. написання
}

const CYRILLIC = /[а-яіїєґ]/i;

export type AltNameIndex = Map<string, { uk: string[]; ruCyr: string[] }>;

/**
 * Обробляє ОДИН рядок alternateNamesV2 у накопичувальний індекс. Стрімовий шлях: реальний файл
 * (~740 МБ) перевищує ліміт рядка JS (~512 МБ), тож в імпорті читаємо його рядково (як ВЕСУМ),
 * не цілим рядком — інакше readFileSync падає з ERR_STRING_TOO_LONG.
 */
export function addAltNameLine(idx: AltNameIndex, line: string): void {
  if (!line) return;
  const c = line.split('\t');
  const geoId = c[1];
  const lang = c[2];
  const name = (c[3] ?? '').trim();
  if (!geoId || !name) return;
  const preferred = c[4] === '1';
  let e = idx.get(geoId);
  if (!e) { e = { uk: [], ruCyr: [] }; idx.set(geoId, e); }
  if (lang === 'uk') { if (preferred) e.uk.unshift(name); else e.uk.push(name); }
  else if (lang === 'ru' && CYRILLIC.test(name)) e.ruCyr.push(name);
}

/** Українські й рос. кирилічні назви за geonameid (цілим рядком — для тестів/малих входів). */
function parseAltNames(tsv: string): AltNameIndex {
  const idx: AltNameIndex = new Map();
  for (const line of tsv.split('\n')) addAltNameLine(idx, line);
  return idx;
}

/**
 * Будує іноземні Settlement-и з cities-файлу GeoNames (TSV-рядок, ~8 МБ — ок цілим) + ГОТОВОГО
 * alt-індексу. Лишає ЛИШЕ міста, що мають українську назву (якісний фільтр кирилице-only підходу).
 */
export function buildWorldFromIndex(citiesTsv: string, alt: AltNameIndex): WorldSettlement[] {
  const out: WorldSettlement[] = [];
  for (const line of citiesTsv.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c[6] !== 'P') continue; // лише населені пункти
    if ((c[8] ?? '').trim() === 'UA') continue; // українські НП покриває КАТОТТГ — не дублюємо g<id>
    const geoId = c[0];
    const names = geoId ? alt.get(geoId) : undefined;
    if (!names || names.uk.length === 0) continue; // нема укр. назви — пропускаємо
    const lat = Number(c[4]);
    const lon = Number(c[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ukName = names.uk[0]!;
    const aliasSet = new Set<string>([...names.uk.slice(1), ...names.ruCyr]);
    aliasSet.delete(ukName);
    out.push({
      id: `g${geoId}`,
      name: ukName,
      nameNorm: normalize(ukName),
      country: (c[8] ?? '').trim(),
      lat,
      lon,
      population: Number(c[14]) > 0 ? Number(c[14]) : null,
      aliases: [...aliasSet],
    });
  }
  return out;
}

/** Зручна обгортка: alt-назви цілим рядком (тести/малі входи). Для великого файлу — buildWorldFromIndex. */
export function buildWorldSettlements(citiesTsv: string, altNamesTsv: string): WorldSettlement[] {
  return buildWorldFromIndex(citiesTsv, parseAltNames(altNamesTsv));
}
