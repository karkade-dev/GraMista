import { test } from 'node:test';
import assert from 'node:assert/strict';

import { streamReportImage, collectionReportImage } from '../lib/reports';
import type { StreamSummary } from '../lib/streams';
import type { CollectionRow } from '../lib/collections';

test('streamReportImage: kicker, заголовок, 3 числа, топ-міста', () => {
  const s: StreamSummary = {
    id: 's1', name: 'Марафон', url: null, notes: null,
    startedAt: new Date('2026-03-01T12:00:00Z'), endedAt: new Date('2026-03-01T15:00:00Z'),
    durationMs: 3 * 3600_000, sumUah: 5000, donations: 12, points: 50,
    topCities: [
      { settlementId: 'kyiv', name: 'Київ', points: 30 },
      { settlementId: 'lviv', name: 'Львів', points: 20 },
    ],
  };
  const d = streamReportImage(s);
  assert.equal(d.kicker, 'Звіт стріму');
  assert.equal(d.title, 'Марафон');
  assert.equal(d.stats.length, 3);
  assert.deepEqual(d.stats.map((x) => x.label), ['Зібрано', 'Донатів', 'Балів містам']);
  assert.equal(d.stats[1]!.value, '12'); // донати
  assert.deepEqual(d.topCities.map((c) => c.name), ['Київ', 'Львів']);
});

test('collectionReportImage: відсоток фактичний (може >100), 3 числа', () => {
  const c: CollectionRow = {
    id: 'c1', name: 'На авто', goalUah: 1000, raisedUah: 1500, percent: 100,
    seedUah: 0, displayedUah: 1500, displayedPercent: 100,
    status: 'active', startAt: new Date('2026-03-01T00:00:00Z'), endAt: null, streamCount: 2,
    topCities: [{ settlementId: 'kyiv', name: 'Київ', points: 15 }],
  };
  const d = collectionReportImage(c);
  assert.equal(d.kicker, 'Звіт збору');
  assert.equal(d.title, 'На авто');
  const done = d.stats.find((x) => x.label === 'Виконано');
  assert.equal(done!.value, '150%'); // фактичний відсоток, не обмежений 100
  assert.equal(d.stats.find((x) => x.label === 'Стрімів')!.value, '2');
});

test('collectionReportImage: ціль 0 → 0%', () => {
  const c: CollectionRow = {
    id: 'c2', name: 'Без цілі', goalUah: 0, raisedUah: 500, percent: 0,
    seedUah: 0, displayedUah: 500, displayedPercent: 0,
    status: 'active', startAt: new Date(), endAt: null, streamCount: 1, topCities: [],
  };
  assert.equal(collectionReportImage(c).stats.find((x) => x.label === 'Виконано')!.value, '0%');
});
