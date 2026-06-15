import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, resetDynamic } from './db';
import { getGlobalMap, globalCityDetail } from '../lib/globalMap';

const A = 'gm-user-a'; // учасник
const B = 'gm-user-b'; // учасник, потім вимкнемо
let kyiv: string; // settlementId Києва з довідника (статичний, є в тестовій БД)

const base = Date.now();

before(async () => {
  await resetDynamic();
  await testDb.user.upsert({ where: { id: A }, update: { handle: 'gma', showOnGlobalMap: true }, create: { id: A, email: 'a@gm.dev', name: 'Стрімер А', handle: 'gma' } });
  await testDb.user.upsert({ where: { id: B }, update: { handle: 'gmb', showOnGlobalMap: true }, create: { id: B, email: 'b@gm.dev', name: 'Стрімер Б', handle: 'gmb' } });
  kyiv = (await testDb.settlement.findFirstOrThrow({ where: { nameNorm: 'київ' } })).id;
  // А: розпізнаний 100 ₴ (Київ) + нерозпізнаний 50 ₴; Б: розпізнаний 30 ₴ (Київ).
  // Явні createdAt → детермінований порядок стрічки (gm3 найновіший).
  await testDb.donation.createMany({
    data: [
      { userId: A, externalId: 'gm1', donorName: 'Павло Мірний', amount: 100, message: 'Київ', settlementId: kyiv, status: 'recognized', createdAt: new Date(base - 3000) },
      { userId: A, externalId: 'gm2', donorName: 'Анонім Тест', amount: 50, message: '—', status: 'unrecognized', createdAt: new Date(base - 2000) },
      { userId: B, externalId: 'gm3', donorName: 'Оля Зоря', amount: 30, message: 'Київ', settlementId: kyiv, status: 'recognized', createdAt: new Date(base - 1000) },
    ],
  });
});
after(async () => {
  await resetDynamic();
  await testDb.user.deleteMany({ where: { id: { in: [A, B] } } });
  await testDb.$disconnect();
});

test('лічильник — ВСІ донати учасників; топ/мапа/стрічка — лише розпізнані', async () => {
  const d = await getGlobalMap(testDb, { maxAgeMs: 0 });
  assert.equal(d.totalUah, 180);                       // 100 + 50 + 30
  assert.equal(d.litCities.length, 1);                 // лише Київ
  assert.equal(d.litCities[0]!.points, 130);           // ₴ у полі points (для мапи)
  assert.equal(d.top[0]!.sumUah, 130);
  assert.equal(d.feed.length, 2);                      // нерозпізнаний у стрічці не світиться
  assert.match(d.feed[0]!.who, /^Оля З\.$/);           // анонімізація + найновіший
  assert.ok(!('message' in d.feed[0]!));               // текстів повідомлень нема У ТИПІ
});

test('вимкнена участь прибирає стрімера з усіх зрізів', async () => {
  await testDb.user.update({ where: { id: B }, data: { showOnGlobalMap: false } });
  const d = await getGlobalMap(testDb, { maxAgeMs: 0 });
  assert.equal(d.totalUah, 150);
  assert.equal(d.top[0]!.sumUah, 100);
  assert.equal(d.participants.find((p) => p.handle === 'gmb'), undefined);
  await testDb.user.update({ where: { id: B }, data: { showOnGlobalMap: true } });
});

test('модерація: hiddenFromGlobalMap прибирає стрімера з усіх зрізів (навіть з галочкою)', async () => {
  await testDb.user.update({ where: { id: B }, data: { hiddenFromGlobalMap: true } });
  const d = await getGlobalMap(testDb, { maxAgeMs: 0 });
  assert.equal(d.totalUah, 150);                       // лишився тільки А (100 + 50)
  assert.equal(d.top[0]!.sumUah, 100);
  assert.equal(d.participants.find((p) => p.handle === 'gmb'), undefined);
  await testDb.user.update({ where: { id: B }, data: { hiddenFromGlobalMap: false } });
});

test('вікно топу: донат 40 днів тому є у "all", нема у "month"', async () => {
  await testDb.donation.create({ data: { userId: A, externalId: 'gm-old', donorName: 'Давній Дон', amount: 7, message: 'Київ', settlementId: kyiv, status: 'recognized', createdAt: new Date(base - 40 * 86400_000) } });
  const all = await getGlobalMap(testDb, { maxAgeMs: 0 });
  assert.equal(all.top[0]!.sumUah, 137);
  assert.equal((await getGlobalMap(testDb, { maxAgeMs: 0, window: 'month' })).top[0]!.sumUah, 130);
});

test('збір у фокусі: показується лише active + учасник', async () => {
  const col = await testDb.collection.create({ data: { userId: A, name: 'Дрони', status: 'active', goalUah: 1000 } });
  await testDb.appSetting.upsert({ where: { id: 'app' }, update: { featuredCollectionId: col.id }, create: { id: 'app', featuredCollectionId: col.id } });
  let d = await getGlobalMap(testDb, { maxAgeMs: 0 });
  assert.equal(d.featured?.name, 'Дрони');
  await testDb.collection.update({ where: { id: col.id }, data: { status: 'paused' } });
  d = await getGlobalMap(testDb, { maxAgeMs: 0 });
  assert.equal(d.featured, null);
});

test('зараз наживо: відкритий стрім учасника', async () => {
  await testDb.stream.create({ data: { userId: A, name: 'Марафон', startedAt: new Date() } });
  const d = await getGlobalMap(testDb, { maxAgeMs: 0 });
  assert.equal(d.liveNow.length, 1);
  assert.equal(d.liveNow[0]!.streamer.handle, 'gma');
});

test('globalCityDetail: розбивка по стрімерах, без текстів повідомлень', async () => {
  const c = await globalCityDetail(testDb, kyiv);
  assert.ok(c);
  assert.equal(c!.totalUah, 137);
  assert.deepEqual(c!.byStreamer.map((s) => s.handle).sort(), ['gma', 'gmb']);
  assert.ok(c!.recent.every((r) => !('message' in r)));
});

test('/ukraine: «збір у фокусі» рахує реальні донати, без стартової суми (seed туди не йде)', async () => {
  const col = await testDb.collection.create({ data: { userId: A, name: 'СтартЗбір', status: 'active', goalUah: 1000, seedUah: 500 } });
  await testDb.appSetting.upsert({ where: { id: 'app' }, update: { featuredCollectionId: col.id }, create: { id: 'app', featuredCollectionId: col.id } });
  await testDb.donation.create({ data: { userId: A, externalId: 'gm-seed', donorName: 'Реал Дон', amount: 100, message: 'Київ', settlementId: kyiv, status: 'recognized', collectionId: col.id, createdAt: new Date(base) } });
  const d = await getGlobalMap(testDb, { maxAgeMs: 0 });
  assert.equal(d.featured?.name, 'СтартЗбір');
  assert.equal(d.featured?.raisedUah, 100, 'реальні донати — стартова сума на /ukraine не враховується');
  assert.equal(d.featured?.displayedUah, 600, 'displayed існує (seed+реал), але сторінка /ukraine читає raisedUah');
});
