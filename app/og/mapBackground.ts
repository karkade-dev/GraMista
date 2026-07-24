import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Мапа України як фон OG-картинок: SVG (контур + крапки міст з донатами) вкладається
// data-URI у backgroundImage — satori растеризує його без браузера й без MapLibre.

export interface OgMapPoint {
  lat: number;
  lon: number;
  /** «Вага» міста (бали або ₴) — керує радіусом крапки. */
  points: number;
}

/**
 * Цільовий бокс рендеру мапи. За замовчуванням — полотно OG (1200×630, фон посилань).
 * Картинка-звіт передає власні розміри, щоб малювати мапу як `<img>` будь-де (праворуч у
 * горизонті, по центру в решті). label — підпис топ-1 міста над його крапкою.
 */
export interface MapBox {
  width: number;
  height: number;
  pad?: number;
  label?: { lat: number; lon: number; text: string };
  /**
   * «Соковитий» режим для картинок-звіту (мапа — герой, не фон): контур читабельніший,
   * міста світяться (ореол + яскраве ядро). За замовч. вимкнено — публічні OG-фони лишаються
   * тихими, щоб не перебивати текст поверх них.
   */
  vivid?: boolean;
}

export const OG_W = 1200;
export const OG_H = 630;
const PAD = 48;
const R_MIN = 4;
const R_MAX = 16;

/** Зовнішнє кільце полігона: список [lon, lat]. */
type Ring = [number, number][];

/** Екранування тексту мітки для XML/SVG (назва міста може містити & чи кутові дужки). */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Projection {
  px: (lon: number) => number;
  py: (lat: number) => number;
  inBbox: (lon: number, lat: number) => boolean;
  W: number;
  H: number;
  PADp: number;
}

/**
 * Еквіректангулярна проєкція під цільовий бокс із поправкою cos(середньої широти) (без неї
 * градус довготи «важить» як градус широти й Україну сплющує). Полотно фітиться під bbox контуру;
 * точка поза bbox (випадковий закордон/рф) лягла б за межі — inBbox відсікає (захист углиб).
 * Спільне для контуру, крапок і зовнішнього підпису (projectToBox) — єдине джерело проєкції.
 */
function boxProjection(rings: Ring[], box: MapBox): Projection {
  const W = box.width;
  const H = box.height;
  const PADp = box.pad ?? PAD;

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  const cosLat = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = (maxLon - minLon) * cosLat;
  const spanY = maxLat - minLat;
  const k = Math.min((W - 2 * PADp) / spanX, (H - 2 * PADp) / spanY);
  const offX = (W - spanX * k) / 2;
  const offY = (H - spanY * k) / 2;
  return {
    px: (lon: number) => offX + (lon - minLon) * cosLat * k,
    py: (lat: number) => offY + (maxLat - lat) * k,
    inBbox: (lon: number, lat: number) => lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat,
    W,
    H,
    PADp,
  };
}

/** Чистий будівник (без fs) — щоб тести могли підсунути синтетичний контур. */
export function buildMapSvg(
  rings: Ring[],
  points: OgMapPoint[],
  box: MapBox = { width: OG_W, height: OG_H },
): string {
  const { px, py, inBbox, W, H, PADp } = boxProjection(rings, box);

  const path = rings
    .map((ring) => 'M' + ring.map(([lon, lat]) => `${px(lon).toFixed(1)} ${py(lat).toFixed(1)}`).join('L') + 'Z')
    .join('');

  const inside = points.filter((p) => inBbox(p.lon, p.lat));

  // Радіус ∝ √ваги, нормовано до найбільшого міста — як розмір крапок на живій мапі.
  // reduce, а не spread у Math.max — на великих наборах spread дав би RangeError (переповнення стека).
  const vivid = box.vivid ?? false;
  const rMin = vivid ? 3.5 : R_MIN;
  const rMax = vivid ? 11 : R_MAX;
  const maxP = inside.reduce((m, p) => Math.max(m, p.points), 0);
  const circles = inside
    .map((p) => {
      const r = maxP > 0 ? rMin + (rMax - rMin) * Math.sqrt(Math.max(p.points, 0) / maxP) : rMin;
      const cx = px(p.lon).toFixed(1);
      const cy = py(p.lat).toFixed(1);
      if (!vivid) {
        return `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="#E2A878" fill-opacity="0.55"/>`;
      }
      // Місто-крапка: тонкий тісний ореол + чітке яскраве ядро (без «мулявого» широкого сяйва).
      // Тонкий темний обідок відділяє ядро від сусідів, коли крапки злипаються (захід/Дніпро).
      return (
        `<circle cx="${cx}" cy="${cy}" r="${(r * 1.55).toFixed(1)}" fill="#E2A878" fill-opacity="0.16"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${(r + 1).toFixed(1)}" fill="#1B1714" fill-opacity="0.55"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="#F0C79A"/>`
      );
    })
    .join('');
  // Контур: у vivid читабельніший (світліша заливка + виразніший край), у фоновому — тихий.
  const mapStroke = vivid ? '#7A6249' : '#3A2F26';
  const mapStrokeW = vivid ? 2.5 : 2;
  // Заливка суходолу: у vivid — радіальний градієнт (світліший теплий центр → темніші краї),
  // щоб країна читалась об'ємно й відділялась від фону; у фоновому режимі — плаский тон.
  let defs = '';
  let mapFill: string;
  if (vivid) {
    const gcx = (W / 2).toFixed(0);
    const gcy = (H * 0.46).toFixed(0);
    const gr = (Math.max(W, H) * 0.62).toFixed(0);
    defs =
      `<defs><radialGradient id="land" gradientUnits="userSpaceOnUse" cx="${gcx}" cy="${gcy}" r="${gr}">` +
      `<stop offset="0" stop-color="#3B322B"/><stop offset="0.65" stop-color="#2E271F"/>` +
      `<stop offset="1" stop-color="#241D18"/></radialGradient></defs>`;
    mapFill = 'url(#land)';
  } else {
    mapFill = '#241E19';
  }

  // Підпис топ-1 міста над його крапкою; x клампимо в межі боксу, щоб місто біля краю
  // (Ужгород/Луганськ) не вилазило за полотно.
  let label = '';
  if (box.label && inBbox(box.label.lon, box.label.lat)) {
    const fs = Math.round(H * 0.05);
    const lx = Math.min(Math.max(px(box.label.lon), PADp), W - PADp);
    const ly = py(box.label.lat) - 12;
    label =
      `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" ` +
      `fill="#F3E9DF" font-weight="700" font-size="${fs}">${esc(box.label.text)}</text>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    defs +
    `<path d="${path}" fill="${mapFill}" stroke="${mapStroke}" stroke-width="${mapStrokeW}"/>` +
    circles +
    label +
    `</svg>`
  );
}

interface OutlineGeo {
  features: { geometry: { type: string; coordinates: unknown } }[];
}

let ringsCache: Ring[] | null = null;
function outlineRings(): Ring[] {
  if (!ringsCache) {
    const file = join(process.cwd(), 'public', 'geo', 'ukraine-outline.geojson');
    const geo = JSON.parse(readFileSync(file, 'utf8')) as OutlineGeo;
    ringsCache = geo.features.flatMap((f) => {
      if (f.geometry.type === 'Polygon') return f.geometry.coordinates as Ring[];
      if (f.geometry.type === 'MultiPolygon') return (f.geometry.coordinates as Ring[][]).flat();
      return [];
    });
  }
  return ringsCache;
}

/** Готове значення для CSS backgroundImage кореневого div OG-картки. */
export function mapBackground(points: OgMapPoint[]): string {
  const svg = buildMapSvg(outlineRings(), points);
  return `url(data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')})`;
}

/** Мапа під заданий бокс як `data:`-URI для `<img>` у layout картинки-звіту. */
export function mapImageDataUri(points: OgMapPoint[], box: MapBox): string {
  const svg = buildMapSvg(outlineRings(), points, box);
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/**
 * Пікселі точки в межах боксу мапи (та сама проєкція, що й крапки) — щоб покласти підпис
 * топ-1 міста як HTML-елемент поверх мапи. resvg не малює <text> із вкладеного SVG, тож підпис
 * робимо в satori-розкладці, а не в самому SVG. null — точка поза контуром України.
 */
export function projectToBox(box: MapBox, lon: number, lat: number): { x: number; y: number } | null {
  const p = boxProjection(outlineRings(), box);
  if (!p.inBbox(lon, lat)) return null;
  return { x: p.px(lon), y: p.py(lat) };
}
