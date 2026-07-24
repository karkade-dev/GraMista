import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { testDb } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import { searchSettlements, addAlias } from '../lib/settlements';
import { resolveCity } from '../lib/cityResolve';

const U = DEFAULT_USER_ID;

// Довідник (Settlement/SettlementAlias) seed-иться раз (db:test:setup) і не чиститься
// resetDynamic — тож тест читає реальні seed-дані. Ручні аліаси прибираємо самі.

async function cleanManualAliases(): Promise<void> {
  await testDb.settlementAlias.deleteMany({ where: { source: 'manual' } });
}

after(async () => {
  await testDb.$disconnect();
});

test('searchSettlements: за назвою, за аліасом, мін. довжина, ліміт', async () => {
  const byName = await searchSettlements(testDb, 'льві');
  assert.ok(byName.some((s) => s.name === 'Львів'), 'знайти за назвою');

  const byAlias = await searchSettlements(testDb, 'lvov');
  assert.ok(byAlias.some((s) => s.name === 'Львів'), 'знайти за аліасом (транслітерація)');

  assert.deepEqual(await searchSettlements(testDb, 'л'), [], 'надто короткий запит → порожньо');

  const limited = await searchSettlements(testDb, 'ів', 1);
  assert.ok(limited.length <= 1, 'ліміт дотримано');
});

test('addAlias: приватний синонім — бачить лише власник (мультитенант); дедуп', async () => {
  await cleanManualAliases();
  try {
    const res = await addAlias(testDb, U, 'kyiv', 'Мегаполіс');
    assert.ok(res?.ok);
    assert.equal(res.aliasNorm, 'мегаполіс');

    // власник бачить — і в пошуку Адмінки, і в авто-розпізнаванні донату
    assert.ok(
      (await searchSettlements(testDb, 'мегаполіс', 8, U)).some((s) => s.id === 'kyiv'),
      'власник бачить аліас у пошуку',
    );
    assert.equal(
      (await resolveCity(testDb, 'привіт з мегаполіс друзі', { userId: U }))?.settlementId,
      'kyiv',
      'власник бачить аліас у розпізнаванні',
    );

    // чужий стрімер і анонім (без userId) приватний синонім НЕ бачать — дія одного не тече до інших
    assert.deepEqual(await searchSettlements(testDb, 'мегаполіс'), [], 'без userId — не видно');
    assert.deepEqual(await searchSettlements(testDb, 'мегаполіс', 8, 'other-user'), [], 'інший стрімер — не видно');
    assert.equal(await resolveCity(testDb, 'привіт з мегаполіс друзі'), null, 'без userId — не розпізнає');
    assert.equal(
      await resolveCity(testDb, 'привіт з мегаполіс друзі', { userId: 'other-user' }),
      null,
      'інший стрімер — не розпізнає',
    );

    // дедуп — повторне додавання тим самим стрімером не створює другий запис
    await addAlias(testDb, U, 'kyiv', 'мегаполіс');
    const count = await testDb.settlementAlias.count({ where: { settlementId: 'kyiv', aliasNorm: 'мегаполіс' } });
    assert.equal(count, 1, 'без дублів');
  } finally {
    await cleanManualAliases();
  }
});

test('searchSettlements: спільний аліас (системний, userId=null) видно всім стрімерам', async () => {
  // 'lvov' — seed-аліас Львова без власника → видно і анонімно, і будь-якому стрімеру.
  assert.ok((await searchSettlements(testDb, 'lvov', 8, 'other-user')).some((s) => s.name === 'Львів'));
});

test('addAlias: неіснуюче місто або закороткий аліас → null', async () => {
  assert.equal(await addAlias(testDb, U, 'nope-city', 'Тест'), null);
  assert.equal(await addAlias(testDb, U, 'kyiv', 'a'), null); // < 2 символів після нормалізації
});

// Тезки з низьким/невідомим населенням (як Рокитне-Київська, Микільське-Сумська): у реальній
// базі їх десятки на одну назву і всі з population=null. Старий пошук відсікав їх лімітом 8 і
// ховав за тими, що мають населення → стрімер «не бачив» потрібного. Фікстура моделює це.
const NAMESAKE_OBLASTS = [
  'Сумська', 'Київська', 'Львівська', 'Полтавська', 'Харківська', 'Одеська',
  'Волинська', 'Донецька', 'Рівненська', 'Чернігівська', 'Житомирська', 'Вінницька',
];
async function createNamesakes(): Promise<void> {
  await testDb.settlement.createMany({
    data: NAMESAKE_OBLASTS.map((oblast, i) => ({
      id: `zt-${i}`, name: 'Зонетест', nameNorm: 'зонетест', oblast,
      raion: `${oblast} район`, type: 'село', population: null,
    })),
    skipDuplicates: true,
  });
}
async function dropNamesakes(): Promise<void> {
  await testDb.settlement.deleteMany({ where: { id: { startsWith: 'zt-' } } });
}

test('searchSettlements: усі тезки з null-населенням повертаються (не відсікаються)', async () => {
  await createNamesakes();
  try {
    const hits = await searchSettlements(testDb, 'Зонетест');
    assert.equal(hits.length, NAMESAKE_OBLASTS.length, 'усі тезки у видачі (ліміт за замовч. вміщає їх)');
    assert.ok(hits.some((h) => h.oblast === 'Київська'), 'Київська-тезка присутня');
    assert.ok(hits.some((h) => h.oblast === 'Сумська'), 'Сумська-тезка присутня');
  } finally {
    await dropNamesakes();
  }
});

test('searchSettlements: підказка області у запиті фільтрує тезок', async () => {
  await createNamesakes();
  try {
    const sumy = await searchSettlements(testDb, 'Зонетест Сумщина');
    assert.deepEqual(sumy.map((h) => h.oblast), ['Сумська'], 'лише Сумська');

    const kyiv = await searchSettlements(testDb, 'Зонетест Київська');
    assert.deepEqual(kyiv.map((h) => h.oblast), ['Київська'], 'лише Київська');
  } finally {
    await dropNamesakes();
  }
});

test('searchSettlements: тезки сортуються за областю (легко проглянути)', async () => {
  await createNamesakes();
  try {
    const hits = await searchSettlements(testDb, 'Зонетест');
    const oblasts = hits.map((h) => h.oblast ?? '');
    const sorted = [...oblasts].sort((a, b) => a.localeCompare(b, 'uk'));
    assert.deepEqual(oblasts, sorted, 'видача за областю за абеткою');
  } finally {
    await dropNamesakes();
  }
});

test('searchSettlements v2: префікс перемагає, одруки ловляться, район повертається', async () => {
  // префікс: «терн» → Тернопіль першим (найбільше населення серед префіксних)
  const pre = await searchSettlements(testDb, 'терн');
  assert.equal(pre[0]?.name, 'Тернопіль');
  assert.ok('raion' in (pre[0] ?? {}), 'у відповіді є район');

  // одрук: «полтва» → Полтава (trgm-схожість)
  const fuzzy = await searchSettlements(testDb, 'полтва');
  assert.equal(fuzzy[0]?.name, 'Полтава');

  // тезки відрізняються районом: тимчасова фікстура
  await testDb.settlement.create({
    data: { id: 'tmp-ss-1', name: 'Тестове', nameNorm: 'тестове', oblast: 'Сумська', raion: 'Конотопський район', population: 10 },
  });
  try {
    const hit = await searchSettlements(testDb, 'тестове');
    assert.equal(hit[0]?.raion, 'Конотопський район');
  } finally {
    await testDb.settlement.deleteMany({ where: { id: 'tmp-ss-1' } });
  }
});
