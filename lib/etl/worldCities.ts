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

/** Українські й рос. кирилічні назви за geonameid з alternateNamesV2.txt (стрімиться рядково в проді). */
function parseAltNames(tsv: string): Map<string, { uk: string[]; ruCyr: string[] }> {
  const idx = new Map<string, { uk: string[]; ruCyr: string[] }>();
  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const geoId = c[1];
    const lang = c[2];
    const name = (c[3] ?? '').trim();
    if (!geoId || !name) continue;
    const preferred = c[4] === '1';
    let e = idx.get(geoId);
    if (!e) { e = { uk: [], ruCyr: [] }; idx.set(geoId, e); }
    if (lang === 'uk') { if (preferred) e.uk.unshift(name); else e.uk.push(name); }
    else if (lang === 'ru' && CYRILLIC.test(name)) e.ruCyr.push(name);
  }
  return idx;
}

/**
 * Будує іноземні Settlement-и з cities-файлу GeoNames (TSV) + alternateNamesV2.
 * Лишає ЛИШЕ міста, що мають українську назву (якісний фільтр кирилице-only підходу).
 */
export function buildWorldSettlements(citiesTsv: string, altNamesTsv: string): WorldSettlement[] {
  const alt = parseAltNames(altNamesTsv);
  const out: WorldSettlement[] = [];
  for (const line of citiesTsv.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c[6] !== 'P') continue; // лише населені пункти
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
