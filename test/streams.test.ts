import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { testDb, resetDynamic } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import { applyDonation } from '../lib/scoring';
import { leaderboard } from '../lib/leaderboard';
import {
  startStream,
  stopStream,
  updateStream,
  deleteStream,
  getStream,
  getStreams,
  getCombined,
  getPeriod,
  moveDonationToStream,
  streamReportText,
  streamComparison,
} from '../lib/streams';

const U = DEFAULT_USER_ID;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

test('streamComparison: нормалізує суми/бали до максимуму (для смужок графіка)', () => {
  const bars = streamComparison([
    { id: 'a', name: 'A', sumUah: 1000, points: 5 },
    { id: 'b', name: 'B', sumUah: 250, points: 10 },
  ]);
  // A — найбільша сума (100%), B — чверть; за балами навпаки (B = 100%, A = 50%)
  assert.equal(bars[0]!.sumPct, 100);
  assert.equal(bars[1]!.sumPct, 25);
  assert.equal(bars[0]!.pointsPct, 50);
  assert.equal(bars[1]!.pointsPct, 100);
  // вихідні значення збережено
  assert.equal(bars[0]!.sumUah, 1000);
  assert.equal(bars[1]!.points, 10);
});

test('streamComparison: порожній список → [], нульові значення не діляться на 0', () => {
  assert.deepEqual(streamComparison([]), []);
  const z = streamComparison([{ id: 'x', name: 'X', sumUah: 0, points: 0 }]);
  assert.equal(z[0]!.sumPct, 0);
  assert.equal(z[0]!.pointsPct, 0);
});

let aId: string;
let bId: string;

// Сценарій: два стріми. Скарбничка (донатер+місто) — глобальна, тож flush для
// (Донор3, kyiv) стається у стрімі B, хоча 50 грн прийшли в стрімі A.
beforeEach(async () => {
  await resetDynamic();

  aId = (await startStream(testDb, U, 'Стрім A')).id;
  await applyDonation(testDb, U, { externalId: 'A1', donorName: 'Донор1', amountUah: 150, message: 'Київ' }, 'kyiv', aId); // 1.5
  await applyDonation(testDb, U, { externalId: 'A2', donorName: 'Донор2', amountUah: 200, message: 'Львів' }, 'lviv', aId); // 2.0
  await applyDonation(testDb, U, { externalId: 'A3', donorName: 'Донор3', amountUah: 50, message: 'Київ' }, 'kyiv', aId); // пул 50
  await stopStream(testDb, U);

  bId = (await startStream(testDb, U, 'Стрім B')).id;
  await applyDonation(testDb, U, { externalId: 'B1', donorName: 'Донор1', amountUah: 300, message: 'Київ' }, 'kyiv', bId); // 3.0
  await applyDonation(testDb, U, { externalId: 'B2', donorName: 'Донор3', amountUah: 60, message: 'Київ' }, 'kyiv', bId); // 50+60 flush 1.1
});

after(async () => {
  await testDb.$disconnect();
});

test('startStream закриває попередній — активний лише один', async () => {
  const open = await testDb.stream.findMany({ where: { userId: U, endedAt: null } });
  assert.equal(open.length, 1);
  assert.equal(open[0]!.id, bId);
});

test('підсумок стріму: сума, кількість донатів, бали', async () => {
  const a = await getStream(testDb, U, aId);
  assert.ok(a);
  assert.equal(a!.summary.sumUah, 400);
  assert.equal(a!.summary.donations, 3);
  assert.equal(r4(a!.summary.points), 3.5);

  const b = await getStream(testDb, U, bId);
  assert.equal(b!.summary.sumUah, 360);
  assert.equal(b!.summary.donations, 2);
  assert.equal(r4(b!.summary.points), 4.1);
});

test('drill-down: топ міст усередині стріму', async () => {
  const a = await getStream(testDb, U, aId);
  const shaped = a!.cities.map((c) => [c.settlementId, r4(c.points)]);
  assert.deepEqual(shaped, [['lviv', 2], ['kyiv', 1.5]]);
});

test('комбо: об’єднаний топ і сума по кількох стрімах', async () => {
  const c = await getCombined(testDb, U, [aId, bId], false);
  assert.equal(c.sumUah, 760);
  const shaped = c.leaderboard.map((x) => [x.settlementId, r4(x.points)]);
  assert.deepEqual(shaped, [['kyiv', 5.6], ['lviv', 2]]);
});

test('видалення стріму відв’язує донати, але бали лишаються в загальному топі', async () => {
  const ok = await deleteStream(testDb, U, aId);
  assert.equal(ok, true);
  assert.equal(await getStream(testDb, U, aId), null);

  // бали A1/A2 лишаються (streamId → null), загальний топ незмінний
  const all = await leaderboard(testDb, U, { limit: 50 });
  const shaped = all.map((x) => [x.settlementId, r4(x.points)]);
  assert.deepEqual(shaped, [['kyiv', 5.6], ['lviv', 2]]);

  const streams = await getStreams(testDb, U, 'date');
  assert.deepEqual(streams.map((s) => s.id), [bId]);
});

test('updateStream: назва і час; кінець не раніше початку', async () => {
  const start = new Date('2026-05-01T10:00:00Z');
  const badEnd = new Date('2026-04-01T10:00:00Z'); // раніше за початок
  const s = await updateStream(testDb, U, bId, { name: 'Перейменований', startedAt: start, endedAt: badEnd });
  assert.ok(s);
  assert.equal(s!.name, 'Перейменований');
  assert.equal(s!.startedAt.getTime(), start.getTime());
  assert.equal(s!.endedAt!.getTime(), start.getTime()); // підтягнуто до початку
});

test('moveDonationToStream: донат і його бали переходять у інший стрім (без перерахунку)', async () => {
  // A2: Львів 200 → 2.0 балів у стрімі A — переносимо в B
  assert.ok((await leaderboard(testDb, U, { streamIds: [aId] })).some((r) => r.settlementId === 'lviv'));

  assert.equal(await moveDonationToStream(testDb, U, 'A2', bId), true);

  assert.ok(
    !(await leaderboard(testDb, U, { streamIds: [aId] })).some((r) => r.settlementId === 'lviv'),
    'Львів пішов зі стріму A',
  );
  const lvivB = (await leaderboard(testDb, U, { streamIds: [bId] })).find((r) => r.settlementId === 'lviv');
  assert.equal(r4(lvivB?.points ?? 0), 2.0, 'Львів 2.0 тепер у стрімі B (та сама сума балів)');

  const d = await testDb.donation.findUnique({ where: { userId_externalId: { userId: U, externalId: 'A2' } }, select: { streamId: true } });
  assert.equal(d?.streamId, bId);

  // у «без стріму»
  assert.equal(await moveDonationToStream(testDb, U, 'A2', null), true);
  const d2 = await testDb.donation.findUnique({ where: { userId_externalId: { userId: U, externalId: 'A2' } }, select: { streamId: true } });
  assert.equal(d2?.streamId, null);
});

test('moveDonationToStream: неіснуючий донат або чужий стрім → false', async () => {
  assert.equal(await moveDonationToStream(testDb, U, 'NOPE', bId), false);
  assert.equal(await moveDonationToStream(testDb, U, 'A1', 'nope-stream'), false);
});

test('updateStream: нотатки (notes) — задати й очистити', async () => {
  const set = await updateStream(testDb, U, bId, { notes: 'Гарний стрім, багато міст' });
  assert.equal(set!.notes, 'Гарний стрім, багато міст');
  const cleared = await updateStream(testDb, U, bId, { notes: null });
  assert.equal(cleared!.notes, null);
});

test('streamReportText: усі міста стріму списком із балами (не лише топ-3)', () => {
  const text = streamReportText({
    id: 'x', name: 'Тест-стрім', url: 'https://twitch.tv/v', notes: null,
    startedAt: new Date(), endedAt: new Date(), durationMs: 3_600_000,
    sumUah: 1500, donations: 7, points: 12.5,
    topCities: [
      { settlementId: 'kyiv', name: 'Київ', points: 8 },
      { settlementId: 'lviv', name: 'Львів', points: 4.5 },
      { settlementId: 'odesa', name: 'Одеса', points: 3 },
    ],
    cities: [
      { settlementId: 'kyiv', name: 'Київ', points: 8 },
      { settlementId: 'lviv', name: 'Львів', points: 4.5 },
      { settlementId: 'odesa', name: 'Одеса', points: 3 },
      { settlementId: 'kalush', name: 'Калуш', points: 1.2 },
    ],
  });
  assert.ok(text.includes('Тест-стрім'), 'назва');
  assert.ok(text.includes('Зібрано'), 'сума');
  assert.ok(text.includes('1. Київ — 8'), 'місто з балами окремим рядком');
  assert.ok(text.includes('4. Калуш — 1.2'), 'четверте місто теж у звіті (повний перелік)');
  assert.ok(text.includes('twitch.tv/v'), 'посилання');
});

test('streamSummary: cities — повний список міст стріму (для звіту)', async () => {
  const a = await getStream(testDb, U, aId);
  assert.ok(a);
  const shaped = a!.summary.cities.map((c) => [c.settlementId, r4(c.points)]);
  assert.deepEqual(shaped, [['lviv', 2], ['kyiv', 1.5]]);
  // topCities — зріз того самого списку (чипи в списку стрімів і картинка-банер)
  assert.deepEqual(a!.summary.topCities, a!.summary.cities.slice(0, 3));
});

test('updateStream: посилання на стрім (url) — задати, лишити, очистити', async () => {
  const set = await updateStream(testDb, U, bId, { url: 'https://twitch.tv/vod/123' });
  assert.equal(set!.url, 'https://twitch.tv/vod/123');

  // undefined — не чіпати
  const keep = await updateStream(testDb, U, bId, { name: 'Інша назва' });
  assert.equal(keep!.url, 'https://twitch.tv/vod/123');

  // null — очистити
  const cleared = await updateStream(testDb, U, bId, { url: null });
  assert.equal(cleared!.url, null);
});

test('getPeriod: вікно тижня виключає старий стрім, all — включає обидва', async () => {
  const old = new Date(Date.now() - 40 * 86400000);
  await updateStream(testDb, U, aId, { startedAt: old });

  const week = await getPeriod(testDb, U, 'week');
  assert.deepEqual(week.streams.map((s) => s.id), [bId]);

  const all = await getPeriod(testDb, U, 'all');
  assert.equal(all.streams.length, 2);
});
