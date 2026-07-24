import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { testDb, resetDynamic } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import { startStream } from '../lib/streams';
import { createCollection } from '../lib/collections';
import { applyDonation } from '../lib/scoring';
import { buildStreamReportData, buildCollectionReportData } from '../lib/reportData';

const U = DEFAULT_USER_ID;

// Донат у місто в межах стріму: 100+ ₴ дають бали одразу (без пулу), тож місто одразу в топі/на мапі.
async function donate(streamId: string, ext: string, settlementId: string, name: string, uah: number): Promise<void> {
  await applyDonation(testDb, U, { externalId: ext, donorName: 'Донор', amountUah: uah, message: name }, settlementId, streamId);
}

// Донат у місто в межах збору (позначка collectionId): бали й точка мапи скоупляться збором.
async function donateColl(collectionId: string, ext: string, settlementId: string, uah: number): Promise<void> {
  await applyDonation(testDb, U, { externalId: ext, donorName: 'Донор', amountUah: uah, message: '' }, settlementId, null, { collectionId });
}

beforeEach(async () => {
  await resetDynamic();
});

after(async () => {
  await testDb.$disconnect();
});

test('порожній стрім → empty:true, top порожній, 3 числа, мапа порожня', async () => {
  const s = await startStream(testDb, U, 'Порожній');
  const d = (await buildStreamReportData(testDb, U, s.id, 5))!;
  assert.ok(d);
  assert.equal(d.empty, true);
  assert.equal(d.top.length, 0);
  assert.equal(d.hero.label, 'зібрано за стрім');
  assert.equal(d.stats.length, 2);
  assert.equal(d.map.length, 0);
});

test('pct нормується до топ-1, порядок за балами, мапа крапками, без QR', async () => {
  const s = await startStream(testDb, U, 'Топ');
  await donate(s.id, 'k1', 'kyiv', 'Київ', 1000); // 10 балів
  await donate(s.id, 'l1', 'lviv', 'Львів', 500); // 5 балів
  const d = (await buildStreamReportData(testDb, U, s.id, 5))!;
  assert.equal(d.top[0]!.name, 'Київ');
  assert.equal(d.top[0]!.rank, 1);
  assert.equal(d.top[0]!.pct, 1);
  assert.ok(d.top[1]!.pct < 1);
  assert.equal(d.top[0]!.abroad, false);
  // Мапа — обидва UA-міста крапками (підпис на мапі не малюємо: resvg не рендерить SVG-текст).
  assert.equal(d.map.length, 2);
  // Дефолтний користувач без хендла → без QR.
  assert.equal(d.qr, null);
});

test('топ обмежується topN (6 міст, топ-5 → рівно 5 рядків)', async () => {
  const s = await startStream(testDb, U, 'Багато міст');
  const cities: [string, string, number][] = [
    ['kyiv', 'Київ', 1000], ['kharkiv', 'Харків', 900], ['odesa', 'Одеса', 800],
    ['dnipro', 'Дніпро', 700], ['lviv', 'Львів', 600], ['mykolaiv', 'Миколаїв', 500],
  ];
  for (const [id, name, uah] of cities) await donate(s.id, `d-${id}`, id, name, uah);
  const d = (await buildStreamReportData(testDb, U, s.id, 5))!;
  assert.equal(d.top.length, 5);
  assert.equal(d.top[0]!.name, 'Київ');
});

test('чужий/неіснуючий стрім → null', async () => {
  assert.equal(await buildStreamReportData(testDb, U, 'no-such-id', 5), null);
});

test('збір із ціллю → kind collection, goal з фактичним %, герой-сума, другорядні числа без дублю, діапазон дат', async () => {
  const c = await createCollection(testDb, U, {
    name: 'На реанімобіль',
    goalUah: 1000,
    startAt: new Date('2026-06-01T10:00:00'),
    endAt: new Date('2026-07-18T10:00:00'),
  });
  await donateColl(c.id, 'cd1', 'kyiv', 500); // разом displayedUah=740, pct=round(740/1000*100)=74
  await donateColl(c.id, 'cd2', 'lviv', 240);

  const d = (await buildCollectionReportData(testDb, U, c.id, 5))!;
  assert.ok(d);
  assert.equal(d.kind, 'collection');
  assert.equal(d.title, 'На реанімобіль');
  // subtitle — діапазон дат «старт – кінець».
  assert.ok(d.subtitle.includes('01.06.2026') && d.subtitle.includes('18.07.2026'), d.subtitle);
  assert.ok(d.goal);
  assert.equal(d.goal!.goalUah, 1000);
  assert.equal(d.goal!.raisedUah, 740); // displayedUah (seed 0)
  assert.equal(d.goal!.pct, Math.round((740 / 1000) * 100));
  // Сума-герой і % (goal) не дублюються в другорядних числах: там масштаб гри й стріми.
  assert.equal(d.hero.label, 'зібрано');
  assert.ok(d.stats.some((s) => s.label === 'міст у грі'));
  assert.ok(!d.stats.some((s) => s.label === 'виконано'));
  assert.equal(d.stats.length, 2);
  // Топ і мапа скоуплені збором.
  assert.equal(d.top[0]!.name, 'Київ');
  assert.equal(d.top[0]!.pct, 1);
  assert.equal(d.map.length, 2);
  assert.equal(d.empty, false);
});

test('збір без цілі → goal undefined, стат «міст у грі», старт без діапазону', async () => {
  const c = await createCollection(testDb, U, { name: 'Серія без цілі', startAt: new Date('2026-05-05T10:00:00') });
  await donateColl(c.id, 'ng1', 'odesa', 500);

  const d = (await buildCollectionReportData(testDb, U, c.id, 10))!;
  assert.equal(d.kind, 'collection');
  assert.equal(d.goal, undefined);
  assert.ok(d.stats.some((s) => s.label === 'міст у грі'));
  assert.ok(!d.subtitle.includes(' – '), 'без endAt — без діапазону');
});

test('порожній збір → empty:true, top/мапа порожні, герой + 2 числа', async () => {
  const c = await createCollection(testDb, U, { name: 'Порожній збір', goalUah: 500 });
  const d = (await buildCollectionReportData(testDb, U, c.id, 5))!;
  assert.equal(d.empty, true);
  assert.equal(d.top.length, 0);
  assert.equal(d.map.length, 0);
  assert.equal(d.hero.label, 'зібрано');
  assert.equal(d.stats.length, 2);
});

test('чужий/неіснуючий збір → null', async () => {
  assert.equal(await buildCollectionReportData(testDb, U, 'no-such-id', 5), null);
});

// Раніше `cities` збору обрізався на 200, тож «міст у грі» на картинці й повний перелік у тексті
// звіту впиралися в саму константу ліміту (прод: 272 міста → показувало 200).
test('понад 200 міст: «міст у грі» — фактична кількість, не обрізана', async () => {
  const N = 205;
  const ids = Array.from({ length: N }, (_, i) => `cap-${String(i).padStart(3, '0')}`);
  await testDb.settlement.createMany({
    data: ids.map((id, i) => ({ id, name: `Місто ${i}`, nameNorm: `misto ${i}`, country: 'UA' })),
    skipDuplicates: true,
  });
  try {
    const c = await createCollection(testDb, U, { name: 'Великий збір' });
    await testDb.pointEvent.createMany({
      data: ids.map((id, i) => ({ userId: U, settlementId: id, points: i + 1, source: 'donation' as const, collectionId: c.id })),
    });
    const d = (await buildCollectionReportData(testDb, U, c.id, 10))!;
    assert.equal(d.stats.find((s) => s.label === 'міст у грі')?.value, String(N));
    assert.equal(d.top.length, 10, 'сама картинка лишається топ-N');
  } finally {
    await testDb.settlement.deleteMany({ where: { id: { in: ids } } });
  }
});
