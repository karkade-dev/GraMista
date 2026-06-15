import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, resetDynamic } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import { listDonationsForDock } from '../lib/donations';
import { applyDonation } from '../lib/scoring';

const U = DEFAULT_USER_ID;
const BASE = new Date('2026-02-01T00:00:00.000Z').getTime();

beforeEach(async () => {
  await resetDynamic();
});
after(async () => {
  await testDb.$disconnect();
});

test('offset-пагінація: 20/стор., total і pageCount, найновіші зверху', async () => {
  for (let i = 0; i < 25; i++) {
    await testDb.donation.create({
      data: {
        userId: U, externalId: `d${i}`, donorName: `Донатер ${i}`, amount: 100 + i,
        message: `msg ${i}`, status: 'unrecognized', createdAt: new Date(BASE + i * 1000),
      },
    });
  }
  const p1 = await listDonationsForDock(testDb, U, {}, { page: 1, perPage: 20 });
  assert.equal(p1.total, 25);
  assert.equal(p1.pageCount, 2);
  assert.equal(p1.page, 1);
  assert.equal(p1.rows.length, 20);
  assert.equal(p1.rows[0]?.externalId, 'd24'); // найновіший зверху

  const p2 = await listDonationsForDock(testDb, U, {}, { page: 2, perPage: 20 });
  assert.equal(p2.rows.length, 5);
  assert.equal(p2.page, 2);

  // page за межами клемпиться до останньої
  const over = await listDonationsForDock(testDb, U, {}, { page: 99, perPage: 20 });
  assert.equal(over.page, 2);
});

test("показує ПОВНЕ ім'я і СИРИЙ коментар (не анонімізує)", async () => {
  await testDb.donation.create({
    data: { userId: U, externalId: 'x', donorName: 'Дмитро Петренко', amount: 200, message: 'привіт усім', status: 'unrecognized' },
  });
  const p = await listDonationsForDock(testDb, U, {}, { page: 1, perPage: 20 });
  assert.equal(p.rows[0]?.who, 'Дмитро Петренко'); // НЕ «Дмитро П.»
  assert.equal(p.rows[0]?.message, 'привіт усім');
  assert.equal(p.rows[0]?.collectionId, null); // поза збором
});

test('🆕 newCity: відкривач міста — true, наступні — false', async () => {
  await applyDonation(testDb, U, { externalId: 'k1', donorName: 'A', amountUah: 500, message: 'Київ' }, 'kyiv'); // відкривач
  await applyDonation(testDb, U, { externalId: 'k2', donorName: 'B', amountUah: 200, message: 'Київ' }, 'kyiv'); // не відкривач
  const p = await listDonationsForDock(testDb, U, {}, { page: 1, perPage: 20 });
  const byId = Object.fromEntries(p.rows.map((r) => [r.externalId, r]));
  assert.equal(byId['k1']?.newCity, true);
  assert.equal(byId['k2']?.newCity, false);
});

test('фільтр since (період «сьогодні») — старі поза вікном', async () => {
  const old = new Date(Date.now() - 5 * 86400000);
  await testDb.donation.create({ data: { userId: U, externalId: 'old', donorName: 'X', amount: 50, message: '', status: 'unrecognized', createdAt: old } });
  await testDb.donation.create({ data: { userId: U, externalId: 'new', donorName: 'Y', amount: 60, message: '', status: 'unrecognized' } });
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const p = await listDonationsForDock(testDb, U, { since }, { page: 1, perPage: 20 });
  assert.deepEqual(p.rows.map((r) => r.externalId), ['new']);
});
