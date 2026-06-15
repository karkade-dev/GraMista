import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from './db';
import { resolveCity } from '../lib/cityResolve';

after(async () => {
  await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-cr-' } } });
  await testDb.$disconnect();
});

test('точний збіг: назва, відмінок-аліас, латиниця, складена назва', async () => {
  assert.equal((await resolveCity(testDb, 'Полтава найкраща!'))?.settlementId, 'poltava');
  assert.equal((await resolveCity(testDb, 'З Києва вітання'))?.settlementId, 'kyiv'); // аліас «києва»
  assert.equal((await resolveCity(testDb, 'kyiv'))?.settlementId, 'kyiv'); // латиниця
  assert.equal((await resolveCity(testDb, 'Кривий Ріг тримається'))?.settlementId, 'kryvyi-rih');
  assert.equal((await resolveCity(testDb, 'кривому розі привіт'))?.settlementId, 'kryvyi-rih');
});

test('нема міста → null (донат лишиться нерозпізнаним)', async () => {
  assert.equal(await resolveCity(testDb, ''), null);
  assert.equal(await resolveCity(testDb, 'просто дякую за стрім'), null);
});

test('fuzzy: одруки й відмінки поза аліасами ловляться', async () => {
  // одрук: пропущена літера
  assert.equal((await resolveCity(testDb, 'привіт із запоріжя'))?.settlementId, 'zaporizhzhia');
  // відмінок, якого нема в seed-аліасах
  assert.equal((await resolveCity(testDb, 'з тернопіля'))?.settlementId, 'ternopil');
});

test('fuzzy НЕ спрацьовує на коротких назвах і схожих словах', async () => {
  // «суми» (4 літери) виключені з fuzzy за довжиною: «сумно» не дає бали Сумам
  assert.equal(await resolveCity(testDb, 'сумно мені дуже'), null);
  // а точний збіг короткої назви — працює
  assert.equal((await resolveCity(testDb, 'Суми вперед'))?.settlementId, 'sumy');
});

test('тезки: перемагає більше населення (детерміновано)', async () => {
  await testDb.settlement.createMany({
    data: [
      { id: 'tmp-cr-a', name: 'Тестівка', nameNorm: 'тестівка', oblast: 'Сумська', population: 100 },
      { id: 'tmp-cr-b', name: 'Тестівка', nameNorm: 'тестівка', oblast: 'Одеська', population: 5000 },
    ],
  });
  assert.equal((await resolveCity(testDb, 'привіт з міста Тестівка'))?.settlementId, 'tmp-cr-b');
  await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-cr-' } } });
});

test('тезки: підказка області в коментарі перемагає населення (точний і fuzzy шляхи)', async () => {
  await testDb.settlement.createMany({
    data: [
      { id: 'tmp-cr-h1', name: 'Тестівка', nameNorm: 'тестівка', oblast: 'Сумська', population: 100 },
      { id: 'tmp-cr-h2', name: 'Тестівка', nameNorm: 'тестівка', oblast: 'Одеська', population: 5000 },
    ],
  });
  try {
    // точний шлях: назва + прикметник області
    assert.equal((await resolveCity(testDb, 'Тестівка Сумська'))?.settlementId, 'tmp-cr-h1');
    // fuzzy-шлях: відмінок (аліаса нема) + «на Сумщині»
    assert.equal((await resolveCity(testDb, 'з Тестівки на Сумщині'))?.settlementId, 'tmp-cr-h1');
    // без підказки — як і раніше, найбільша
    assert.equal((await resolveCity(testDb, 'Тестівка'))?.settlementId, 'tmp-cr-h2');
    // підказка, що не збігається з жодним кандидатом, — нешкідлива (діє населення)
    assert.equal((await resolveCity(testDb, 'Тестівка Львівська'))?.settlementId, 'tmp-cr-h2');
  } finally {
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-cr-' } } });
  }
});

test('уточнювач-«де» (обл. центр) не перемагає мале місто в тій самій області', async () => {
  await testDb.settlement.createMany({
    data: [
      { id: 'tmp-cr-dol', name: 'Долина', nameNorm: 'долина', oblast: 'Івано-Франківська', population: 20000 },
      { id: 'tmp-cr-nbr', name: 'Нижній Березів', nameNorm: 'нижній березів', oblast: 'Івано-Франківська', population: 1500 },
    ],
  });
  // Відтворюємо прод: VESUM-аліас «івано франківська» — відмінок міста, що збігається з прикметником
  // області. Саме він матчив Івано-Франківськ у реальних коментарях і «з'їдав» мале місто.
  await testDb.settlementAlias.create({
    data: { settlementId: 'ivano-frankivsk', alias: 'Івано-Франківська', aliasNorm: 'івано франківська', source: 'vesum' },
  });
  try {
    // голою назвою центру
    assert.equal((await resolveCity(testDb, 'Долина Івано-Франківськ'))?.settlementId, 'tmp-cr-dol');
    // реальні коментарі з прода (прикметник + «область»)
    assert.equal((await resolveCity(testDb, 'Долина, Івано-Франківська область, Калуський район'))?.settlementId, 'tmp-cr-dol');
    assert.equal((await resolveCity(testDb, 'Нижній Березів, Івано-франківська область'))?.settlementId, 'tmp-cr-nbr');
    // а коли названо ЛИШЕ центр — він і резолвиться (fallback, поведінку не ламаємо)
    assert.equal((await resolveCity(testDb, 'Івано-Франківськ форева'))?.settlementId, 'ivano-frankivsk');
    assert.equal((await resolveCity(testDb, 'З Івано-Франківська вітання'))?.settlementId, 'ivano-frankivsk');
  } finally {
    await testDb.settlementAlias.deleteMany({ where: { settlementId: 'ivano-frankivsk', aliasNorm: 'івано франківська' } });
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-cr-' } } });
  }
});

test('fuzzy НЕ дає бали селам за звичайні слова коментаря (хибні збіги на повній базі)', async () => {
  // Реальний кейс із повного датасету: «просто» схоже на село «Просторе» (similarity 0.6),
  // «привіт» — на «Привітне». Поріг 0.55 + різниця довжин ≤1 мусять це відсікати.
  await testDb.settlement.createMany({
    data: [
      { id: 'tmp-cr-fp1', name: 'Просторе', nameNorm: 'просторе', oblast: 'Запорізька', population: 300 },
      { id: 'tmp-cr-fp2', name: 'Привітне', nameNorm: 'привітне', oblast: 'Волинська', population: 200 },
    ],
  });
  try {
    assert.equal(await resolveCity(testDb, 'просто дякую за стрім'), null, '«просто» ≠ Просторе');
    assert.equal(await resolveCity(testDb, 'привіт усім у чаті'), null, '«привіт» ≠ Привітне');
    // а ТОЧНА назва такого села — далі працює
    assert.equal((await resolveCity(testDb, 'село Просторе'))?.settlementId, 'tmp-cr-fp1');
  } finally {
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-cr-' } } });
  }
});

test('стоп-правило: села-звичайні-слова — бали лише з маркером/областю; великі міста виключені', async () => {
  await testDb.settlement.create({
    data: { id: 'tmp-cr-st1', name: 'Добре', nameNorm: 'добре', oblast: 'Миколаївська', population: 300 },
  });
  try {
    // звичайна фраза БЕЗ маркера — не дає бали селу (донат у чергу адмінки)
    assert.equal(await resolveCity(testDb, 'все буде добре'), null);
    // маркер «село» перед назвою — впевнений намір
    assert.equal((await resolveCity(testDb, 'село Добре'))?.settlementId, 'tmp-cr-st1');
    assert.equal((await resolveCity(testDb, 'привіт із села Добре'))?.settlementId, 'tmp-cr-st1');
    // підказка області — теж впевнений намір
    assert.equal((await resolveCity(testDb, 'Добре Миколаївська'))?.settlementId, 'tmp-cr-st1');
    // великі міста зі «звичайними» назвами (Суми, Рівне) — як завжди, без маркера (виняток за населенням)
    assert.equal((await resolveCity(testDb, 'Рівне!!!'))?.settlementId, 'rivne');
    assert.equal((await resolveCity(testDb, 'Суми вперед'))?.settlementId, 'sumy');
  } finally {
    await testDb.settlement.deleteMany({ where: { id: { startsWith: 'tmp-cr-' } } });
  }
});
