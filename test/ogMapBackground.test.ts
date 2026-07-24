import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMapSvg, mapBackground, mapImageDataUri, OG_W, OG_H } from '../app/og/mapBackground';

// Синтетичний квадратний «контур» — щоб перевіряти проєкцію без реального geojson.
const SQUARE: [number, number][][] = [[[30, 48], [32, 48], [32, 50], [30, 50], [30, 48]]];

test('крапки проєктуються в межі полотна 1200×630', () => {
  const svg = buildMapSvg(SQUARE, [
    { lat: 48.5, lon: 30.5, points: 10 },
    { lat: 49.9, lon: 31.9, points: 100 },
  ]);
  const circles = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)];
  assert.equal(circles.length, 2);
  for (const [, cx, cy] of circles) {
    assert.ok(Number(cx) >= 0 && Number(cx) <= OG_W, `cx=${cx} поза полотном`);
    assert.ok(Number(cy) >= 0 && Number(cy) <= OG_H, `cy=${cy} поза полотном`);
  }
});

test('північ угорі: більша широта → менший y', () => {
  const svg = buildMapSvg(SQUARE, [
    { lat: 48.2, lon: 31, points: 1 }, // південь
    { lat: 49.8, lon: 31, points: 1 }, // північ
  ]);
  const ys = [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(ys.length, 2);
  assert.ok(ys[1]! < ys[0]!, 'північна точка має бути вище (менший y)');
});

test('порожній список точок → валідний SVG лише з контуром', () => {
  const svg = buildMapSvg(SQUARE, []);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('<path'));
  assert.ok(!svg.includes('<circle'));
});

test('радіус крапки монотонно росте з вагою', () => {
  const svg = buildMapSvg(SQUARE, [
    { lat: 48.5, lon: 30.5, points: 1 },
    { lat: 49, lon: 31, points: 50 },
    { lat: 49.5, lon: 31.5, points: 100 },
  ]);
  const rs = [...svg.matchAll(/<circle [^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(rs.length, 3);
  assert.ok(rs[0]! < rs[1]! && rs[1]! < rs[2]!, `радіуси не монотонні: ${rs.join(', ')}`);
});

test('реальний контур України читається з диска і дає data-URI', () => {
  const uri = mapBackground([{ lat: 50.45, lon: 30.52, points: 5 }]);
  const prefix = 'url(data:image/svg+xml;base64,';
  assert.ok(uri.startsWith(prefix));
  assert.ok(uri.endsWith(')'));
  const svg = Buffer.from(uri.slice(prefix.length, -1), 'base64').toString();
  assert.ok(svg.includes('<path'), 'нема контуру');
  assert.ok(svg.includes('<circle'), 'нема крапки');
});

// Параметризований бокс + мітка топ-1 (картинка-звіт: мапа рендериться як <img> довільного розміру).
// Синтетичний квадратний «контур» 0..10 у lon/lat — без реального geojson.
const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];

test('box змінює розмір SVG (width/height у viewBox і атрибутах)', () => {
  const svg = buildMapSvg([ring], [{ lat: 5, lon: 5, points: 1 }], { width: 400, height: 300 });
  assert.match(svg, /width="400"/);
  assert.match(svg, /height="300"/);
});

test('точка поза bbox не малюється (bbox-фільтр)', () => {
  const svg = buildMapSvg([ring], [{ lat: 5, lon: 99, points: 1 }], { width: 400, height: 300 });
  assert.doesNotMatch(svg, /<circle/); // 99 поза [0..10] → відсічено
});

test('мітка топ-1 присутня текстом', () => {
  const svg = buildMapSvg([ring], [{ lat: 5, lon: 5, points: 1 }],
    { width: 400, height: 300, label: { lat: 5, lon: 5, text: 'Київ' } });
  assert.match(svg, />Київ</);
});

test('mapImageDataUri повертає data-URI SVG', () => {
  const uri = mapImageDataUri([{ lat: 50.45, lon: 30.52, points: 1 }], { width: 400, height: 300 });
  assert.match(uri, /^data:image\/svg\+xml;base64,/);
});
