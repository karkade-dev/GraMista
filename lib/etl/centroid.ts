// Центроїд (середня точка) опорних НП — щоб дати координати населеним пунктам, яких нема в
// GeoNames (дрібні села). НП без власної точки сідає в центр своєї громади; нема опор у
// громаді — фолбек на район, далі на область. Приблизно, але «біля правильного місця» — а не
// зникає з мапи. Координати-центроїди позначаються coordsDerived=true (можна перерахувати/перекрити).

export interface CentroidMember {
  oblast: string | null;
  raion: string | null;
  hromada: string | null;
  lat: number | null;
  lon: number | null;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface CentroidIndex {
  byHromada: Map<string, LatLon>;
  byRaion: Map<string, LatLon>;
  byOblast: Map<string, LatLon>;
}

interface Acc {
  sumLat: number;
  sumLon: number;
  n: number;
}

function finalize(acc: Map<string, Acc>): Map<string, LatLon> {
  const out = new Map<string, LatLon>();
  for (const [k, a] of acc) out.set(k, { lat: a.sumLat / a.n, lon: a.sumLon / a.n });
  return out;
}

function bump(acc: Map<string, Acc>, key: string, lat: number, lon: number): void {
  const a = acc.get(key);
  if (a) {
    a.sumLat += lat;
    a.sumLon += lon;
    a.n += 1;
  } else {
    acc.set(key, { sumLat: lat, sumLon: lon, n: 1 });
  }
}

/** Будує центроїди громад/районів/областей з опорних НП (лише ті, що МАЮТЬ координати). */
export function buildCentroidIndex(members: CentroidMember[]): CentroidIndex {
  const h = new Map<string, Acc>();
  const r = new Map<string, Acc>();
  const o = new Map<string, Acc>();
  for (const m of members) {
    if (m.lat == null || m.lon == null || !m.oblast) continue;
    if (m.hromada) bump(h, `${m.oblast}|${m.hromada}`, m.lat, m.lon);
    if (m.raion) bump(r, `${m.oblast}|${m.raion}`, m.lat, m.lon);
    bump(o, m.oblast, m.lat, m.lon);
  }
  return { byHromada: finalize(h), byRaion: finalize(r), byOblast: finalize(o) };
}

/** Точка для НП без власних координат: центр громади → району → області. null — нема опор ніде. */
export function centroidFor(
  target: { oblast: string | null; raion: string | null; hromada: string | null },
  idx: CentroidIndex,
): LatLon | null {
  if (!target.oblast) return null;
  if (target.hromada) {
    const h = idx.byHromada.get(`${target.oblast}|${target.hromada}`);
    if (h) return h;
  }
  if (target.raion) {
    const r = idx.byRaion.get(`${target.oblast}|${target.raion}`);
    if (r) return r;
  }
  return idx.byOblast.get(target.oblast) ?? null;
}
