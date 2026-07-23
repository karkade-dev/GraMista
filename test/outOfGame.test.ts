import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { testDb, resetDynamic } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import { processDonation } from '../lib/ingest';
import { reassignCity, setDonationOutOfGame, assignCity } from '../lib/admin';
import { leaderboard } from '../lib/leaderboard';
import { undoAdminAction } from '../lib/adminLog';
import { getState, getHeader, dashboardTiles, cityDetail } from '../lib/dashboard';
import { getPublicPage, getPublicCollectionArchive } from '../lib/publicPage';
import { donationFlash } from '../lib/map';
import { startStream, getStreams } from '../lib/streams';
import { createCollection, activateCollection, completeCollection, collectionSummary } from '../lib/collections';
import { getGlobalMap, globalCityDetail } from '../lib/globalMap';

const U = DEFAULT_USER_ID;

beforeEach(async () => {
  await resetDynamic();
  await testDb.user.update({ where: { id: U }, data: { cityBattle: true, handle: null, showOnGlobalMap: false } });
});

after(async () => {
  await testDb.$disconnect();
});

test('перерахунок ланцюга не нараховує балів донату outOfGame', async () => {
  // Два донати того ж донатера в Київ; другий вручну позначаємо outOfGame (сирим update, без перерахунку).
  await processDonation(testDb, U, { externalId: 'g1', donorName: 'Орест', amountUah: 150, message: 'Київ' });
  await processDonation(testDb, U, { externalId: 'g2', donorName: 'Орест', amountUah: 150, message: 'Київ' });
  await testDb.donation.update({ where: { userId_externalId: { userId: U, externalId: 'g2' } }, data: { outOfGame: true } });

  // Зміна міста g1 (Київ→Львів) тригерить перерахунок пари (Орест, Київ): g1 виходить, лишається лише g2,
  // але g2 outOfGame → у грі його нема. Київ має зникнути з топу; Львів отримати 1.5 від g1.
  await reassignCity(testDb, U, 'g1', 'lviv');

  const lb = await leaderboard(testDb, U, { limit: 10 });
  assert.deepEqual(lb.map((x) => x.settlementId), ['lviv']);
});

test('вивести з гри → бали зникають; повернути → донараховуються', async () => {
  await processDonation(testDb, U, { externalId: 's1', donorName: 'Ірина', amountUah: 250, message: 'Одеса' });
  assert.equal((await leaderboard(testDb, U, { limit: 10 })).length, 1); // Одеса 2.5

  const off = await setDonationOutOfGame(testDb, U, 's1', true);
  assert.equal(off?.points, 0);
  assert.deepEqual(await leaderboard(testDb, U, { limit: 10 }), []); // зникла з топу
  const d1 = await testDb.donation.findFirstOrThrow({ where: { userId: U, externalId: 's1' } });
  assert.equal(d1.outOfGame, true);
  assert.equal(Number(d1.pointsAwarded), 0);

  const on = await setDonationOutOfGame(testDb, U, 's1', false);
  assert.equal(Math.round((on?.points ?? 0) * 1e4) / 1e4, 2.5);
  assert.equal((await leaderboard(testDb, U, { limit: 10 }))[0]?.settlementId, 'odesa');
});

test('setDonationOutOfGame: повтор того ж значення → null', async () => {
  await processDonation(testDb, U, { externalId: 's2', donorName: 'Ірина', amountUah: 100, message: 'Одеса' });
  assert.equal(await setDonationOutOfGame(testDb, U, 's2', false), null); // вже в грі
});

test('відкат виведення з гри повертає бали', async () => {
  await processDonation(testDb, U, { externalId: 'u1', donorName: 'Ірина', amountUah: 250, message: 'Одеса' });
  await setDonationOutOfGame(testDb, U, 'u1', true);
  assert.deepEqual(await leaderboard(testDb, U, { limit: 10 }), []);

  const act = await testDb.adminAction.findFirstOrThrow({ where: { userId: U, type: 'setDonationGame' }, orderBy: { createdAt: 'desc' } });
  const res = await undoAdminAction(testDb, U, act.id);
  assert.equal(res.ok, true);
  assert.equal((await leaderboard(testDb, U, { limit: 10 }))[0]?.settlementId, 'odesa'); // бали повернулись
  const d = await testDb.donation.findFirstOrThrow({ where: { userId: U, externalId: 'u1' } });
  assert.equal(d.outOfGame, false);
});

test('липке виключення: призначення міста виключеному донату НЕ повертає його в гру', async () => {
  await testDb.user.update({ where: { id: U }, data: { cityBattle: false } });
  // Без міста в коментарі → нерозпізнаний, outOfGame=true.
  await processDonation(testDb, U, { externalId: 'a1', donorName: 'Петро', amountUah: 200, message: 'дякую' });
  const before = await testDb.donation.findFirstOrThrow({ where: { userId: U, externalId: 'a1' } });
  assert.equal(before.outOfGame, true);

  // Місто записується, але донат лишається поза грою й без балів.
  await assignCity(testDb, U, 'a1', 'kyiv');
  const after = await testDb.donation.findFirstOrThrow({ where: { userId: U, externalId: 'a1' } });
  assert.equal(after.outOfGame, true);
  assert.equal(after.settlementId, 'kyiv');
  assert.equal(Number(after.pointsAwarded), 0);
  assert.deepEqual(await leaderboard(testDb, U, { limit: 10 }), []);

  // Повертає в гру лише явна дія — тоді й бали донараховуються.
  const on = await setDonationOutOfGame(testDb, U, 'a1', false);
  assert.equal(Math.round((on?.points ?? 0) * 1e4) / 1e4, 2);
  assert.equal((await leaderboard(testDb, U, { limit: 10 }))[0]?.settlementId, 'kyiv');
});

test('вивести з гри донат без міста → схований від глядача; повернути → знову видно', async () => {
  await processDonation(testDb, U, { externalId: 'n1', donorName: 'Марко', amountUah: 100, message: 'Київ' });
  await processDonation(testDb, U, { externalId: 'n2', donorName: 'Марко', amountUah: 300, message: 'дякую' }); // нерозпізнаний

  const off = await setDonationOutOfGame(testDb, U, 'n2', true);
  assert.equal(off?.ok, true);
  const d = await testDb.donation.findFirstOrThrow({ where: { userId: U, externalId: 'n2' } });
  assert.equal(d.outOfGame, true);

  const viewer = await getState(testDb, U, {}, { audience: 'viewer' });
  assert.equal(viewer.totalRaisedUah, 100); // 300 грн поза грою — сховано і з суми
  assert.deepEqual(viewer.recent.map((r) => r.externalId), ['n1']);

  const on = await setDonationOutOfGame(testDb, U, 'n2', false);
  assert.equal(on?.ok, true);
  const viewer2 = await getState(testDb, U, {}, { audience: 'viewer' });
  assert.equal(viewer2.totalRaisedUah, 400);
});

test('відкат виведення з гри донату без міста', async () => {
  await processDonation(testDb, U, { externalId: 'n3', donorName: 'Марко', amountUah: 200, message: 'слава' });
  await setDonationOutOfGame(testDb, U, 'n3', true);

  const act = await testDb.adminAction.findFirstOrThrow({ where: { userId: U, type: 'setDonationGame' }, orderBy: { createdAt: 'desc' } });
  const res = await undoAdminAction(testDb, U, act.id);
  assert.equal(res.ok, true);
  const d = await testDb.donation.findFirstOrThrow({ where: { userId: U, externalId: 'n3' } });
  assert.equal(d.outOfGame, false);
});

test('відкат виведення без міста після призначення міста → stale (стан змінився)', async () => {
  await processDonation(testDb, U, { externalId: 'n4', donorName: 'Марко', amountUah: 200, message: 'слава' });
  await setDonationOutOfGame(testDb, U, 'n4', true);
  await assignCity(testDb, U, 'n4', 'kyiv'); // місто зʼявилося після виведення

  const act = await testDb.adminAction.findFirstOrThrow({ where: { userId: U, type: 'setDonationGame' }, orderBy: { createdAt: 'desc' } });
  const res = await undoAdminAction(testDb, U, act.id);
  assert.equal(res.ok, false); // повертати треба явною кнопкою «у гру»
});

test('getState viewer ховає outOfGame зі стрічки й суми; admin бачить стрічку, але не суму', async () => {
  await processDonation(testDb, U, { externalId: 'v1', donorName: 'Олег', amountUah: 100, message: 'Київ' });
  await processDonation(testDb, U, { externalId: 'v2', donorName: 'Олег', amountUah: 300, message: 'Львів' });
  await setDonationOutOfGame(testDb, U, 'v2', true); // 300 грн поза грою

  const viewer = await getState(testDb, U, {}, { audience: 'viewer' });
  assert.equal(viewer.recent.length, 1);
  assert.equal(viewer.recent[0]?.externalId, 'v1');
  assert.equal(viewer.totalRaisedUah, 100); // 300 сховано (варіант B)

  // Оператор бачить донат у стрічці (з міткою), але статистика-сума — лише «в грі».
  const admin = await getState(testDb, U, {}, { audience: 'admin' });
  assert.equal(admin.recent.length, 2);
  assert.equal(admin.totalRaisedUah, 100);
  assert.equal(admin.recent.find((r) => r.externalId === 'v2')?.outOfGame, true);
});

test('публічна сторінка ховає донати поза грою (сума+стрічка)', async () => {
  await testDb.user.update({ where: { id: U }, data: { handle: 'oog-test' } });
  await processDonation(testDb, U, { externalId: 'p1', donorName: 'Аня', amountUah: 100, message: 'Київ' });
  await processDonation(testDb, U, { externalId: 'p2', donorName: 'Аня', amountUah: 500, message: 'Львів' });
  await setDonationOutOfGame(testDb, U, 'p2', true);

  const page = await getPublicPage(testDb, 'oog-test');
  assert.equal(page?.totalAllTimeUah, 100); // 500 поза грою сховано
  assert.equal(page?.state.recent.length, 1);
  assert.equal(page?.state.recent[0]?.externalId, 'p1');
});

test('плитки дашборду і шапка не рахують донати поза грою', async () => {
  await startStream(testDb, U, 'Ефір');
  await processDonation(testDb, U, { externalId: 't1', donorName: 'Аня', amountUah: 100, message: 'Київ' });
  await processDonation(testDb, U, { externalId: 't2', donorName: 'Аня', amountUah: 500, message: 'Львів' });
  await setDonationOutOfGame(testDb, U, 't2', true);

  const tiles = await dashboardTiles(testDb, U);
  assert.equal(tiles.todayRaisedUah, 100); // «сьогодні зібрано» — лише в грі
  assert.equal(tiles.activeStream?.sumUah, 100);
  assert.equal(tiles.activeStream?.donations, 1);

  const h = await getHeader(testDb, U);
  assert.equal(h.totalRaisedUah, 100);
  assert.equal(h.donationCount, 1);
  assert.equal(h.periodTotals.all.sumUah, 100);
  assert.equal(h.periodTotals.all.count, 1);
  assert.equal(h.periodTotals.week.sumUah, 100);
  assert.equal(h.periodTotals.stream?.sumUah, 100);
});

test('статистика стрімів не рахує донати поза грою', async () => {
  await startStream(testDb, U, 'Ефір');
  await processDonation(testDb, U, { externalId: 'st1', donorName: 'Аня', amountUah: 100, message: 'Київ' });
  await processDonation(testDb, U, { externalId: 'st2', donorName: 'Аня', amountUah: 500, message: 'Львів' });
  await setDonationOutOfGame(testDb, U, 'st2', true);

  const streams = await getStreams(testDb, U, 'date');
  assert.equal(streams[0]?.sumUah, 100);
  assert.equal(streams[0]?.donations, 1);
});

test('збір: підсумок, архів і публічний список зборів — без донатів поза грою', async () => {
  await testDb.user.update({ where: { id: U }, data: { handle: 'oog-col' } });
  const c = await createCollection(testDb, U, { name: 'Дрони', goalUah: 1000 });
  await activateCollection(testDb, U, c.id);
  await processDonation(testDb, U, { externalId: 'c1', donorName: 'Аня', amountUah: 100, message: 'Київ' });
  await processDonation(testDb, U, { externalId: 'c2', donorName: 'Аня', amountUah: 500, message: 'Львів' });
  await setDonationOutOfGame(testDb, U, 'c2', true);

  const sum = await collectionSummary(testDb, U, await testDb.collection.findUniqueOrThrow({ where: { id: c.id } }));
  assert.equal(sum.raisedUah, 100);

  await completeCollection(testDb, U, c.id);
  const arch = await getPublicCollectionArchive(testDb, 'oog-col', c.id);
  assert.equal(arch?.raisedUah, 100);
  assert.equal(arch?.donationCount, 1);

  const page = await getPublicPage(testDb, 'oog-col');
  assert.equal(page?.pastCollections[0]?.raisedUah, 100);
});

test('картка міста не рахує донати поза грою', async () => {
  await processDonation(testDb, U, { externalId: 'cd1', donorName: 'Аня', amountUah: 100, message: 'Київ' });
  await processDonation(testDb, U, { externalId: 'cd2', donorName: 'Петро', amountUah: 500, message: 'Київ' });
  await setDonationOutOfGame(testDb, U, 'cd2', true);

  const d = await cityDetail(testDb, U, 'kyiv');
  assert.equal(d?.raisedUah, 100);
  assert.equal(d?.donations, 1);
  assert.equal(d?.recent.length, 1);
  assert.equal(d?.topDonors.length, 1);
});

test('глобальна мапа /ukraine не рахує донати поза грою', async () => {
  await testDb.user.update({ where: { id: U }, data: { handle: 'oog-gm', showOnGlobalMap: true } });
  try {
    await processDonation(testDb, U, { externalId: 'gm1', donorName: 'Аня', amountUah: 2000, message: 'Київ' });
    await processDonation(testDb, U, { externalId: 'gm2', donorName: 'Аня', amountUah: 5000, message: 'Київ' });
    await setDonationOutOfGame(testDb, U, 'gm2', true);

    const g = await getGlobalMap(testDb, { maxAgeMs: 0 });
    assert.equal(g.totalUah, 2000);
    assert.equal(g.top[0]?.sumUah, 2000);
    assert.equal(g.feed.length, 1); // поза грою не світиться і в стрічці
    assert.equal(g.participants.find((p) => p.handle === 'oog-gm')?.totalUah, 2000);

    const cd = await globalCityDetail(testDb, 'kyiv');
    assert.equal(cd?.totalUah, 2000);
    assert.equal(cd?.recent.length, 1);
  } finally {
    await testDb.user.update({ where: { id: U }, data: { showOnGlobalMap: false } });
  }
});

test('donationFlash → null для донату поза грою', async () => {
  await processDonation(testDb, U, { externalId: 'f1', donorName: 'Сергій', amountUah: 200, message: 'Київ' });
  assert.notEqual(await donationFlash(testDb, U, 'f1'), null); // у грі — спалах є
  await setDonationOutOfGame(testDb, U, 'f1', true);
  assert.equal(await donationFlash(testDb, U, 'f1'), null); // поза грою — спалаху нема
});
