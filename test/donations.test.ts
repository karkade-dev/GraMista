import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { testDb, resetDynamic } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import {
  listDonations,
  listAllDonations,
  listDonationCities,
  donationsToCsv,
  parseDonationFilter,
  encodeCursor,
  parseCursor,
  type DonationRow,
} from '../lib/donations';
import { applyDonation } from '../lib/scoring';

const U = DEFAULT_USER_ID;
const BASE = new Date('2026-01-01T00:00:00.000Z').getTime();

/** Створює n донатів із зростаючим createdAt (i=0 — найстаріший, i=n-1 — найновіший). */
async function seedSeq(n: number) {
  for (let i = 0; i < n; i++) {
    await testDb.donation.create({
      data: {
        userId: U,
        externalId: `d${i}`,
        donorName: `Донатер ${i}`,
        amount: 100 + i,
        message: `повідомлення ${i}`,
        status: 'unrecognized',
        createdAt: new Date(BASE + i * 1000),
      },
    });
  }
}

beforeEach(async () => {
  await resetDynamic();
});

after(async () => {
  await testDb.$disconnect();
});

test('keyset-пагінація: 30/стор., next/prev курсори, рух уперед і назад', async () => {
  await seedSeq(35); // d0..d34, d34 — найновіший

  // Сторінка 1 (без курсора): 30 найновіших, від d34 до d5
  const p1 = await listDonations(testDb, U, {});
  assert.equal(p1.rows.length, 30);
  assert.equal(p1.rows[0]?.externalId, 'd34'); // найновіший зверху
  assert.equal(p1.rows[29]?.externalId, 'd5');
  assert.equal(p1.prevCursor, null); // перша сторінка
  assert.ok(p1.nextCursor); // є старіші

  // Сторінка 2 (далі): решта 5 — d4..d0
  const p2 = await listDonations(testDb, U, {}, { cursor: p1.nextCursor!, nav: 'next' });
  assert.equal(p2.rows.length, 5);
  assert.equal(p2.rows[0]?.externalId, 'd4');
  assert.equal(p2.rows[4]?.externalId, 'd0');
  assert.equal(p2.nextCursor, null); // остання сторінка
  assert.ok(p2.prevCursor); // є новіші

  // Назад зі сторінки 2 → знову повна сторінка 1
  const back = await listDonations(testDb, U, {}, { cursor: p2.prevCursor!, nav: 'prev' });
  assert.equal(back.rows.length, 30);
  assert.equal(back.rows[0]?.externalId, 'd34');
  assert.equal(back.rows[29]?.externalId, 'd5');
});

test('DonationRow.settlementId: розпізнаний має id міста, нерозпізнаний — null (для навчання синоніму)', async () => {
  await applyDonation(testDb, U, { externalId: 'rec', donorName: 'A', amountUah: 100, message: 'Київ' }, 'kyiv');
  await testDb.donation.create({
    data: { userId: U, externalId: 'unr', donorName: 'B', amount: 50, message: 'хз', status: 'unrecognized' },
  });
  const p = await listDonations(testDb, U, {});
  const byId = Object.fromEntries(p.rows.map((r) => [r.externalId, r]));
  assert.equal(byId['rec']?.settlementId, 'kyiv');
  assert.equal(byId['unr']?.settlementId, null);
});

test('keyset за сумою: desc/asc + пагінація вперед-назад', async () => {
  await seedSeq(35); // amount = 100+i (унікальні): d0=100 … d34=134

  // Сума desc: найбільша зверху (d34=134), сторінка 1 = d34..d5
  const p1 = await listDonations(testDb, U, {}, { sort: 'amount', dir: 'desc' });
  assert.equal(p1.rows.length, 30);
  assert.equal(p1.rows[0]?.externalId, 'd34');
  assert.equal(p1.rows[0]?.amountUah, 134);
  assert.equal(p1.rows[29]?.externalId, 'd5');
  assert.equal(p1.prevCursor, null);
  assert.ok(p1.nextCursor);

  // Сторінка 2: решта 5 (найменші суми) — d4..d0
  const p2 = await listDonations(testDb, U, {}, { sort: 'amount', dir: 'desc', cursor: p1.nextCursor!, nav: 'next' });
  assert.equal(p2.rows.length, 5);
  assert.equal(p2.rows[0]?.externalId, 'd4');
  assert.equal(p2.rows[4]?.externalId, 'd0');
  assert.equal(p2.nextCursor, null);
  assert.ok(p2.prevCursor);

  // Назад → знову повна сторінка 1
  const back = await listDonations(testDb, U, {}, { sort: 'amount', dir: 'desc', cursor: p2.prevCursor!, nav: 'prev' });
  assert.equal(back.rows[0]?.externalId, 'd34');
  assert.equal(back.rows[29]?.externalId, 'd5');

  // Сума asc: найменша зверху (d0=100)
  const asc = await listDonations(testDb, U, {}, { sort: 'amount', dir: 'asc' });
  assert.equal(asc.rows[0]?.externalId, 'd0');
  assert.equal(asc.rows[0]?.amountUah, 100);
  assert.equal(asc.rows[29]?.externalId, 'd29');
});

test('сортування за сумою відрізняється від сортування за датою', async () => {
  // У порядку часу: A(найстаріший, 500), B(150), C(найновіший, 300)
  const t = new Date('2026-03-01T00:00:00.000Z').getTime();
  for (const [eid, amt, k] of [['A', 500, 0], ['B', 150, 1], ['C', 300, 2]] as const) {
    await testDb.donation.create({
      data: { userId: U, externalId: eid, donorName: 'X', amount: amt, message: '', status: 'unrecognized', createdAt: new Date(t + k * 1000) },
    });
  }
  // дата desc → C, B, A (найновіші зверху)
  const byDate = await listDonations(testDb, U, {}, { sort: 'date', dir: 'desc' });
  assert.deepEqual(byDate.rows.map((r) => r.externalId), ['C', 'B', 'A']);
  // сума desc → A(500), C(300), B(150)
  const byAmt = await listDonations(testDb, U, {}, { sort: 'amount', dir: 'desc' });
  assert.deepEqual(byAmt.rows.map((r) => r.externalId), ['A', 'C', 'B']);
});

test('пошук за іменем донатера — регістронезалежний підрядок', async () => {
  await testDb.donation.create({
    data: { userId: U, externalId: 'a', donorName: 'Дмитро Петренко', amount: 200, message: '', status: 'unrecognized' },
  });
  await testDb.donation.create({
    data: { userId: U, externalId: 'b', donorName: 'Іван Сидоренко', amount: 200, message: '', status: 'unrecognized' },
  });

  const res = await listDonations(testDb, U, { search: 'дмитро' });
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0]?.externalId, 'a');
  assert.equal(res.rows[0]?.who, 'Дмитро Петренко'); // приватна панель — повне ім'я (= те, за чим шукаємо)

  // Пошук за прізвищем (його видно в колонці, бо ім'я повне) — теж знаходить.
  const bySurname = await listDonations(testDb, U, { search: 'петренко' });
  assert.equal(bySurname.rows.length, 1);
  assert.equal(bySurname.rows[0]?.externalId, 'a');
});

test('пошук знаходить і фразу в коментарі донату', async () => {
  await testDb.donation.create({
    data: { userId: U, externalId: 'a', donorName: 'Дмитро Петренко', amount: 200, message: 'Слава Україні з Полтави!', status: 'unrecognized' },
  });
  await testDb.donation.create({
    data: { userId: U, externalId: 'b', donorName: 'Іван Сидоренко', amount: 200, message: 'привіт стріму', status: 'unrecognized' },
  });

  // Фраза є лише в коментарі — донатер з таким ім'ям відсутній.
  const byPhrase = await listDonations(testDb, U, { search: 'з полтави' });
  assert.deepEqual(byPhrase.rows.map((r) => r.externalId), ['a']);

  // Пошук за іменем при цьому не зламався.
  const byName = await listDonations(testDb, U, { search: 'сидоренко' });
  assert.deepEqual(byName.rows.map((r) => r.externalId), ['b']);

  // Збіг і в імені, і в коментарі іншого донату — обидва рядки, без дублів.
  const both = await listDonations(testDb, U, { search: 'і' });
  assert.equal(both.rows.length, 2);
});

test('фільтр діапазону суми (від–до)', async () => {
  for (const [eid, amt] of [['lo', 50], ['mid', 150], ['hi', 500]] as const) {
    await testDb.donation.create({
      data: { userId: U, externalId: eid, donorName: 'X', amount: amt, message: '', status: 'unrecognized' },
    });
  }

  const min = await listDonations(testDb, U, { minUah: 100 });
  assert.deepEqual(min.rows.map((r) => r.externalId).sort(), ['hi', 'mid']);

  const max = await listDonations(testDb, U, { maxUah: 200 });
  assert.deepEqual(max.rows.map((r) => r.externalId).sort(), ['lo', 'mid']);

  const range = await listDonations(testDb, U, { minUah: 100, maxUah: 200 });
  assert.deepEqual(range.rows.map((r) => r.externalId), ['mid']);
});

test('фільтри: місто, стрім, період, статус (розпізнано / скарбничка / нерозпізнано)', async () => {
  const s1 = await testDb.stream.create({ data: { userId: U, name: 'S1', startedAt: new Date() } });
  await applyDonation(testDb, U, { externalId: 'k1', donorName: 'A', amountUah: 500, message: 'Київ' }, 'kyiv', s1.id); // recognized +5
  await applyDonation(testDb, U, { externalId: 'k2', donorName: 'B', amountUah: 50, message: 'Київ' }, 'kyiv'); // pocket (0 балів)
  await applyDonation(testDb, U, { externalId: 'l1', donorName: 'C', amountUah: 300, message: 'Львів' }, 'lviv'); // recognized +3
  await applyDonation(testDb, U, { externalId: 'u1', donorName: 'D', amountUah: 200, message: 'без міста' }, null); // unrecognized
  const old = new Date(Date.now() - 40 * 86400000);
  await testDb.donation.create({
    data: { userId: U, externalId: 'k3', donorName: 'E', amount: 200, message: 'Київ', settlementId: 'kyiv', status: 'recognized', pointsAwarded: 2, createdAt: old },
  });

  const byCity = await listDonations(testDb, U, { settlementId: 'kyiv' });
  assert.deepEqual(byCity.rows.map((r) => r.externalId).sort(), ['k1', 'k2', 'k3']);

  const byStream = await listDonations(testDb, U, { streamId: s1.id });
  assert.deepEqual(byStream.rows.map((r) => r.externalId), ['k1']);

  const pocket = await listDonations(testDb, U, { status: 'pocket' });
  assert.deepEqual(pocket.rows.map((r) => r.externalId), ['k2']); // recognized, але 0 балів

  const recog = await listDonations(testDb, U, { status: 'recognized' });
  assert.deepEqual(recog.rows.map((r) => r.externalId).sort(), ['k1', 'k3', 'l1']); // з балами, без скарбнички

  const unrec = await listDonations(testDb, U, { status: 'unrecognized' });
  assert.deepEqual(unrec.rows.map((r) => r.externalId), ['u1']);

  const week = await listDonations(testDb, U, { range: 'week' });
  assert.ok(!week.rows.some((r) => r.externalId === 'k3'), 'старий поза тижнем');
  assert.ok(week.rows.some((r) => r.externalId === 'k1'), 'свіжий у тижні');
});

test('listDonationCities — міста, що зустрічаються в донатах (для селекта фільтра)', async () => {
  await applyDonation(testDb, U, { externalId: 'a', donorName: 'A', amountUah: 500, message: 'Київ' }, 'kyiv');
  await applyDonation(testDb, U, { externalId: 'b', donorName: 'B', amountUah: 300, message: 'Львів' }, 'lviv');
  await applyDonation(testDb, U, { externalId: 'c', donorName: 'C', amountUah: 200, message: 'без міста' }, null);
  const cities = await listDonationCities(testDb, U);
  assert.deepEqual(cities.map((c) => c.id).sort(), ['kyiv', 'lviv']); // нерозпізнаний не входить
});

test('listAllDonations — усі за фільтром, без пагінації', async () => {
  await seedSeq(35);
  const all = await listAllDonations(testDb, U, {});
  assert.equal(all.length, 35); // без штучного ліміту
  assert.equal(all[0]?.externalId, 'd34'); // найновіший зверху
  assert.equal(all[34]?.externalId, 'd0');
});

test('donationsToCsv — BOM, заголовок, екранування коми/лапок/перенесення', async () => {
  const rows: DonationRow[] = [
    {
      externalId: 'x',
      who: 'Дмитро Петренко',
      amountUah: 500,
      message: 'привіт, "Київ"\nдякую',
      city: 'Київ',
      settlementId: 'kyiv',
      status: 'recognized',
      points: 5,
      at: BASE,
      streamId: null,
      outOfGame: false,
    },
  ];
  const csv = donationsToCsv(rows);
  assert.ok(csv.startsWith('﻿'), 'має починатися з BOM');
  assert.ok(csv.includes('Дата/час'), 'має містити заголовок');
  // поле з комою/лапками/переносом — у лапках, внутрішні лапки подвоєні
  assert.ok(csv.includes('"привіт, ""Київ""\nдякую"'));
});

test('parseDonationFilter — порожні значення ігноруються, валідні приймаються', async () => {
  assert.deepEqual(parseDonationFilter({}), {});
  assert.deepEqual(parseDonationFilter({ q: '', min: '', max: '', status: '' }), {});
  assert.deepEqual(parseDonationFilter({ q: '  Київ  ', min: '100', max: '500', status: 'recognized' }), {
    search: 'Київ',
    minUah: 100,
    maxUah: 500,
    status: 'recognized',
  });
  assert.deepEqual(parseDonationFilter({ status: 'bogus' }), {}); // невалідний статус — ігнор
});

test('encodeCursor/parseCursor — роундтрип і відмова на сміття', async () => {
  // val — значення поля сортування (мс для дати або сума), id — tiebreak
  const c = { val: 1_700_000_000_000, id: 'abc123' };
  const s = encodeCursor(c);
  assert.equal(s, '1700000000000_abc123');
  const back = parseCursor(s);
  assert.equal(back?.val, c.val);
  assert.equal(back?.id, 'abc123');
  assert.equal(parseCursor(undefined), undefined);
  assert.equal(parseCursor('garbage'), undefined);
});
