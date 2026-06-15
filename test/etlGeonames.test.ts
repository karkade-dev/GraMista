import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeonames, buildGeoIndex } from '../lib/etl/geonames';

// 19 колонок TSV GeoNames (нам важливі: 2=name,3=ascii,4=alternates,5=lat,6=lon,7=fclass,11=admin1,15=population)
const row = (name: string, ascii: string, alts: string, lat: number, lon: number, fclass: string, admin1: string, pop: number) =>
  ['1', name, ascii, alts, String(lat), String(lon), fclass, 'PPL', 'UA', '', admin1, '', '', '', String(pop), '', '', '', ''].join('\t');

const TSV = [
  row('Brovary', 'Brovary', 'Бровари,Бровары,Browary', 50.51809, 30.80671, 'P', '13', 109473),
  row('Some Hill', 'Some Hill', 'Гора', 50, 30, 'T', '13', 0), // не P — пропустити
  // дві Іванівки в ОДНІЙ області з різними точками: тезки, АЛЕ одна явно більша (500 vs 120) →
  // беремо точку домінантного НП (admin1 '01' у GeoNames = Черкаська — НЕ префікс КАТОТТГ).
  row('Ivanivka A', 'Ivanivka', 'Іванівка', 49.0, 31.0, 'P', '01', 500),
  row('Ivanivka B', 'Ivanivka', 'Іванівка', 49.9, 31.9, 'P', '01', 120),
  // дві Долини без населення в одній області → лідера нема → координатам НЕ довіряємо.
  row('Dolyna A', 'Dolyna', 'Долина', 48.0, 24.0, 'P', '06', 0),
  row('Dolyna B', 'Dolyna', 'Долина', 48.9, 24.9, 'P', '06', 0),
].join('\n');

test('parseGeonames: лише клас P, координати/населення/варіанти', () => {
  const places = parseGeonames(TSV);
  assert.equal(places.length, 5);
  assert.equal(places[0]?.alternates.includes('Бровари'), true);
  assert.equal(places[0]?.population, 109473);
});

test('buildGeoIndex: одинокий НП → координатам довіряємо', () => {
  const idx = buildGeoIndex(parseGeonames(TSV));
  const brovary = idx.get('бровари|Київська');
  assert.ok(brovary);
  assert.equal(brovary.ambiguous, false);
  assert.equal(brovary.coordsReliable, true);
  assert.equal(Math.round(brovary.lat), 51);
  assert.ok(brovary.aliasCandidates.includes('Brovary'), 'латинська назва — кандидат в аліаси');
  assert.ok(brovary.aliasCandidates.includes('Бровары'), 'кирилічні варіанти — кандидати');
});

test('buildGeoIndex: тезки з ЧІТКИМ лідером за населенням → беремо точку лідера', () => {
  const idx = buildGeoIndex(parseGeonames(TSV));
  const ivanivka = idx.get('іванівка|Черкаська'); // GeoNames admin1 '01' = Черкаська
  assert.ok(ivanivka);
  assert.equal(ivanivka.ambiguous, true, 'дві різні точки під одним ключем');
  assert.equal(ivanivka.coordsReliable, true, 'є чіткий лідер (500 > 120) — координатам довіряємо');
  assert.equal(ivanivka.population, 500, 'лідер — більший НП');
  assert.equal(Math.round(ivanivka.lat), 49, 'точка ЛІДЕРА (Ivanivka A 49.0), не меншого');
  assert.equal(Math.round(ivanivka.lon), 31);
});

test('buildGeoIndex: тезки БЕЗ лідера (рівне населення) → координатам НЕ довіряємо', () => {
  const idx = buildGeoIndex(parseGeonames(TSV));
  const dolyna = idx.get('долина|Івано-Франківська'); // admin1 '06'
  assert.ok(dolyna);
  assert.equal(dolyna.ambiguous, true);
  assert.equal(dolyna.coordsReliable, false, 'обидві без населення — лідера нема → центроїд громади');
});
