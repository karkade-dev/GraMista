import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, resetDynamic } from './db';
import { applyDonation } from '../lib/scoring';
import { battleGap, getPublicPage, getPublicPageCached, bustPublicPage, getPublicCollectionArchive } from '../lib/publicPage';

const U = 'pp-user';

before(async () => {
  await resetDynamic();
  await testDb.user.upsert({
    where: { id: U },
    update: { handle: 'pptest', publicShowStreams: true },
    create: { id: U, email: 'pp@x.dev', name: 'Публічний Тест', handle: 'pptest' },
  });
});
after(async () => {
  await resetDynamic();
  await testDb.user.deleteMany({ where: { id: U } });
  await testDb.$disconnect();
});

test('battleGap: менш ніж 2 міста → null', () => {
  assert.equal(battleGap([]), null);
  assert.equal(battleGap([{ settlementId: 'a', name: 'Київ', points: 5 }]), null);
});

test('battleGap: розрив округлюється до 0.1; нульовий розрив → null', () => {
  const a = { settlementId: 'a', name: 'Київ', points: 124.5 };
  const b = { settlementId: 'b', name: 'Львів', points: 98 };
  assert.deepEqual(battleGap([a, b]), { leader: a, challenger: b, diff: 26.5 });
  assert.equal(battleGap([a, { ...b, points: 124.5 }]), null);
});

test('getPublicPage: невідомий handle → null', async () => {
  assert.equal(await getPublicPage(testDb, 'no-such-streamer'), null);
});

test('getPublicPage: порожній акаунт — безпечні нулі й НІЯКИХ секретів у profile', async () => {
  const d = await getPublicPage(testDb, 'pptest');
  assert.ok(d);
  assert.equal(d.userId, U);
  // Контракт публічності: рівно ці ключі, нічого зайвого (email/overlayKey/webhookSecret/monoAccountId сюди не течуть).
  assert.deepEqual(
    Object.keys(d.profile).sort(),
    ['handle', 'monobankJarUrl', 'name', 'publicShowStreams', 'showCommentPublic', 'twitchUrl', 'youtubeUrl'],
  );
  assert.equal(d.profile.name, 'Публічний Тест');
  assert.deepEqual(d.fullLeaderboard, []);
  assert.equal(d.battle, null);
  assert.equal(d.activeCollection, null);
  assert.deepEqual(d.streams, []);
  assert.equal(d.tiles.todayRaisedUah, 0);
  assert.equal(d.tiles.biggestTodayUah, 0);
  assert.equal(d.tiles.todayLeader, null);
  assert.equal(d.state.totalRaisedUah, 0);
});

test('getPublicPage: publicShowStreams вимикає список стрімів', async () => {
  await testDb.stream.create({
    data: { userId: U, name: 'Тест-стрім', startedAt: new Date(Date.now() - 3600_000), endedAt: new Date() },
  });
  let d = await getPublicPage(testDb, 'pptest');
  assert.equal(d!.streams.length, 1);
  assert.equal(d!.streams[0]?.name, 'Тест-стрім');

  await testDb.user.update({ where: { id: U }, data: { publicShowStreams: false } });
  d = await getPublicPage(testDb, 'pptest');
  assert.deepEqual(d!.streams, []);
  await testDb.user.update({ where: { id: U }, data: { publicShowStreams: true } });
});

test('getPublicPage: топ/мапа/стрічка по активному збору; «зібрано загалом» — за весь час', async () => {
  await resetDynamic();
  const c = await testDb.collection.create({ data: { userId: U, name: 'С', status: 'active' } });
  await applyDonation(testDb, U, { externalId: 'pp1', donorName: 'A', amountUah: 300, message: '' }, 'kyiv', null, { collectionId: c.id });
  await applyDonation(testDb, U, { externalId: 'pp2', donorName: 'B', amountUah: 500, message: '' }, 'lviv'); // поза збором
  const page = await getPublicPage(testDb, 'pptest');
  assert.ok(page);
  assert.deepEqual(page!.fullLeaderboard.map((r) => r.settlementId), ['kyiv']); // скоуп збору
  assert.equal(page!.state.totalRaisedUah, 300); // суми панелей — теж збір
  assert.equal(page!.totalAllTimeUah, 800); // а «зібрано загалом» — гаманець за весь час
});

test('getPublicCollectionArchive: повний топ, суми, стріми; чужий/неіснуючий → null', async () => {
  await resetDynamic();
  const c = await testDb.collection.create({
    data: { userId: U, name: 'Архівний', goalUah: 1000, status: 'completed', endAt: new Date() },
  });
  await applyDonation(testDb, U, { externalId: 'ar1', donorName: 'Петро Коваль', amountUah: 250, message: '' }, 'kyiv', null, { collectionId: c.id });
  const arch = await getPublicCollectionArchive(testDb, 'pptest', c.id);
  assert.ok(arch);
  assert.equal(arch!.name, 'Архівний');
  assert.equal(arch!.raisedUah, 250);
  assert.equal(arch!.donationCount, 1);
  assert.deepEqual(arch!.cities.map((r) => r.settlementId), ['kyiv']); // ПОВНИЙ топ
  assert.equal(await getPublicCollectionArchive(testDb, 'pptest', 'нема'), null);
  assert.equal(await getPublicCollectionArchive(testDb, 'невідомий-хендл', c.id), null);
});

test('getPublicPage: pastCollections — завершені збори, новіші спершу', async () => {
  await resetDynamic();
  await testDb.collection.create({ data: { userId: U, name: 'Старий', status: 'completed', endAt: new Date('2026-01-01T00:00:00Z') } });
  await testDb.collection.create({ data: { userId: U, name: 'Новіший', status: 'completed', endAt: new Date('2026-02-01T00:00:00Z') } });
  await testDb.collection.create({ data: { userId: U, name: 'Активний', status: 'active' } });
  const page = await getPublicPage(testDb, 'pptest');
  assert.ok(page);
  assert.deepEqual(page!.pastCollections.map((p) => p.name), ['Новіший', 'Старий']); // лише completed, endAt desc
});

test('getPublicPageCached: у межах TTL — той самий результат (БД не б\'ється повторно); bust скидає', async () => {
  await resetDynamic();
  // Конкурентні запити ділять ОДИН виклик композитора → ref-рівні дані.
  const [before, again] = await Promise.all([
    getPublicPageCached(testDb, 'pptest'),
    getPublicPageCached(testDb, 'pptest'),
  ]);
  assert.ok(before);
  assert.equal(again, before);

  await applyDonation(testDb, U, { externalId: 'cc1', donorName: 'К', amountUah: 100, message: '' }, 'kyiv');
  const stale = await getPublicPageCached(testDb, 'pptest');
  assert.equal(stale, before); // TTL ще не минув — донат у кеші не видно

  bustPublicPage('pptest');
  const fresh = await getPublicPageCached(testDb, 'pptest');
  assert.notEqual(fresh, before);
  assert.equal(fresh!.totalAllTimeUah, before!.totalAllTimeUah + 100);
});

test('getPublicPageCached: maxAgeMs:0 обходить кеш; невідомий handle (null) не кешується', async () => {
  const a = await getPublicPageCached(testDb, 'pptest', { maxAgeMs: 0 });
  const b = await getPublicPageCached(testDb, 'pptest', { maxAgeMs: 0 });
  assert.ok(a && b);
  assert.notEqual(a, b); // кожен виклик — свіжий перерахунок

  assert.equal(await getPublicPageCached(testDb, 'no-such-streamer'), null);
  // null не осів у кеші: хендл з'явився → одразу видно без bust/TTL
  await testDb.user.update({ where: { id: U }, data: { handle: 'no-such-streamer' } });
  const appeared = await getPublicPageCached(testDb, 'no-such-streamer');
  assert.ok(appeared);
  await testDb.user.update({ where: { id: U }, data: { handle: 'pptest' } });
  bustPublicPage('no-such-streamer');
});

test('getPublicPage: активний збір показує displayed (seed+донати); «загалом» — без seed', async () => {
  await resetDynamic();
  const c = await testDb.collection.create({ data: { userId: U, name: 'Прод', goalUah: 1000, seedUah: 200, status: 'active' } });
  await applyDonation(testDb, U, { externalId: 'sd1', donorName: 'A', amountUah: 300, message: '' }, 'kyiv', null, { collectionId: c.id });
  const page = await getPublicPage(testDb, 'pptest');
  assert.ok(page);
  assert.equal(page!.activeCollection!.displayedUah, 500, 'seed + донати');
  assert.equal(page!.activeCollection!.raisedUah, 300, 'реальні донати — без seed');
  assert.equal(page!.totalAllTimeUah, 300, '«зібрано загалом» — без стартової суми');
});

test('getPublicPage: минулий збір у списку показує displayed (seed+донати)', async () => {
  await resetDynamic();
  const c = await testDb.collection.create({ data: { userId: U, name: 'МинулийСтарт', seedUah: 400, status: 'completed', endAt: new Date() } });
  await applyDonation(testDb, U, { externalId: 'pc1', donorName: 'A', amountUah: 100, message: '' }, 'kyiv', null, { collectionId: c.id });
  const page = await getPublicPage(testDb, 'pptest');
  const past = page!.pastCollections.find((p) => p.name === 'МинулийСтарт');
  assert.equal(past!.raisedUah, 500, 'seed + донати в списку минулих');
});

test('getPublicCollectionArchive: «Зібрано» показує displayed (seed+донати)', async () => {
  await resetDynamic();
  const c = await testDb.collection.create({
    data: { userId: U, name: 'АрхівСтарт', goalUah: 1000, seedUah: 100, status: 'completed', endAt: new Date() },
  });
  await applyDonation(testDb, U, { externalId: 'sa1', donorName: 'A', amountUah: 250, message: '' }, 'kyiv', null, { collectionId: c.id });
  const arch = await getPublicCollectionArchive(testDb, 'pptest', c.id);
  assert.ok(arch);
  assert.equal(arch!.raisedUah, 350, 'seed + донати');
  assert.equal(arch!.donationCount, 1, 'к-сть донатів — реальна');
});
