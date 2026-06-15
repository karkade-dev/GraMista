import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { testDb, resetDynamic } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import { applyDonation } from '../lib/scoring';
import { updateStream } from '../lib/streams';
import { leaderboard } from '../lib/leaderboard';
import {
  createCollection,
  collectionSummary,
  listCollections,
  getCollection,
  updateCollection,
  deleteCollection,
  listCollectionOptions,
  collectionReportText,
  getActiveCollection,
  activateCollection,
  pauseCollection,
  completeCollection,
  moveDonationToCollection,
} from '../lib/collections';

const U = DEFAULT_USER_ID;

/** Стрім із донатами, прив'язаними до нього (донат + його бали → streamId). */
async function streamWith(name: string, donations: [string, number, string | null][]) {
  const s = await testDb.stream.create({ data: { userId: U, name, startedAt: new Date() } });
  for (const [eid, amount, sid] of donations) {
    await applyDonation(testDb, U, { externalId: eid, donorName: eid, amountUah: amount, message: sid ?? '' }, sid);
    const d = await testDb.donation.findUnique({
      where: { userId_externalId: { userId: U, externalId: eid } },
      select: { id: true },
    });
    await testDb.donation.update({ where: { id: d!.id }, data: { streamId: s.id } });
    await testDb.pointEvent.updateMany({ where: { donationId: d!.id }, data: { streamId: s.id } });
  }
  return s;
}

async function link(collectionId: string, streamId: string) {
  await updateStream(testDb, U, streamId, { collectionId });
}

beforeEach(async () => {
  await resetDynamic();
});

after(async () => {
  await testDb.$disconnect();
});

test('collectionReportText: текст звіту (назва, зібрано/ціль/%, топ міст)', () => {
  const text = collectionReportText({
    id: 'x', name: 'На авто', goalUah: 1000, raisedUah: 750, percent: 75,
    seedUah: 0, displayedUah: 750, displayedPercent: 75,
    status: 'active', startAt: new Date(), endAt: null, streamCount: 2,
    topCities: [{ settlementId: 'kyiv', name: 'Київ', points: 5 }],
  });
  assert.ok(text.includes('На авто'), 'назва');
  assert.ok(text.includes('75%'), 'відсоток');
  assert.ok(text.includes('Київ'), 'топ міст');
});

test('collectionReportText: «Зібрано» рахує displayed (seed+донати)', () => {
  const text = collectionReportText({
    id: 'x', name: 'Прод', goalUah: 1000, raisedUah: 300, percent: 30,
    seedUah: 200, displayedUah: 500, displayedPercent: 50,
    status: 'active', startAt: new Date(), endAt: null, streamCount: 0, topCities: [],
  });
  assert.ok(text.includes('50%'), 'відсоток від displayed');
  assert.ok(text.includes('500'), 'сума з урахуванням стартової');
});

test('collectionSummary: зібрано = донати з позначкою збору (не стріми)', async () => {
  const c = await testDb.collection.create({ data: { userId: U, name: 'На дрон', goalUah: 2000, status: 'active' } });
  await applyDonation(testDb, U, { externalId: 'c1', donorName: 'A', amountUah: 500, message: '' }, 'kyiv', null, { collectionId: c.id });
  await applyDonation(testDb, U, { externalId: 'c2', donorName: 'B', amountUah: 300, message: '' }, 'lviv', null, { collectionId: c.id });
  await applyDonation(testDb, U, { externalId: 'out', donorName: 'C', amountUah: 999, message: '' }, 'kyiv'); // поза збором
  const sum = await collectionSummary(testDb, U, await testDb.collection.findUniqueOrThrow({ where: { id: c.id } }));
  assert.equal(sum.raisedUah, 800);
  assert.equal(sum.percent, 40);
  assert.equal(sum.topCities[0]?.settlementId, 'kyiv');
});

test('collectionSummary: seedUah додається у displayed, але не в raised/percent', async () => {
  const c = await testDb.collection.create({
    data: { userId: U, name: 'Продовження', goalUah: 1000, seedUah: 200, status: 'active' },
  });
  await applyDonation(testDb, U, { externalId: 's1', donorName: 'A', amountUah: 300, message: '' }, 'kyiv', null, { collectionId: c.id });
  const sum = await collectionSummary(testDb, U, await testDb.collection.findUniqueOrThrow({ where: { id: c.id } }));
  assert.equal(sum.raisedUah, 300, 'реальні донати — без seed');
  assert.equal(sum.percent, 30, 'реальний % — без seed');
  assert.equal(sum.seedUah, 200);
  assert.equal(sum.displayedUah, 500, 'seed + донати');
  assert.equal(sum.displayedPercent, 50, '(200+300)/1000');
});

test('createCollection/updateCollection: seedUah зберігається й редагується', async () => {
  const c = await createCollection(testDb, U, { name: 'Збір', goalUah: 1000, seedUah: 150 });
  let sum = await collectionSummary(testDb, U, await testDb.collection.findUniqueOrThrow({ where: { id: c.id } }));
  assert.equal(sum.seedUah, 150);
  await updateCollection(testDb, U, c.id, { seedUah: 400 });
  sum = await collectionSummary(testDb, U, await testDb.collection.findUniqueOrThrow({ where: { id: c.id } }));
  assert.equal(sum.seedUah, 400, 'збільшення суми через редагування');
});

test('збір без цілі: goalUah null → percent 0, звіт без «з X»', async () => {
  const c = await testDb.collection.create({ data: { userId: U, name: 'Серія', goalUah: null, status: 'active' } });
  const sum = await collectionSummary(testDb, U, c);
  assert.equal(sum.goalUah, null);
  assert.equal(sum.percent, 0);
  const text = collectionReportText(sum);
  assert.ok(!text.includes(' з '), 'без цілі нема «з X»');
});

test('відсоток обмежено 100, навіть якщо перевиконано', async () => {
  const c = await testDb.collection.create({ data: { userId: U, name: 'Мала ціль', goalUah: 100, status: 'active' } });
  await applyDonation(testDb, U, { externalId: 'x', donorName: 'A', amountUah: 500, message: '' }, 'kyiv', null, { collectionId: c.id });

  const sum = await collectionSummary(testDb, U, await testDb.collection.findUniqueOrThrow({ where: { id: c.id } }));
  assert.equal(sum.raisedUah, 500);
  assert.equal(sum.percent, 100); // min(100, 500)
});

test('збір без стрімів — 0 зібрано, 0%', async () => {
  const c = await createCollection(testDb, U, { name: 'Порожній', goalUah: 1000 });
  const sum = await collectionSummary(testDb, U, await testDb.collection.findUniqueOrThrow({ where: { id: c.id } }));
  assert.equal(sum.raisedUah, 0);
  assert.equal(sum.percent, 0);
  assert.equal(sum.streamCount, 0);
  assert.deepEqual(sum.topCities, []);
});

test('listCollections: активний спершу, далі новіші; updateCollection статус', async () => {
  // createCollection тепер створює збір «на паузі»; активуємо явно.
  const c1 = await createCollection(testDb, U, { name: 'Перший', goalUah: 1000 });
  await updateCollection(testDb, U, c1.id, { status: 'completed' });
  const c2 = await createCollection(testDb, U, { name: 'Другий', goalUah: 1000 });
  await activateCollection(testDb, U, c2.id);

  const list = await listCollections(testDb, U);
  assert.equal(list.length, 2);
  assert.equal(list[0]?.id, c2.id); // активний — спершу
  assert.equal(list[0]?.status, 'active');
  assert.equal(list[1]?.status, 'completed');
});

test('updateCollection: ціль і назва; getCollection повертає деталі', async () => {
  const c = await createCollection(testDb, U, { name: 'Стара назва', goalUah: 1000 });
  await applyDonation(testDb, U, { externalId: 'd', donorName: 'A', amountUah: 700, message: '' }, 'lviv', null, { collectionId: c.id });

  const ok = await updateCollection(testDb, U, c.id, { name: 'Нова назва', goalUah: 3500 });
  assert.equal(ok, true);

  const det = await getCollection(testDb, U, c.id);
  assert.ok(det);
  assert.equal(det!.collection.name, 'Нова назва');
  assert.equal(det!.collection.goalUah, 3500);
  assert.equal(det!.collection.raisedUah, 700);
  assert.equal(det!.cities[0]?.settlementId, 'lviv');
});

test("updateStream collectionId: прив'язка стріму до збору (лише streamCount)", async () => {
  const s = await streamWith('Стрім', [['e', 400, 'odesa']]);
  const c = await createCollection(testDb, U, { name: 'Збір', goalUah: 1000 });

  // Сумою/топом збору керує позначка на донаті, не прив'язка стріму; стрім дає лише streamCount.
  await updateStream(testDb, U, s.id, { collectionId: c.id });
  let sum = await collectionSummary(testDb, U, await testDb.collection.findUniqueOrThrow({ where: { id: c.id } }));
  assert.equal(sum.streamCount, 1);

  await updateStream(testDb, U, s.id, { collectionId: null });
  sum = await collectionSummary(testDb, U, await testDb.collection.findUniqueOrThrow({ where: { id: c.id } }));
  assert.equal(sum.streamCount, 0);
});

test('activateCollection: попередній активний сам стає на паузу; активний — один', async () => {
  const a = await createCollection(testDb, U, { name: 'Великий', goalUah: 100000 });
  const b = await createCollection(testDb, U, { name: 'Терміновий', goalUah: 5000 });
  // createCollection більше НЕ робить збір активним автоматично (інакше другий create впав би об індекс)
  assert.equal((await getActiveCollection(testDb, U)), null);

  assert.equal(await activateCollection(testDb, U, a.id), true);
  assert.equal((await getActiveCollection(testDb, U))?.id, a.id);

  assert.equal(await activateCollection(testDb, U, b.id), true);
  assert.equal((await getActiveCollection(testDb, U))?.id, b.id);
  const aRow = await testDb.collection.findUniqueOrThrow({ where: { id: a.id } });
  assert.equal(aRow.status, 'paused'); // великий сам став на паузу

  // повернення до великого
  await activateCollection(testDb, U, a.id);
  assert.equal((await getActiveCollection(testDb, U))?.id, a.id);
});

test('два active неможливі навіть повз lib (ловить індекс БД)', async () => {
  await testDb.collection.create({ data: { userId: U, name: 'X', status: 'active' } });
  await assert.rejects(
    testDb.collection.create({ data: { userId: U, name: 'Y', status: 'active' } }),
  );
});

test('pause/complete: статус і endAt; чужий збір не чіпається', async () => {
  const c = await createCollection(testDb, U, { name: 'С', goalUah: 1000 });
  await activateCollection(testDb, U, c.id);
  assert.equal(await pauseCollection(testDb, U, c.id), true);
  assert.equal((await testDb.collection.findUniqueOrThrow({ where: { id: c.id } })).status, 'paused');
  assert.equal(await completeCollection(testDb, U, c.id), true);
  const done = await testDb.collection.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(done.status, 'completed');
  assert.ok(done.endAt); // дата завершення проставилась
  assert.equal(await completeCollection(testDb, 'інший-користувач', c.id), false);
});

test('moveDonationToCollection: донат+бали переїжджають, обидва збори реплеяться', async () => {
  const a = await testDb.collection.create({ data: { userId: U, name: 'А', status: 'paused' } });
  const b = await testDb.collection.create({ data: { userId: U, name: 'Б', status: 'paused' } });
  // ланцюг у А: 60 + 60 → другий донат тригернув flush (120₴ = 1.2 бала)
  await applyDonation(testDb, U, { externalId: 'm1', donorName: 'Іван', amountUah: 60, message: '' }, 'kyiv', null, { collectionId: a.id });
  await applyDonation(testDb, U, { externalId: 'm2', donorName: 'Іван', amountUah: 60, message: '' }, 'kyiv', null, { collectionId: a.id });
  assert.equal((await leaderboard(testDb, U, { collectionId: a.id }))[0]?.points, 1.2);

  // переносимо другий донат у Б → у А лишилось 60 (без балів), у Б 60 (без балів)
  assert.equal(await moveDonationToCollection(testDb, U, 'm2', b.id), true);
  assert.deepEqual(await leaderboard(testDb, U, { collectionId: a.id }), []);
  assert.deepEqual(await leaderboard(testDb, U, { collectionId: b.id }), []);
  const poolA = await testDb.donorCityPool.findFirst({ where: { userId: U, collectionId: a.id } });
  const poolB = await testDb.donorCityPool.findFirst({ where: { userId: U, collectionId: b.id } });
  assert.equal(poolA?.accumulatedAmount.toNumber(), 60);
  assert.equal(poolB?.accumulatedAmount.toNumber(), 60);

  // і назад «поза збором»
  assert.equal(await moveDonationToCollection(testDb, U, 'm2', null), true);
  assert.equal(await moveDonationToCollection(testDb, U, 'нема', b.id), false);
  assert.equal(await moveDonationToCollection(testDb, U, 'm1', 'чужий-збір'), false);
});

test("deleteCollection: стріми лишаються, лише відв'язуються", async () => {
  const s = await streamWith('Стрім', [['f', 300, 'kyiv']]);
  const c = await createCollection(testDb, U, { name: 'Збір', goalUah: 1000 });
  await link(c.id, s.id);

  const ok = await deleteCollection(testDb, U, c.id);
  assert.equal(ok, true);

  const stream = await testDb.stream.findUnique({ where: { id: s.id }, select: { collectionId: true } });
  assert.ok(stream); // стрім існує
  assert.equal(stream!.collectionId, null); // відв'язаний

  const opts = await listCollectionOptions(testDb, U);
  assert.equal(opts.length, 0);
});
