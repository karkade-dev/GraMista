import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma, type PrismaClient } from '@prisma/client';

import { testDb, resetDynamic } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import { applyDonation } from '../lib/scoring';
import { donationFlash, donationFlashShared } from '../lib/map';

const U = DEFAULT_USER_ID;

beforeEach(async () => {
  await resetDynamic();
});

after(async () => {
  await testDb.$disconnect();
});

test('donationFlash: розпізнаний донат → місто з координатами і сумою', async () => {
  await applyDonation(testDb, U, { externalId: 'f1', donorName: 'X', amountUah: 500, message: 'Львів' }, 'lviv');
  const f = await donationFlash(testDb, U, 'f1');
  assert.ok(f, 'має повернути дані для спалаху');
  assert.equal(f.settlementId, 'lviv');
  assert.equal(f.name, 'Львів');
  assert.equal(f.amountUah, 500);
  assert.equal(typeof f.lat, 'number');
  assert.equal(typeof f.lon, 'number');
});

test('donationFlash: нерозпізнаний донат (без міста) → null', async () => {
  await applyDonation(testDb, U, { externalId: 'f2', donorName: 'X', amountUah: 200, message: 'без міста тут' }, null);
  assert.equal(await donationFlash(testDb, U, 'f2'), null);
});

test('donationFlash: неіснуючий externalId → null', async () => {
  assert.equal(await donationFlash(testDb, U, 'nope'), null);
});

// Лічильник запитів — підставний db, щоб перевірити коалесинг без реальної БД
// (нас цікавить КІЛЬКІСТЬ викликів findUnique, а не їх вміст). pointEvent.findMany —
// заглушка для cityOpeners (прапорець newCity); коалесинг рахуємо лише по findUnique донату.
function countingDb(rows: () => unknown): { db: PrismaClient; queries: () => number } {
  let q = 0;
  const db = {
    donation: {
      findUnique: async () => {
        q++;
        await new Promise((r) => setTimeout(r, 5)); // імітуємо латентність round-trip
        return rows();
      },
    },
    pointEvent: {
      findMany: async () => [],
    },
  } as unknown as PrismaClient;
  return { db, queries: () => q };
}

test('donationFlashShared: N паралельних підписників на той самий донат → ОДИН запит у БД', async () => {
  const { db, queries } = countingDb(() => ({
    amount: new Prisma.Decimal(100),
    settlement: { id: 'lviv', name: 'Львів', lat: 49.8, lon: 24.0, country: 'UA' },
    user: { abroadWorldMap: false },
  }));

  // Усі 50 викликів стартують синхронно (як фан-аут donationBus в один тік).
  const results = await Promise.all(
    Array.from({ length: 50 }, () => donationFlashShared(db, U, 'same')),
  );

  assert.equal(queries(), 1, '50 підписників мали поділити один запит, а не зробити 50');
  for (const r of results) {
    assert.ok(r);
    assert.equal(r.name, 'Львів');
    assert.equal(r.amountUah, 100);
  }
});

test('donationFlashShared: послідовні донати не коалесяться — кеш звільняється по завершенні', async () => {
  const { db, queries } = countingDb(() => null);
  await donationFlashShared(db, U, 'a');
  await donationFlashShared(db, U, 'a'); // після settle ключ уже звільнено → новий запит
  assert.equal(queries(), 2, 'послідовні (не паралельні) виклики мають робити окремі запити');
});
