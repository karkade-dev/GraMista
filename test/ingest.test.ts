import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { testDb, resetDynamic } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import { processDonation } from '../lib/ingest';
import { leaderboard } from '../lib/leaderboard';
import { startStream } from '../lib/streams';

const U = DEFAULT_USER_ID;

beforeEach(async () => {
  await resetDynamic();
  // User не чиститься TRUNCATE — повертаємо тумблер у дефолт, щоб тести не впливали один на одного.
  await testDb.user.update({ where: { id: U }, data: { cityBattle: true } });
});

after(async () => {
  await testDb.$disconnect();
});

test('живий донат із містом у коментарі → бали місту', async () => {
  const r = await processDonation(testDb, U, {
    externalId: 'n1', donorName: 'Орест', amountUah: 150, message: 'Переказ зі Львова, тримаймося',
  });
  assert.equal(r.settlementId, 'lviv');
  assert.equal(r.matched, true);
  assert.equal(Math.round(r.pointsAwarded * 1e4) / 1e4, 1.5);

  const lb = await leaderboard(testDb, U, { limit: 10 });
  assert.deepEqual(lb.map((x) => [x.settlementId, Math.round(x.points * 1e4) / 1e4]), [['lviv', 1.5]]);
});

test('донат без міста → нерозпізнаний, без балів, але збережений', async () => {
  const r = await processDonation(testDb, U, {
    externalId: 'n2', donorName: 'Хтось', amountUah: 200, message: 'просто дякую',
  });
  assert.equal(r.settlementId, null);
  assert.equal(r.matched, false);
  assert.deepEqual(await leaderboard(testDb, U, { limit: 10 }), []);

  const saved = await testDb.donation.findFirst({ where: { userId: U, externalId: 'n2' } });
  assert.equal(saved?.status, 'unrecognized');
});

test('битва міст ВИМКНЕНА → донат із містом рахується лише як гроші (без балів)', async () => {
  await testDb.user.update({ where: { id: U }, data: { cityBattle: false } });

  const r = await processDonation(testDb, U, {
    externalId: 'off1', donorName: 'Орест', amountUah: 300, message: 'Львів!',
  });

  assert.equal(r.matched, true); // місто розпізнане
  assert.equal(r.pointsAwarded, 0); // але балів нема — битва вимкнена
  assert.deepEqual(await leaderboard(testDb, U, { limit: 10 }), []);

  const don = await testDb.donation.findFirst({ where: { userId: U, externalId: 'off1' } });
  assert.equal(Number(don?.amount), 300); // гроші збережені (повна сума)
  assert.equal(don?.settlementId, 'lviv'); // місто записане для історії
  assert.equal(await testDb.donorCityPool.count({ where: { userId: U } }), 0); // скарбничка не чіпається
  assert.equal(await testDb.pointEvent.count({ where: { userId: U } }), 0); // подій балів нема
});

test('битва міст УВІМКНЕНА (дефолт) → донат із містом дає бали', async () => {
  const r = await processDonation(testDb, U, {
    externalId: 'on1', donorName: 'Орест', amountUah: 300, message: 'Львів!',
  });
  assert.equal(Math.round(r.pointsAwarded * 1e4) / 1e4, 3);
  assert.deepEqual(
    (await leaderboard(testDb, U, { limit: 10 })).map((x) => x.settlementId),
    ['lviv'],
  );
});

test('битва ВИМКНЕНА → донат позначається outOfGame=true', async () => {
  await testDb.user.update({ where: { id: U }, data: { cityBattle: false } });
  await processDonation(testDb, U, { externalId: 'oog1', donorName: 'Орест', amountUah: 300, message: 'Львів!' });
  const d = await testDb.donation.findFirst({ where: { userId: U, externalId: 'oog1' } });
  assert.equal(d?.outOfGame, true);
});

test('битва УВІМКНЕНА → донат outOfGame=false', async () => {
  await processDonation(testDb, U, { externalId: 'oog2', donorName: 'Орест', amountUah: 300, message: 'Львів!' });
  const d = await testDb.donation.findFirst({ where: { userId: U, externalId: 'oog2' } });
  assert.equal(d?.outOfGame, false);
});

test('донат під час активного стріму прив’язується до нього', async () => {
  const s = await startStream(testDb, U, 'Ефір');
  await processDonation(testDb, U, {
    externalId: 'n3', donorName: 'Орест', amountUah: 150, message: 'Київ!',
  });

  const don = await testDb.donation.findFirst({ where: { userId: U, externalId: 'n3' } });
  assert.equal(don?.streamId, s.id);
  const ev = await testDb.pointEvent.findFirst({ where: { userId: U, settlementId: 'kyiv' } });
  assert.equal(ev?.streamId, s.id);
});

test('processDonation: донат падає в активний збір (стрім не потрібен)', async () => {
  const c = await testDb.collection.create({ data: { userId: U, name: 'Серія', status: 'active' } });
  await processDonation(testDb, U, { externalId: 'col1', donorName: 'Ірина', amountUah: 200, message: 'Київ' });
  const d = await testDb.donation.findUniqueOrThrow({ where: { userId_externalId: { userId: U, externalId: 'col1' } } });
  assert.equal(d.collectionId, c.id);
  assert.equal(d.streamId, null); // стріму нема — збір усе одно зловив
});
