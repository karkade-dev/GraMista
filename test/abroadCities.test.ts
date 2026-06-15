import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from './db';
import { resolveCity } from '../lib/cityResolve';
import { processDonation } from '../lib/ingest';
import { resetDynamic } from './db';
import { leaderboard } from '../lib/leaderboard';
import { mapPoints } from '../lib/map';
import { getState } from '../lib/dashboard';
import { getGlobalMap } from '../lib/globalMap';
import { buildWorldSettlements } from '../lib/etl/worldCities';

after(async () => {
  await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-ab-' } } });
  await testDb.$disconnect();
});

test('abroad: вимкнено — іноземне місто не матчиться (як зараз)', async () => {
  await testDb.settlement.create({
    data: { id: 'tmp-ab-war', name: 'Варшава', nameNorm: 'варшава', country: 'PL', population: 1800000 },
  });
  // Родовий відмінок «Варшави» — аліас з ВЕСУМ; fuzzy для PL не працює (UA-only).
  await testDb.settlementAlias.create({
    data: { settlementId: 'tmp-ab-war', alias: 'Варшави', aliasNorm: 'варшави', source: 'vesum' },
  });
  try {
    assert.equal(await resolveCity(testDb, 'привіт із Варшави'), null);
    const m = await resolveCity(testDb, 'привіт із Варшави', { abroad: true });
    assert.equal(m?.settlementId, 'tmp-ab-war');
  } finally {
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-ab-' } } });
  }
});

test('abroad: Україна-first — UA-тезка перемагає іноземну', async () => {
  await testDb.settlement.createMany({
    data: [
      { id: 'tmp-ab-fpl', name: 'Тестбург', nameNorm: 'тестбург', country: 'PL', population: 900000 },
      { id: 'tmp-ab-fua', name: 'Тестбург', nameNorm: 'тестбург', country: 'UA', oblast: 'Львівська', population: 200 },
    ],
  });
  try {
    const m = await resolveCity(testDb, 'вітання з Тестбург', { abroad: true });
    assert.equal(m?.settlementId, 'tmp-ab-fua');
  } finally {
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-ab-' } } });
  }
});

test('abroad: hideAggressor виключає рф/рб', async () => {
  await testDb.settlement.create({
    data: { id: 'tmp-ab-msk', name: 'Москва', nameNorm: 'москва', country: 'RU', population: 12000000 },
  });
  try {
    assert.equal(await resolveCity(testDb, 'привіт москва', { abroad: true, hideAggressor: true }), null);
    const m = await resolveCity(testDb, 'привіт москва', { abroad: true });
    assert.equal(m?.settlementId, 'tmp-ab-msk');
  } finally {
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-ab-' } } });
  }
});

test('abroad: fuzzy НЕ чіпає закордон (одрук в іноземній назві → null)', async () => {
  await testDb.settlement.create({
    data: { id: 'tmp-ab-bcn', name: 'Барселона', nameNorm: 'барселона', country: 'ES', population: 1600000 },
  });
  try {
    // «барселоно» — similarity('барселоно','барселона')=0.667, ldiff=0: ПРОЙШЛО б fuzzy якби
    // закордон не виключено. Null тут — структурне виключення ES з fuzzy, а не поріг.
    assert.equal(await resolveCity(testDb, 'вітаю з барселоно', { abroad: true }), null);
    // Точний збіг (назва без одруку) — іноземне місто матчиться.
    const m = await resolveCity(testDb, 'Барселона', { abroad: true });
    assert.equal(m?.settlementId, 'tmp-ab-bcn');
  } finally {
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-ab-' } } });
  }
});

test('leaderboard: фільтр country (ua/abroad/обидва)', async () => {
  await resetDynamic();
  await testDb.user.create({ data: { id: 'tmp-ab-lu', email: 'ablu@test.local', name: 'AbLu' } });
  await testDb.settlement.createMany({
    data: [
      { id: 'tmp-ab-lua', name: 'Львів-Т', nameNorm: 'львівт', country: 'UA', population: 700000 },
      { id: 'tmp-ab-lpl', name: 'Варшава-Т', nameNorm: 'варшават', country: 'PL', population: 1800000 },
    ],
  });
  await testDb.pointEvent.createMany({
    data: [
      { userId: 'tmp-ab-lu', settlementId: 'tmp-ab-lua', points: 10, source: 'donation' },
      { userId: 'tmp-ab-lu', settlementId: 'tmp-ab-lpl', points: 5, source: 'donation' },
    ],
  });
  try {
    const ua = await leaderboard(testDb, 'tmp-ab-lu', { country: 'ua' });
    assert.deepEqual(ua.map((r) => r.settlementId), ['tmp-ab-lua']);
    const ab = await leaderboard(testDb, 'tmp-ab-lu', { country: 'abroad' });
    assert.deepEqual(ab.map((r) => r.settlementId), ['tmp-ab-lpl']);
    const both = await leaderboard(testDb, 'tmp-ab-lu', {});
    assert.equal(both.length, 2);
  } finally {
    await resetDynamic();
    await testDb.user.deleteMany({ where: { id: 'tmp-ab-lu' } });
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-ab-' } } });
  }
});

test('mapPoints: includeAbroad керує показом іноземних на мапі', async () => {
  await resetDynamic();
  await testDb.user.create({ data: { id: 'tmp-ab-mu', email: 'abmu@test.local', name: 'AbMu' } });
  await testDb.settlement.createMany({
    data: [
      { id: 'tmp-ab-mua', name: 'Київ-Т', nameNorm: 'київт', country: 'UA', lat: 50.45, lon: 30.52, population: 3000000 },
      { id: 'tmp-ab-mpl', name: 'Краків-Т', nameNorm: 'краківт', country: 'PL', lat: 50.06, lon: 19.94, population: 800000 },
    ],
  });
  await testDb.pointEvent.createMany({
    data: [
      { userId: 'tmp-ab-mu', settlementId: 'tmp-ab-mua', points: 8, source: 'donation' },
      { userId: 'tmp-ab-mu', settlementId: 'tmp-ab-mpl', points: 4, source: 'donation' },
    ],
  });
  try {
    const uaOnly = await mapPoints(testDb, 'tmp-ab-mu', {}, {});
    assert.deepEqual(uaOnly.map((p) => p.id).sort(), ['tmp-ab-mua']);
    const withAbroad = await mapPoints(testDb, 'tmp-ab-mu', {}, { includeAbroad: true });
    assert.equal(withAbroad.length, 2);
    assert.equal(withAbroad.find((p) => p.id === 'tmp-ab-mpl')?.abroad, true);
    assert.equal(withAbroad.find((p) => p.id === 'tmp-ab-mua')?.abroad, false);
  } finally {
    await resetDynamic();
    await testDb.user.deleteMany({ where: { id: 'tmp-ab-mu' } });
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-ab-' } } });
  }
});

test('processDonation: abroad off → іноземний донат нерозпізнаний; on → розпізнаний', async () => {
  await resetDynamic();
  await testDb.settlement.create({
    data: { id: 'tmp-ab-vie', name: 'Відень', nameNorm: 'відень', country: 'AT', lat: 48.2, lon: 16.37, population: 1900000 },
  });
  await testDb.user.create({ data: { id: 'tmp-ab-u1', email: 'ab1@test.local', name: 'Ab1', abroadCities: false } });
  await testDb.user.create({ data: { id: 'tmp-ab-u2', email: 'ab2@test.local', name: 'Ab2', abroadCities: true } });
  try {
    // Називний відмінок у коментарі — матчиться точним збігом (без опори на fuzzy, який лише UA).
    const off = await processDonation(testDb, 'tmp-ab-u1', { externalId: 'd1', donorName: 'X', amountUah: 100, message: 'вітання, Відень!' });
    assert.equal(off.settlementId, null);
    const on = await processDonation(testDb, 'tmp-ab-u2', { externalId: 'd2', donorName: 'X', amountUah: 100, message: 'вітання, Відень!' });
    assert.equal(on.settlementId, 'tmp-ab-vie');
  } finally {
    await resetDynamic();
    await testDb.user.deleteMany({ where: { id: { startsWith: 'tmp-ab-u' } } });
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-ab-' } } });
  }
});

test('getState: separate → leaderboardAbroad окремо; shared → разом; RecentItem.abroad', async () => {
  await resetDynamic();
  await testDb.settlement.createMany({
    data: [
      { id: 'tmp-ab-sua', name: 'Одеса-Т', nameNorm: 'одесат', country: 'UA', lat: 46.48, lon: 30.72, population: 1000000 },
      { id: 'tmp-ab-spl', name: 'Гданськ-Т', nameNorm: 'гданськт', country: 'PL', lat: 54.35, lon: 18.65, population: 470000 },
    ],
  });
  await testDb.user.create({ data: { id: 'tmp-ab-su', email: 'absu@test.local', name: 'AbSu', abroadCities: true, abroadTopMode: 'separate' } });
  await testDb.donation.create({ data: { id: 'tmp-ab-don', userId: 'tmp-ab-su', externalId: 'e1', donorName: 'X', amount: 100, message: 'Гданськ-Т', settlementId: 'tmp-ab-spl', status: 'recognized', pointsAwarded: 1 } });
  await testDb.pointEvent.createMany({
    data: [
      { userId: 'tmp-ab-su', settlementId: 'tmp-ab-sua', points: 9, source: 'donation' },
      { userId: 'tmp-ab-su', settlementId: 'tmp-ab-spl', points: 1, source: 'donation', donationId: 'tmp-ab-don' },
    ],
  });
  try {
    const sep = await getState(testDb, 'tmp-ab-su');
    assert.equal(sep.abroadMode, 'separate');
    assert.deepEqual(sep.leaderboard.map((r) => r.settlementId), ['tmp-ab-sua']);
    assert.deepEqual(sep.leaderboardAbroad?.map((r) => r.settlementId), ['tmp-ab-spl']);
    assert.equal(sep.recent.find((r) => r.externalId === 'e1')?.abroad, true);

    await testDb.user.update({ where: { id: 'tmp-ab-su' }, data: { abroadTopMode: 'shared' } });
    const sh = await getState(testDb, 'tmp-ab-su');
    assert.equal(sh.abroadMode, 'shared');
    assert.equal(sh.leaderboard.length, 2);
    assert.equal(sh.leaderboardAbroad, undefined);
  } finally {
    await resetDynamic();
    await testDb.user.deleteMany({ where: { id: 'tmp-ab-su' } });
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-ab-' } } });
  }
});

test('globalMap: іноземні донати учасника НЕ потрапляють у /ukraine', async () => {
  await resetDynamic();
  await testDb.settlement.createMany({
    data: [
      { id: 'tmp-ab-gua', name: 'Харків-Г', nameNorm: 'харківг', country: 'UA', lat: 49.99, lon: 36.23, population: 1400000 },
      { id: 'tmp-ab-gpl', name: 'Вроцлав-Г', nameNorm: 'вроцлавг', country: 'PL', lat: 51.1, lon: 17.03, population: 640000 },
    ],
  });
  await testDb.user.create({ data: { id: 'tmp-ab-gu', email: 'abgu@test.local', name: 'AbGu', handle: 'abgu', showOnGlobalMap: true } });
  await testDb.donation.createMany({
    data: [
      { id: 'tmp-ab-gd1', userId: 'tmp-ab-gu', externalId: 'g1', donorName: 'X', amount: 500, message: 'Харків', settlementId: 'tmp-ab-gua', status: 'recognized' },
      { id: 'tmp-ab-gd2', userId: 'tmp-ab-gu', externalId: 'g2', donorName: 'Y', amount: 700, message: 'Вроцлав', settlementId: 'tmp-ab-gpl', status: 'recognized' },
    ],
  });
  try {
    const g = await getGlobalMap(testDb, { maxAgeMs: 0 });
    const ids = g.top.map((r) => r.settlementId);
    assert.ok(ids.includes('tmp-ab-gua'), 'UA місто має бути в топі');
    assert.ok(!ids.includes('tmp-ab-gpl'), 'іноземне місто НЕ має бути в топі');
    assert.ok(!g.litCities.some((c) => c.id === 'tmp-ab-gpl'), 'іноземне місто НЕ на мапі');
    assert.ok(!g.feed.some((f) => f.city === 'Вроцлав-Г'), 'іноземне місто НЕ у стрічці');
    assert.equal(g.settlementsTotal, await testDb.settlement.count({ where: { country: 'UA' } }), 'settlementsTotal — лише українські НП');
  } finally {
    await resetDynamic();
    await testDb.user.deleteMany({ where: { id: 'tmp-ab-gu' } });
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-ab-' } } });
  }
});

test('worldCities: лише міста з українською назвою → Settlement з country', () => {
  const cities = [
    '756135\tWarsaw\tWarsaw\tWarszawa\t52.23\t21.01\tP\t\tPL\t\t\t\t\t\t1790658',
    '2950159\tBerlin\tBerlin\tBerlin\t52.52\t13.40\tP\t\tDE\t\t\t\t\t\t3426354',
  ].join('\n');
  const altNames = [
    '1\t756135\tuk\tВаршава\t1',
    '2\t2950159\tuk\tБерлін\t1',
    '3\t2950159\tru\tБерлин',
  ].join('\n');

  const out = buildWorldSettlements(cities, altNames);
  const war = out.find((s) => s.id === 'g756135');
  assert.equal(war?.name, 'Варшава');
  assert.equal(war?.nameNorm, 'варшава');
  assert.equal(war?.country, 'PL');
  assert.equal(war?.lat, 52.23);
  const ber = out.find((s) => s.id === 'g2950159');
  assert.ok(ber?.aliases.includes('Берлин'));
});

test('worldCities: місто без української назви — пропущене', () => {
  const cities = ['999\tNowhere\tNowhere\tNowhere\t10\t10\tP\t\tFR\t\t\t\t\t\t50000'].join('\n');
  const out = buildWorldSettlements(cities, '');
  assert.equal(out.length, 0);
});
