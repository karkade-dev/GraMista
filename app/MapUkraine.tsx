'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {
  Map as MlMap,
  GeoJSONSource,
  Popup as MlPopup,
  Marker as MlMarker,
  StyleSpecification,
  CircleLayerSpecification,
  SymbolLayerSpecification,
  MapLayerMouseEvent,
  ExpressionSpecification,
} from 'maplibre-gl';
import type { MapPoint, DonationFlash } from '@/lib/map';
import { formatUah, formatUahWhole, formatPoints, pluralBaliv } from '@/lib/format';

// Неймспейс maplibre-gl (іменований експорт Marker — для маркера спалаху).
type MaplibreModule = typeof import('maplibre-gl');

// Тепла темна гама — узгоджена з токенами app/globals.css.
const SEA = '#1B1714'; // --bg (фон поза сушею)
const LAND = '#221C17'; // суша трохи світліша за фон
const OBLAST_LINE = '#3A2F26'; // --line (межі областей)
const COUNTRY_LINE = '#5A4636'; // контур України — світліший за межі областей

// Рамка України для автокадрування (lon/lat).
const UKRAINE_BOUNDS: [[number, number], [number, number]] = [
  [22.0, 44.2],
  [40.3, 52.5],
];

// Безкоштовні гліфи (для підписів областей/міст і чисел у кластерах). Якщо не завантажаться —
// текст просто не намалюється, решта мапи (фон/точки) працює; вона своїх шрифтів не потребує.
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

// Шкала радіусів: логарифм від поточного максимуму з контрастом γ.
// r = R_MIN + (R_MAX − R_MIN) · (ln(1+бали)/ln(1+балиЛідера))^γ — лідер завжди R_MAX,
// великий відрив видно (γ розтягує верх шкали), дрібні міста не зникають (R_MIN).
const R_MIN = 2.5;
const R_MAX = 13;
const GAMMA = 3;
const GLOW_K = 2.2; // світіння — у стільки разів ширше за крапку

// Кільця топ-3 — яскравіші за токени --gold/--silver/--bronze, бо заливка великих
// крапок сама золотиста (#E0B66B) і кільце в тон зливалося б із нею.
const RING_GOLD = '#FFD75E';
const RING_SILVER = '#E5DED5';
const RING_BRONZE = '#C77B3B';

// Радіус крапки від балів (×k — для світіння). Залежить від поточного максимуму, тож
// перераховується на кожне оновлення даних (applyRadiusScale), а не задається статично в paint.
// ['zoom'] у MapLibre дозволений лише в інтерполяції ВЕРХНЬОГО рівня, тому множник k
// заноситься всередину виходів інтерполяції, а не обгортає її.
function radiusExpr(maxPoints: number, k: number): ExpressionSpecification | number {
  if (!(maxPoints > 0)) return R_MIN * k;
  const share: ExpressionSpecification = [
    '/',
    ['ln', ['+', 1, ['get', 'points']]],
    Math.log(1 + maxPoints),
  ];
  const base: ExpressionSpecification = ['+', R_MIN, ['*', R_MAX - R_MIN, ['^', share, GAMMA]]];
  // Легкий ріст із зумом: на плані країни компактно (великі міста не закривають сусідів),
  // при наближенні до регіону крапки виразніші.
  return ['interpolate', ['linear'], ['zoom'], 5, ['*', base, k], 8, ['*', base, 1.6 * k]];
}

// Перерахунок радіусів крапок і світіння під поточний максимум балів.
function applyRadiusScale(map: MlMap, points: MapPoint[]) {
  const maxPoints = points.reduce((m, p) => Math.max(m, p.points), 0);
  const dot = radiusExpr(maxPoints, 1);
  const glow = radiusExpr(maxPoints, GLOW_K);
  for (const id of ['pts-dots', 'cl-uncl-dots']) {
    if (map.getLayer(id)) map.setPaintProperty(id, 'circle-radius', dot);
  }
  for (const id of ['pts-glow', 'cl-uncl-glow']) {
    if (map.getLayer(id)) map.setPaintProperty(id, 'circle-radius', glow);
  }
}

// Світіння під крапкою + сама крапка — спільні для режиму «Точки» й одиночних точок у кластерному
// джерелі. Радіуси сюди не входять — їх ставить applyRadiusScale від поточного максимуму.
const GLOW_PAINT: CircleLayerSpecification['paint'] = {
  'circle-color': ['case', ['get', 'abroad'], '#5DCAA5', '#E2A878'],
  'circle-blur': 1,
  'circle-opacity': 0.35,
  'circle-radius': R_MIN * GLOW_K,
};
const DOT_PAINT: CircleLayerSpecification['paint'] = {
  'circle-color': [
    'case', ['get', 'abroad'], '#5DCAA5',
    ['interpolate', ['linear'], ['get', 'points'], 0.2, '#C08A5E', 3, '#E2A878', 8, '#EBCB82', 15, '#E0B66B'],
  ],
  'circle-radius': R_MIN,
  // Топ-3 за балами — золоте/срібне/бронзове кільце, решта — тонкий темний обідок.
  'circle-stroke-width': ['match', ['get', 'rank'], [1, 2, 3], 2, 0.6],
  'circle-stroke-color': [
    'match',
    ['get', 'rank'],
    1, RING_GOLD,
    2, RING_SILVER,
    3, RING_BRONZE,
    'rgba(0,0,0,.35)',
  ],
};

// Підпис міста: під крапкою, ховається при накладанні (text-optional) — спільний для обох режимів.
const CITY_LABEL_LAYOUT: SymbolLayerSpecification['layout'] = {
  'text-field': ['get', 'name'],
  'text-font': ['Noto Sans Bold'],
  'text-size': 12,
  'text-anchor': 'top',
  'text-offset': [0, 0.8],
  'text-optional': true,
  // Менший ключ = вищий пріоритет при накладанні: підписи топ-3 виграють колізії в дрібноти.
  'symbol-sort-key': ['case', ['>', ['get', 'rank'], 0], ['get', 'rank'], 1000],
  visibility: 'none',
};
const CITY_LABEL_PAINT: SymbolLayerSpecification['paint'] = {
  'text-color': '#F3E9DF',
  'text-halo-color': 'rgba(0,0,0,.7)',
  'text-halo-width': 1.3,
};

// М'який старт/стоп для польоту камери (а не лінійно): ease-in-out cubic.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type Mode = 'points' | 'clusters';
type LabelMode = 'none' | 'oblast' | 'all';

function toFeatureCollection(points: MapPoint[]) {
  // rank 1–3 — місце в топі за балами (кільце + пріоритет підпису), 0 — поза топом.
  const top3 = [...points]
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((p) => p.id);
  return {
    type: 'FeatureCollection' as const,
    features: points.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      properties: { id: p.id, name: p.name, points: p.points, rank: top3.indexOf(p.id) + 1, abroad: p.abroad },
    })),
  };
}

// Єдине джерело правди видимості шарів від (режим × підписи). Підписи областей не залежать
// від режиму; підписи міст показуємо лише в «Області + міста» і для активного режиму точок/кластерів.
function applyVisibility(map: MlMap, mode: Mode, labels: LabelMode) {
  const set = (id: string, on: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  };
  const pts = mode === 'points';
  set('oblast-labels', labels !== 'none');
  set('pts-glow', pts);
  set('pts-dots', pts);
  set('city-labels', pts && labels === 'all');
  set('cl-uncl-glow', !pts);
  set('cl-uncl-dots', !pts);
  set('cl-circles', !pts);
  set('cl-count', !pts);
  set('cl-uncl-labels', !pts && labels === 'all');
}

export interface MapUkraineProps {
  points: MapPoint[];
  /** Початковий стан підписів (потім користувач може перемкнути, якщо showControls). */
  initialLabels?: LabelMode;
  /** Початковий режим точок/кластерів. */
  initialView?: Mode;
  /** Чи показувати перемикачі на мапі. false — для OBS/фіксованого вигляду (конфіг ззовні). */
  showControls?: boolean;
  /** Публічний контекст: клік на місто → колбек (відкрити картку) замість навігації на /city. */
  onCitySelect?: (settlementId: string) => void;
  /** Мапа сама плавно летить до міста на подію gramista:city (клік у топі/стрічці/мапі). Лише публічна сторінка. */
  flyToSelectedCity?: boolean;
  /** Показувати шар кордонів світу й дозволити віддалення (для стрімерів з abroadWorldMap). */
  world?: boolean;
  /**
   * Одиниця значення крапки в попапі: 'points' — бали (мапа стрімера, дефолт),
   * 'uah' — гривні (глобальна мапа /ukraine, де в points закладено суму ₴).
   */
  valueUnit?: 'points' | 'uah';
}

export function MapUkraine({
  points,
  initialLabels = 'all',
  initialView = 'points',
  showControls = true,
  onCitySelect,
  flyToSelectedCity = false,
  world = false,
  valueUnit = 'points',
}: MapUkraineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const mlRef = useRef<MaplibreModule | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  const focusMarkerRef = useRef<MlMarker | null>(null);
  const readyRef = useRef(false);
  const [mode, setMode] = useState<Mode>(initialView);
  const [labels, setLabels] = useState<LabelMode>(initialLabels);
  // Завжди найсвіжіші значення — щоб обробник 'load' узяв актуальні дані/режим/підписи,
  // навіть якщо вони змінилися до завершення ініціалізації.
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  // Навігація з попапа міста на /city/[id] — лише в інтерактивному (панельному) контексті.
  // В OBS/публічному вигляді (showControls=false) мапа лишається статичною сценою.
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const interactiveRef = useRef(showControls);
  interactiveRef.current = showControls;
  const onCitySelectRef = useRef(onCitySelect);
  onCitySelectRef.current = onCitySelect;
  const valueUnitRef = useRef(valueUnit);
  valueUnitRef.current = valueUnit;
  const worldRef = useRef(world);
  worldRef.current = world;

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | undefined;

    (async () => {
      // Динамічний import — maplibre-gl чіпає window, тож вантажимо лише в браузері.
      const mod = await import('maplibre-gl');
      const maplibregl = mod.default;
      if (cancelled || !containerRef.current) return;
      mlRef.current = mod; // неймспейс із Marker — для маркера спалаху

      // Абстрактний стиль без вуличних тайлів: лише фон-колір, далі домалюємо GeoJSON.
      const style: StyleSpecification = {
        version: 8,
        glyphs: GLYPHS,
        sources: {},
        layers: [{ id: 'sea', type: 'background', paint: { 'background-color': SEA } }],
      };

      map = new maplibregl.Map({
        container: containerRef.current,
        style,
        bounds: UKRAINE_BOUNDS,
        fitBoundsOptions: { padding: 18 },
        minZoom: worldRef.current ? 2.5 : 4,
        maxZoom: 9,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
        // compact: false — інакше у вузькому контейнері MapLibre перемикає атрибуцію в compact-режим,
        // чиї дефолтні стилі (білий фон + кнопка ⓘ) перекривають наші темні в каскаді.
        attributionControl: { compact: false, customAttribution: 'Межі: geoBoundaries (CC BY 4.0)' },
      });
      map.touchZoomRotate.disableRotation();
      mapRef.current = map;
      const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 12 });
      popupRef.current = popup;

      map.on('load', () => {
        if (cancelled || !map) return;
        const fc = toFeatureCollection(pointsRef.current);

        // Шар кордонів світу — ПІД Україною (нижче land/oblast/country шарів), приглушено.
        // Україна лишається деталізованою й найяскравішою; фокус кадру — UKRAINE_BOUNDS.
        if (worldRef.current) {
          map.addSource('world', { type: 'geojson', data: '/geo/world-countries.geojson' });
          map.addLayer({ id: 'world-land', type: 'fill', source: 'world', paint: { 'fill-color': '#1E1813' } });
          map.addLayer({ id: 'world-borders', type: 'line', source: 'world', paint: { 'line-color': '#2E2620', 'line-width': 0.5 } });
        }

        // Фон: заливка суші + межі областей + виразніший контур країни.
        map.addSource('oblasts', { type: 'geojson', data: '/geo/ukraine-oblasts.geojson' });
        map.addSource('outline', { type: 'geojson', data: '/geo/ukraine-outline.geojson' });
        map.addLayer({ id: 'land', type: 'fill', source: 'oblasts', paint: { 'fill-color': LAND } });
        map.addLayer({
          id: 'oblast-borders',
          type: 'line',
          source: 'oblasts',
          paint: { 'line-color': OBLAST_LINE, 'line-width': 0.7 },
        });
        map.addLayer({
          id: 'country',
          type: 'line',
          source: 'outline',
          paint: { 'line-color': COUNTRY_LINE, 'line-width': 1.4 },
        });

        // Підписи областей (укр. nameUa) — приглушено, під крапками міст.
        map.addLayer({
          id: 'oblast-labels',
          type: 'symbol',
          source: 'oblasts',
          layout: {
            'text-field': ['get', 'nameUa'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-letter-spacing': 0.04,
            'text-transform': 'uppercase',
            visibility: 'none',
          },
          paint: { 'text-color': '#8C7B6B', 'text-halo-color': 'rgba(0,0,0,.55)', 'text-halo-width': 1.1 },
        });

        // Режим «Точки»: усі міста — окремі крапки (незалежно від зуму).
        map.addSource('cities', { type: 'geojson', data: fc });
        map.addLayer({ id: 'pts-glow', type: 'circle', source: 'cities', paint: GLOW_PAINT });
        map.addLayer({ id: 'pts-dots', type: 'circle', source: 'cities', paint: DOT_PAINT });

        // Режим «Згруповано»: те саме джерело з кластеризацією. Близькі міста зливаються в
        // кружок із числом; наближаєш — розпадаються на окремі крапки.
        map.addSource('cities-cl', {
          type: 'geojson',
          data: fc,
          cluster: true,
          clusterRadius: 46,
          clusterMaxZoom: 8,
        });
        map.addLayer({
          id: 'cl-uncl-glow',
          type: 'circle',
          source: 'cities-cl',
          filter: ['!', ['has', 'point_count']],
          paint: GLOW_PAINT,
          layout: { visibility: 'none' },
        });
        map.addLayer({
          id: 'cl-uncl-dots',
          type: 'circle',
          source: 'cities-cl',
          filter: ['!', ['has', 'point_count']],
          paint: DOT_PAINT,
          layout: { visibility: 'none' },
        });
        map.addLayer({
          id: 'cl-circles',
          type: 'circle',
          source: 'cities-cl',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': 'rgba(208,135,90,.22)',
            'circle-stroke-color': '#E2A878',
            'circle-stroke-width': 1.4,
            'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 14, 10, 22, 40, 34],
          },
          layout: { visibility: 'none' },
        });
        map.addLayer({
          id: 'cl-count',
          type: 'symbol',
          source: 'cities-cl',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 12,
            visibility: 'none',
          },
          paint: { 'text-color': '#F3E9DF' },
        });

        // Підписи міст — поверх крапок. Окремі шари для режимів точок і кластерів
        // (у кластерному джерелі підписуємо лише НЕзгруповані міста).
        map.addLayer({ id: 'city-labels', type: 'symbol', source: 'cities', layout: CITY_LABEL_LAYOUT, paint: CITY_LABEL_PAINT });
        map.addLayer({
          id: 'cl-uncl-labels',
          type: 'symbol',
          source: 'cities-cl',
          filter: ['!', ['has', 'point_count']],
          layout: CITY_LABEL_LAYOUT,
          paint: CITY_LABEL_PAINT,
        });

        // Клік на місто (у будь-якому режимі) → попап назва + бали.
        const showCityPopup = (e: MapLayerMouseEvent) => {
          if (!map) return;
          const f = e.features?.[0];
          if (!f) return;
          const id = String(f.properties?.id ?? '');
          const name = String(f.properties?.name ?? '');
          const pts = Number(f.properties?.points ?? 0);
          const geom = f.geometry as { type: 'Point'; coordinates: [number, number] };
          const el = document.createElement('div');
          el.className = 'map-pop';
          const nameEl = document.createElement('strong');
          nameEl.textContent = name;
          const ptsEl = document.createElement('span');
          // /ukraine закладає в points суму ₴ — там показуємо гривні, не бали.
          ptsEl.textContent =
            valueUnitRef.current === 'uah' ? formatUahWhole(pts) : `${formatPoints(pts)} ${pluralBaliv(pts)}`;
          el.append(nameEl, ptsEl);

          // Публічний контекст: «деталі міста →» відкриває картку через колбек (без переходів).
          if (onCitySelectRef.current && id) {
            const cta = document.createElement('a');
            cta.className = 'map-pop-cta';
            cta.href = '#';
            cta.textContent = 'деталі міста →';
            cta.addEventListener('click', (ev) => {
              ev.preventDefault();
              onCitySelectRef.current?.(id);
            });
            el.append(cta);
          // У панелі — клікабельне «деталі міста →» на маршрут /city/[id] (клієнтська навігація).
          } else if (interactiveRef.current && id) {
            const href = `/city/${encodeURIComponent(id)}`;
            const cta = document.createElement('a');
            cta.className = 'map-pop-cta';
            cta.href = href;
            cta.textContent = 'деталі міста →';
            cta.addEventListener('click', (ev) => {
              // Модифікатори/середня кнопка → лишаємо браузеру (нова вкладка), як robить next/link.
              if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
              ev.preventDefault();
              routerRef.current.push(href);
            });
            el.append(cta);
          }

          popup.setLngLat(geom.coordinates).setDOMContent(el).addTo(map);
        };
        map.on('click', 'pts-dots', showCityPopup);
        map.on('click', 'cl-uncl-dots', showCityPopup);

        // Клік на кластер → наблизити, щоб він розпався.
        map.on('click', 'cl-circles', (e) => {
          if (!map) return;
          const f = e.features?.[0];
          const clusterId = f?.properties?.cluster_id;
          if (clusterId == null) return;
          const src = map.getSource('cities-cl') as GeoJSONSource;
          const geom = f!.geometry as { type: 'Point'; coordinates: [number, number] };
          src.getClusterExpansionZoom(clusterId).then((zoom) => {
            map!.easeTo({ center: geom.coordinates, zoom });
          });
        });

        // Курсор-вказівник над клікабельними елементами.
        for (const id of ['pts-dots', 'cl-uncl-dots', 'cl-circles']) {
          map.on('mouseenter', id, () => {
            if (map) map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', id, () => {
            if (map) map.getCanvas().style.cursor = '';
          });
        }

        readyRef.current = true;
        applyVisibility(map, modeRef.current, labelsRef.current);
        applyRadiusScale(map, pointsRef.current);
        map.resize();
      });
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      popupRef.current?.remove();
      popupRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Зміна даних (період / перезавантаження) — оновлюємо обидва джерела, не перестворюючи мапу.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const fc = toFeatureCollection(points);
    (map.getSource('cities') as GeoJSONSource | undefined)?.setData(fc);
    (map.getSource('cities-cl') as GeoJSONSource | undefined)?.setData(fc);
    applyRadiusScale(map, points);
  }, [points]);

  // Перемикання режиму або підписів — оновлюємо видимість шарів.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    popupRef.current?.remove();
    applyVisibility(map, mode, labels);
  }, [mode, labels]);

  // «Спалах» міста на новий донат (варіант Б): пульс-кільце + плашка «Місто +сума».
  // Подію шле LiveRefresh з SSE; малюємо тимчасовий HTML-маркер і прибираємо по завершенні анімації.
  useEffect(() => {
    const active = new Set<MlMarker>();

    const onFlash = (e: Event) => {
      const map = mapRef.current;
      const ml = mlRef.current;
      if (!map || !ml || !readyRef.current) return;
      const f = (e as CustomEvent).detail as DonationFlash | undefined;
      if (!f) return;

      const el = document.createElement('div');
      el.className = 'map-flash';
      const ring = document.createElement('span');
      ring.className = 'mf-ring';
      const badge = document.createElement('span');
      badge.className = 'mf-badge';
      const nameEl = document.createElement('span');
      nameEl.textContent = `${f.name} `;
      const amtEl = document.createElement('b');
      amtEl.textContent = `+${formatUah(f.amountUah)}`;
      badge.append(nameEl, amtEl);
      el.append(ring, badge);

      if (f.newCity) {
        el.classList.add('newcity');
        const ring2 = document.createElement('span');
        ring2.className = 'mf-ring r2';
        el.append(ring2);
        const newEl = document.createElement('span');
        newEl.className = 'mf-new';
        newEl.textContent = '🎉 нове місто!';
        badge.append(newEl);
      }

      const marker = new ml.Marker({ element: el, anchor: 'center' }).setLngLat([f.lon, f.lat]).addTo(map);
      active.add(marker);
      window.setTimeout(() => {
        marker.remove();
        active.delete(marker);
      }, f.newCity ? 2600 : 1800); // = тривалість CSS-анімації плашки (святкова довша)
    };

    window.addEventListener('gramista:flash', onFlash);
    return () => {
      window.removeEventListener('gramista:flash', onFlash);
      for (const m of active) m.remove(); // прибрати недограні маркери при розмонтуванні
    };
  }, []);

  // Політ камери до обраного міста (клік у топі/стрічці/попапі мапи) — лише на публічній сторінці.
  // flyTo з кривою ван Вейка (curve 1.42): зум+пан зливаються в плавну дугу, бере орієнтацію навіть
  // на далекому переході. essential НЕ ставимо → flyTo сам поважає prefers-reduced-motion (миттєвий стрибок).
  useEffect(() => {
    if (!flyToSelectedCity) return;
    const onCity = (e: Event) => {
      const map = mapRef.current;
      const ml = mlRef.current;
      if (!map || !ml || !readyRef.current) return;
      const id = (e as CustomEvent<{ settlementId: string }>).detail?.settlementId;
      if (!id) return;
      const p = pointsRef.current.find((pt) => pt.id === id);
      if (!p) return; // міста нема на мапі (нема координат / закордон при вимкненій світ.мапі) — лишаємо камеру, картка все одно відкриється

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const w = map.getContainer().clientWidth;
      const desktop = w >= 760;
      map.flyTo({
        center: [p.lon, p.lat],
        zoom: Math.max(map.getZoom(), 6.5), // не віддаляємо, якщо вже ближче; інакше регіональний кадр
        curve: 1.42,
        speed: 0.85,
        maxDuration: 2400,
        easing: easeInOutCubic,
        // Зсув центру праворуч-вгору: ліворуч плавають панелі, внизу-праворуч картка міста (десктоп).
        offset: desktop ? [Math.min(w * 0.16, 170), -28] : [0, 0],
      });

      // Мобільний: мапа — блок зверху, список прокручений нижче. Піднімаємо мапу у в'юпорт.
      if (!desktop) map.getContainer().scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });

      // Пульс-підсвітка обраного міста (реюз стилю спалаху, без плашки-суми). Тримаємо один focus-маркер.
      focusMarkerRef.current?.remove();
      const el = document.createElement('div');
      el.className = 'map-flash';
      const ring = document.createElement('span');
      ring.className = 'mf-ring';
      el.append(ring);
      const marker = new ml.Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map);
      focusMarkerRef.current = marker;
      window.setTimeout(() => {
        marker.remove();
        if (focusMarkerRef.current === marker) focusMarkerRef.current = null;
      }, 1500); // = тривалість анімації mf-ring
    };
    window.addEventListener('gramista:city', onCity);
    return () => {
      window.removeEventListener('gramista:city', onCity);
      focusMarkerRef.current?.remove();
      focusMarkerRef.current = null;
    };
  }, [flyToSelectedCity]);

  const LABEL_OPTIONS: { value: LabelMode; label: string }[] = [
    { value: 'none', label: 'Без' },
    { value: 'oblast', label: 'Області' },
    { value: 'all', label: 'Області + міста' },
  ];

  return (
    <div className="map-canvas">
      <div ref={containerRef} className="map-gl" aria-label="Мапа України з містами" />
      {showControls && (
        <>
          <div className="map-modes" role="group" aria-label="Режим мапи">
            <button type="button" className={mode === 'points' ? 'active' : undefined} onClick={() => setMode('points')}>
              Точки
            </button>
            <button type="button" className={mode === 'clusters' ? 'active' : undefined} onClick={() => setMode('clusters')}>
              Згруповано
            </button>
          </div>
          <div className="map-labels" role="group" aria-label="Підписи на мапі">
            {LABEL_OPTIONS.map((o) => (
              <button
                type="button"
                key={o.value}
                className={labels === o.value ? 'active' : undefined}
                onClick={() => setLabels(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
