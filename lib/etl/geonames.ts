import { normalize } from '../text';

// GeoNames UA.txt: TSV 19 колонок. Основна назва — латиниця; кирилиця — в alternatenames.
export interface GeoPlace {
  nameAscii: string;
  alternates: string[];
  lat: number;
  lon: number;
  admin1: string;
  population: number;
}

// admin1-код GeoNames → область у форматі нашого довідника (звірено з admin1CodesASCII.txt).
export const ADMIN1_TO_OBLAST: Record<string, string> = {
  '01': 'Черкаська', '02': 'Чернігівська', '03': 'Чернівецька', '04': 'Дніпропетровська',
  '05': 'Донецька', '06': 'Івано-Франківська', '07': 'Харківська', '08': 'Херсонська',
  '09': 'Хмельницька', '10': 'Кіровоградська', '11': 'Автономна Республіка Крим', '12': 'м. Київ',
  '13': 'Київська', '14': 'Луганська', '15': 'Львівська', '16': 'Миколаївська', '17': 'Одеська',
  '18': 'Полтавська', '19': 'Рівненська', '20': 'м. Севастополь', '21': 'Сумська',
  '22': 'Тернопільська', '23': 'Вінницька', '24': 'Волинська', '25': 'Закарпатська',
  '26': 'Запорізька', '27': 'Житомирська',
};

export function parseGeonames(tsvText: string): GeoPlace[] {
  const out: GeoPlace[] = [];
  for (const line of tsvText.split('\n')) {
    const c = line.split('\t');
    if (c.length < 15 || c[6] !== 'P') continue;
    const lat = Number(c[4]);
    const lon = Number(c[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      nameAscii: (c[2] ?? '').trim(),
      alternates: (c[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      lat,
      lon,
      admin1: (c[10] ?? '').trim(),
      population: Number(c[14]) || 0,
    });
  }
  return out;
}

export interface GeoEnrich {
  lat: number;
  lon: number;
  population: number | null;
  /** Кандидати в аліаси: кирилічні варіанти (укр/рос) + латинська назва. ≤6. */
  aliasCandidates: string[];
  /** Кілька РІЗНИХ точок під одним ключем (тезки в одній області). */
  ambiguous: boolean;
  /**
   * Чи можна довіряти lat/lon: одинокий НП АБО серед тезок є ЧІТКИЙ лідер за населенням
   * (тоді беремо точку лідера — напр. місто Долина проти сіл-тезок). false — лідера нема
   * (рівне/нульове населення); тоді координат не виводимо, а імпорт ставить центр громади.
   */
  coordsReliable: boolean;
}

const CYRILLIC = /[а-яіїєґ]/i;

/**
 * Індекс (нормалізована назва|область) → збагачення. Ключем стає КОЖЕН кирилічний варіант назви
 * (укр напис серед alternatenames — головний шлях зустрічі з КАТОТТГ-назвою).
 *
 * Тезки в одній області неминучі (ключ — лише назва+область, без району). Замість викидати
 * координати в усіх, лишаємо точку НАЙБІЛЬШОГО за населенням НП: донат «Долина» розумніше
 * показати на місті Долина (20 тис.), ніж ніде. Якщо лідера нема (усі без населення) —
 * coordsReliable=false, і остаточну точку дасть центроїд громади на етапі імпорту.
 */
export function buildGeoIndex(places: GeoPlace[]): Map<string, GeoEnrich> {
  const idx = new Map<string, GeoEnrich>();
  for (const p of places) {
    const oblast = ADMIN1_TO_OBLAST[p.admin1];
    if (!oblast) continue;
    const cyr = p.alternates.filter((a) => CYRILLIC.test(a));
    const aliasCandidates = [...new Set([...cyr, p.nameAscii].filter(Boolean))].slice(0, 6);
    const pop = p.population > 0 ? p.population : null;
    for (const key of new Set(cyr.map((a) => `${normalize(a)}|${oblast}`))) {
      const prev = idx.get(key);
      if (!prev) {
        idx.set(key, { lat: p.lat, lon: p.lon, population: pop, aliasCandidates, ambiguous: false, coordsReliable: true });
      } else if (Math.abs(prev.lat - p.lat) > 0.05 || Math.abs(prev.lon - p.lon) > 0.05) {
        prev.ambiguous = true; // тезки в одній області
        const a = pop ?? 0;
        const b = prev.population ?? 0;
        if (a > b) {
          // новий НП більший — він стає опорною точкою (чіткий лідер).
          prev.lat = p.lat;
          prev.lon = p.lon;
          prev.population = pop;
          prev.coordsReliable = true;
        } else if (a === b) {
          // рівне (часто 0=0) — лідера на вершині нема, координатам не довіряємо.
          prev.coordsReliable = false;
        }
        // a < b — поточний лідер сильніший, лишаємо його (coordsReliable не змінюємо).
      }
    }
  }
  return idx;
}
