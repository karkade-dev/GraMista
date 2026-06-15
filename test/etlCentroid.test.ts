import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCentroidIndex, centroidFor } from '../lib/etl/centroid';

const members = [
  // Громада А (Львівська/Львівський): дві опорні точки → центроїд = середнє.
  { oblast: 'Львівська', raion: 'Львівський', hromada: 'Давидівська', lat: 49.7, lon: 24.1 },
  { oblast: 'Львівська', raion: 'Львівський', hromada: 'Давидівська', lat: 49.9, lon: 24.3 },
  // Інша громада того ж району (опора для фолбеку на район).
  { oblast: 'Львівська', raion: 'Львівський', hromada: 'Бібрська', lat: 49.6, lon: 24.3 },
  // НП без координат — у побудові індексу не враховується.
  { oblast: 'Львівська', raion: 'Львівський', hromada: 'Давидівська', lat: null, lon: null },
];

test('centroidFor: НП без координат отримує центр СВОЄЇ громади', () => {
  const idx = buildCentroidIndex(members);
  const c = centroidFor({ oblast: 'Львівська', raion: 'Львівський', hromada: 'Давидівська' }, idx);
  assert.ok(c);
  assert.equal(Math.round(c.lat * 10) / 10, 49.8); // (49.7+49.9)/2
  assert.equal(Math.round(c.lon * 10) / 10, 24.2); // (24.1+24.3)/2
});

test('centroidFor: нема опор у громаді → фолбек на район', () => {
  const idx = buildCentroidIndex(members);
  const c = centroidFor({ oblast: 'Львівська', raion: 'Львівський', hromada: 'Невідома' }, idx);
  assert.ok(c, 'район має опорні точки');
  // середнє трьох коорд-точок району
  assert.equal(Math.round(c.lat * 100) / 100, Math.round(((49.7 + 49.9 + 49.6) / 3) * 100) / 100);
});

test('centroidFor: нема ні громади, ні району → фолбек на область', () => {
  const idx = buildCentroidIndex(members);
  const c = centroidFor({ oblast: 'Львівська', raion: 'Неіснуючий', hromada: null }, idx);
  assert.ok(c, 'область має опорні точки');
});

test('centroidFor: зовсім нема опор → null', () => {
  const idx = buildCentroidIndex(members);
  assert.equal(centroidFor({ oblast: 'Закарпатська', raion: null, hromada: null }, idx), null);
});
