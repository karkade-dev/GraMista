import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { testDb, resetDynamic } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import { applyDonation } from '../lib/scoring';
import { getState, getHeader, dashboardTiles, cityDetail, biggestRecentId, type RecentItem } from '../lib/dashboard';
import { setCityBattle } from '../lib/settings';
import { windowFor } from '../lib/period';

const U = DEFAULT_USER_ID;

// Хелпер для чистого тесту biggestRecentId (без БД).
function rec(externalId: string, amountUah: number, at: number): RecentItem {
  return { externalId, who: 'X', amountUah, message: '', city: null, points: 0, at, collectionId: null, newCity: false, abroad: false };
}

test('biggestRecentId: порожня стрічка → null', () => {
  assert.equal(biggestRecentId([]), null);
});

test('biggestRecentId: обирає найбільший за сумою (незалежно від позиції)', () => {
  const feed = [rec('a', 100, 3), rec('b', 900, 2), rec('c', 250, 1)];
  assert.equal(biggestRecentId(feed), 'b');
});

test('biggestRecentId: рівні суми → новіший (більший at)', () => {
  const feed = [rec('old', 500, 1), rec('new', 500, 5), rec('mid', 500, 3)];
  assert.equal(biggestRecentId(feed), 'new');
});

test('biggestRecentId: рівні сума й час → детерміновано за externalId', () => {
  const feed = [rec('b', 500, 7), rec('a', 500, 7)];
  assert.equal(biggestRecentId(feed), 'b');
});

beforeEach(async () => {
  await resetDynamic();
  await testDb.user.update({ where: { id: U }, data: { cityBattle: true } });
});

after(async () => {
  await testDb.$disconnect();
});

test('getState: вікно періоду скоупить суму, топ і стрічку (старе поза тижнем — відкидається)', async () => {
  const old = new Date(Date.now() - 30 * 86400000);
  // старий донат (30 днів тому): Київ, 500 ₴ → 5 балів; бекдейтимо createdAt і донату, і події балів
  const don = await testDb.donation.create({
    data: {
      userId: U, externalId: 'old1', donorName: 'Old', amount: 500, message: 'Київ',
      settlementId: 'kyiv', status: 'recognized', pointsAwarded: 5, createdAt: old,
    },
  });
  await testDb.pointEvent.create({
    data: { userId: U, settlementId: 'kyiv', points: 5, source: 'donation', donationId: don.id, createdAt: old },
  });
  // свіжий донат (сьогодні): Львів, 300 ₴ → 3 бали
  await applyDonation(testDb, U, { externalId: 'new1', donorName: 'New', amountUah: 300, message: 'Львів' }, 'lviv');

  // «Весь час» — бачимо обидва
  const all = await getState(testDb, U);
  assert.equal(all.totalRaisedUah, 800);
  assert.deepEqual(all.leaderboard.map((r) => r.settlementId).sort(), ['kyiv', 'lviv']);
  assert.equal(all.recent.length, 2);

  // «Тиждень» — лише свіжий
  const week = await getState(testDb, U, windowFor('week'));
  assert.equal(week.totalRaisedUah, 300);
  assert.deepEqual(week.leaderboard.map((r) => r.settlementId), ['lviv']);
  assert.equal(week.recent.length, 1);
  assert.equal(week.recent[0]?.externalId, 'new1');
});

test('getState({streamId}): скоуп за стрімом — лише донати/бали/стрічка/мапа цього стріму', async () => {
  const a = await testDb.stream.create({ data: { userId: U, name: 'A', startedAt: new Date() } });
  const b = await testDb.stream.create({ data: { userId: U, name: 'B', startedAt: new Date() } });

  // Стрім A: Київ 500 ₴ → 5 балів
  await applyDonation(testDb, U, { externalId: 'a1', donorName: 'A1', amountUah: 500, message: 'Київ' }, 'kyiv', a.id);
  // Стрім B: Львів 300 ₴ → 3 бали
  await applyDonation(testDb, U, { externalId: 'b1', donorName: 'B1', amountUah: 300, message: 'Львів' }, 'lviv', b.id);

  const sa = await getState(testDb, U, {}, { streamId: a.id });
  assert.equal(sa.totalRaisedUah, 500);
  assert.deepEqual(sa.leaderboard.map((r) => r.settlementId), ['kyiv']);
  assert.equal(sa.recent.length, 1);
  assert.equal(sa.recent[0]?.externalId, 'a1');
  assert.deepEqual(sa.map.map((p) => p.id), ['kyiv']);

  const sb = await getState(testDb, U, {}, { streamId: b.id });
  assert.equal(sb.totalRaisedUah, 300);
  assert.deepEqual(sb.leaderboard.map((r) => r.settlementId), ['lviv']);
  assert.equal(sb.recent.length, 1);
  assert.deepEqual(sb.map.map((p) => p.id), ['lviv']);
});

test('dashboardTiles: сьогодні зібрано, лідер дня, активних міст, за стрім', async () => {
  const stream = await testDb.stream.create({ data: { userId: U, name: 'S', startedAt: new Date() } });
  // сьогодні: Київ 500 → 5 балів, у активному стрімі
  await applyDonation(testDb, U, { externalId: 't1', donorName: 'A', amountUah: 500, message: 'Київ' }, 'kyiv', stream.id);
  // «учора» (26 год тому — завжди до початку сьогодні): Львів 300 → 3 бали
  const yest = new Date(Date.now() - 26 * 3600 * 1000);
  const d = await testDb.donation.create({
    data: { userId: U, externalId: 't2', donorName: 'B', amount: 300, message: 'Львів', settlementId: 'lviv', status: 'recognized', pointsAwarded: 3, createdAt: yest },
  });
  await testDb.pointEvent.create({
    data: { userId: U, settlementId: 'lviv', points: 3, source: 'donation', donationId: d.id, createdAt: yest },
  });

  const tiles = await dashboardTiles(testDb, U);
  assert.equal(tiles.todayRaisedUah, 500); // лише сьогоднішній донат
  assert.equal(tiles.todayLeader?.name, 'Київ'); // лідер серед сьогоднішніх балів
  assert.equal(tiles.activeCities, 2); // Київ + Львів мають бали (за весь час)
  assert.equal(tiles.activeStream?.sumUah, 500);
  assert.equal(tiles.activeStream?.donations, 1);
});

test('dashboardTiles: без активного стріму → activeStream null', async () => {
  const tiles = await dashboardTiles(testDb, U);
  assert.equal(tiles.activeStream, null);
  assert.equal(tiles.todayRaisedUah, 0);
  assert.equal(tiles.todayLeader, null);
});

test('dashboardTiles: «активних міст» — у межах активного збору (рамка змагання)', async () => {
  const c = await testDb.collection.create({ data: { userId: U, name: 'Новий', status: 'active' } });
  // Київ має бали, але ПОЗА збором; активний збір — порожній.
  await applyDonation(testDb, U, { externalId: 'old', donorName: 'A', amountUah: 500, message: 'Київ' }, 'kyiv');
  const tiles = await dashboardTiles(testDb, U);
  assert.equal(tiles.activeCities, 0); // порожній активний збір → 0 (а не 1 поза збором)
});

test('cityDetail({collectionId}): бали/донати/сума лише цього збору', async () => {
  const c = await testDb.collection.create({ data: { userId: U, name: 'С', status: 'active' } });
  await applyDonation(testDb, U, { externalId: 'in', donorName: 'A', amountUah: 500, message: 'Київ' }, 'kyiv', null, { collectionId: c.id });
  await applyDonation(testDb, U, { externalId: 'out', donorName: 'B', amountUah: 300, message: 'Київ' }, 'kyiv'); // поза збором
  const d = await cityDetail(testDb, U, 'kyiv', {}, { collectionId: c.id });
  assert.ok(d);
  assert.equal(d.donations, 1);
  assert.equal(d.raisedUah, 500);
  assert.equal(d.points, 5);
});

test('cityDetail: бали, к-сть, сума, останні донати, топ-донатери (анонімно)', async () => {
  await applyDonation(testDb, U, { externalId: 'c1', donorName: 'Анна Коваль', amountUah: 500, message: 'Київ' }, 'kyiv'); // 5
  await applyDonation(testDb, U, { externalId: 'c2', donorName: 'Борис Лис', amountUah: 300, message: 'Київ' }, 'kyiv'); // 3
  await applyDonation(testDb, U, { externalId: 'c3', donorName: 'Анна Коваль', amountUah: 200, message: 'Київ' }, 'kyiv'); // +2
  await applyDonation(testDb, U, { externalId: 'c4', donorName: 'Хтось', amountUah: 100, message: 'Львів' }, 'lviv'); // інше місто

  const d = await cityDetail(testDb, U, 'kyiv');
  assert.ok(d);
  assert.equal(d.name, 'Київ');
  assert.equal(d.donations, 3); // лише київські
  assert.equal(d.raisedUah, 1000); // 500+300+200
  assert.equal(d.points, 10); // 5+3+2
  assert.equal(d.recent.length, 3);
  assert.ok(d.recent[0]!.who.endsWith('.'), 'анонімізоване ім.я');
  // топ-донатер — Анна (700 разом), анонімно
  assert.equal(d.topDonors[0]!.who, 'Анна К.');
  assert.equal(d.topDonors[0]!.totalUah, 700);
});

test('cityDetail: неіснуюче місто → null', async () => {
  assert.equal(await cityDetail(testDb, U, 'nope-city'), null);
});

test('getState повертає поточний стан «битви міст» (для тумблера в хедері)', async () => {
  const on = await getState(testDb, U);
  assert.equal(on.cityBattle, true); // дефолт

  await setCityBattle(testDb, U, false);
  const off = await getState(testDb, U);
  assert.equal(off.cityBattle, false);
});

test('getHeader: сума й кількість — ЗА ВЕСЬ ЧАС (не за період), активний стрім, битва міст', async () => {
  const startedAt = new Date(Date.now() - 60_000);
  await testDb.stream.create({ data: { userId: U, name: 'Марафон', startedAt } });
  // старий донат (30 днів тому) — у «весь час» враховується
  const old = new Date(Date.now() - 30 * 86400000);
  await testDb.donation.create({
    data: {
      userId: U, externalId: 'h-old', donorName: 'Old', amount: 500, message: 'Київ',
      settlementId: 'kyiv', status: 'recognized', pointsAwarded: 5, createdAt: old,
    },
  });
  // свіжий донат
  await applyDonation(testDb, U, { externalId: 'h-new', donorName: 'New', amountUah: 300, message: 'Львів' }, 'lviv');

  const h = await getHeader(testDb, U);
  assert.equal(h.totalRaisedUah, 800); // 500 + 300, незалежно від періоду
  assert.equal(h.donationCount, 2);
  assert.equal(h.cityBattle, true);
  assert.equal(h.activeStream?.name, 'Марафон');
  assert.ok(h.activeStream && h.activeStream.durationMs >= 60_000);
});

test('getHeader: без активного стріму → activeStream === null', async () => {
  const h = await getHeader(testDb, U);
  assert.equal(h.activeStream, null);
  assert.equal(h.donationCount, 0);
  assert.equal(h.totalRaisedUah, 0);
  assert.equal(h.periodTotals.stream, null); // нема стріму → нема «за стрім»
});

test('getHeader: periodTotals — сума й к-сть за кожен період (шапка слухає період)', async () => {
  const stream = await testDb.stream.create({ data: { userId: U, name: 'S', startedAt: new Date() } });
  // свіжий донат у стрімі (сьогодні) → потрапляє у week / all / stream
  await applyDonation(testDb, U, { externalId: 'p1', donorName: 'A', amountUah: 300, message: 'Львів' }, 'lviv', stream.id);
  // старий донат (40 днів тому) → лише у all (поза тижнем; без стріму)
  const old = new Date(Date.now() - 40 * 86400000);
  await testDb.donation.create({
    data: {
      userId: U, externalId: 'p2', donorName: 'B', amount: 500, message: 'Київ',
      settlementId: 'kyiv', status: 'recognized', createdAt: old,
    },
  });

  const h = await getHeader(testDb, U);
  assert.equal(h.periodTotals.all.sumUah, 800);
  assert.equal(h.periodTotals.all.count, 2);
  assert.equal(h.periodTotals.week.sumUah, 300);
  assert.equal(h.periodTotals.week.count, 1);
  assert.ok(h.periodTotals.stream, 'має бути «за стрім»');
  assert.equal(h.periodTotals.stream.sumUah, 300);
  assert.equal(h.periodTotals.stream.count, 1);
  // all-time дублює periodTotals.all (для сумісності)
  assert.equal(h.totalRaisedUah, h.periodTotals.all.sumUah);
  assert.equal(h.donationCount, h.periodTotals.all.count);
});

test('getState({collectionId}): топ/мапа/стрічка/сума лише збору', async () => {
  const c = await testDb.collection.create({ data: { userId: U, name: 'С', status: 'active' } });
  await applyDonation(testDb, U, { externalId: 'g1', donorName: 'A', amountUah: 200, message: '' }, 'kyiv', null, { collectionId: c.id });
  await applyDonation(testDb, U, { externalId: 'g2', donorName: 'B', amountUah: 700, message: '' }, 'lviv'); // поза збором
  const st = await getState(testDb, U, {}, { collectionId: c.id });
  assert.equal(st.totalRaisedUah, 200);
  assert.deepEqual(st.leaderboard.map((r) => r.settlementId), ['kyiv']);
  assert.equal(st.recent.length, 1);
  assert.deepEqual(st.map.map((p) => p.id), ['kyiv']);
});

test('getHeader: активний збір → прогрес у шапці (назва, зібрано, ціль, %)', async () => {
  const col = await testDb.collection.create({ data: { userId: U, name: 'На авто', goalUah: 1000, status: 'active' } });
  const stream = await testDb.stream.create({ data: { userId: U, name: 'C', startedAt: new Date(), collectionId: col.id } });
  await applyDonation(testDb, U, { externalId: 'c1', donorName: 'X', amountUah: 600, message: 'Київ' }, 'kyiv', stream.id, { collectionId: col.id });

  const h = await getHeader(testDb, U);
  assert.ok(h.activeCollection, 'має бути активний збір');
  assert.equal(h.activeCollection.name, 'На авто');
  assert.equal(h.activeCollection.raisedUah, 600);
  assert.equal(h.activeCollection.goalUah, 1000);
  assert.equal(h.activeCollection.percent, 60);
});

test('getHeader: лише завершений збір → activeCollection === null', async () => {
  await testDb.collection.create({ data: { userId: U, name: 'Старий', goalUah: 500, status: 'completed' } });
  const h = await getHeader(testDb, U);
  assert.equal(h.activeCollection, null);
});
