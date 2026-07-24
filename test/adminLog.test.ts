import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { testDb, resetDynamic } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import { applyDonation } from '../lib/scoring';
import { leaderboard } from '../lib/leaderboard';
import {
  assignCity,
  assignCityBulk,
  reassignCity,
  adjustPoints,
  resetCity,
  resetAll,
} from '../lib/admin';
import { addAlias, searchSettlements } from '../lib/settlements';
import { listAdminActions, undoAdminAction } from '../lib/adminLog';

const U = DEFAULT_USER_ID;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const top = (rows: { settlementId: string; points: number }[]): [string, number][] =>
  rows
    .map((r) => [r.settlementId, r4(r.points)] as [string, number])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const board = async () => top(await leaderboard(testDb, U, { limit: 50 }));
const lastActionId = async (): Promise<string> => (await listAdminActions(testDb, U))[0]!.id;

beforeEach(async () => {
  await resetDynamic();
  await testDb.settlementAlias.deleteMany({ where: { source: 'manual' } });
});

after(async () => {
  await testDb.$disconnect();
});

test('журнал: assignCity пише запис; undo повертає донат у нерозпізнані й знімає бали', async () => {
  await applyDonation(testDb, U, { externalId: 'x1', donorName: 'Анна', amountUah: 150, message: 'хз' }, null);
  const before = await board(); // []

  await assignCity(testDb, U, 'x1', 'kyiv'); // kyiv 1.5
  const log = await listAdminActions(testDb, U);
  assert.equal(log.length, 1);
  assert.equal(log[0]!.type, 'assignCity');
  assert.equal(log[0]!.undoable, true);
  assert.equal(log[0]!.undone, false);
  assert.deepEqual(await board(), [['kyiv', 1.5]]);

  const res = await undoAdminAction(testDb, U, log[0]!.id);
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(await board(), before); // бали зняті
  const d = await testDb.donation.findUniqueOrThrow({ where: { userId_externalId: { userId: U, externalId: 'x1' } } });
  assert.equal(d.status, 'unrecognized');
  assert.equal(d.settlementId, null);
  assert.equal(r4(d.pointsAwarded.toNumber()), 0);
  assert.equal((await listAdminActions(testDb, U))[0]!.undone, true);
});

test('журнал: undo reassignCity відновлює ТОЧНИЙ попередній розподіл балів', async () => {
  await applyDonation(testDb, U, { externalId: 'a', donorName: 'Анна', amountUah: 150, message: 'Київ' }, 'kyiv');
  await applyDonation(testDb, U, { externalId: 'b', donorName: 'Борис', amountUah: 200, message: 'Київ' }, 'kyiv');
  const before = await board(); // [[kyiv, 3.5]]

  await reassignCity(testDb, U, 'a', 'lviv'); // Анна → lviv
  assert.deepEqual(await board(), [['kyiv', 2], ['lviv', 1.5]]);

  const res = await undoAdminAction(testDb, U, await lastActionId());
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(await board(), before); // повернуто 1:1
});

test('журнал: undo adjustPoints прибирає нараховані бали', async () => {
  await adjustPoints(testDb, U, 'lviv', 5);
  await adjustPoints(testDb, U, 'lviv', -2);
  assert.deepEqual(await board(), [['lviv', 3]]);

  const log = await listAdminActions(testDb, U);
  assert.equal(log.length, 2);
  // відкочуємо «+5» (старіший — другий у списку)
  const plus5 = log.find((a) => a.summary.includes('+5'))!;
  assert.deepEqual(await undoAdminAction(testDb, U, plus5.id), { ok: true });
  assert.deepEqual(await board(), [['lviv', -2]]); // лишилось лише «-2»
});

test('журнал: undo addAlias прибирає синонім (searchSettlements більше не бачить)', async () => {
  const res = await addAlias(testDb, U, 'kyiv', 'Мегаполіс');
  assert.ok(res?.ok);
  // Приватний синонім — у пошуку власника (мультитенант): передаємо U.
  assert.ok((await searchSettlements(testDb, 'мегаполіс', 8, U)).some((s) => s.id === 'kyiv'));

  const undo = await undoAdminAction(testDb, U, await lastActionId());
  assert.deepEqual(undo, { ok: true });
  assert.deepEqual(await searchSettlements(testDb, 'мегаполіс', 8, U), []); // аліас зник
});

test('журнал: assignCityBulk пише ОДИН запис; undo повертає всі донати в нерозпізнані', async () => {
  await applyDonation(testDb, U, { externalId: 'b1', donorName: 'Анна', amountUah: 150, message: 'хз' }, null);
  await applyDonation(testDb, U, { externalId: 'b2', donorName: 'Борис', amountUah: 200, message: 'хз' }, null);

  const n = await assignCityBulk(testDb, U, ['b1', 'b2'], 'kyiv');
  assert.equal(n, 2);
  const log = await listAdminActions(testDb, U);
  assert.equal(log.length, 1, 'один запис на масову дію');
  assert.equal(log[0]!.type, 'assignCityBulk');
  assert.deepEqual(await board(), [['kyiv', 3.5]]);

  assert.deepEqual(await undoAdminAction(testDb, U, log[0]!.id), { ok: true });
  assert.deepEqual(await board(), []);
  const recog = await testDb.donation.count({ where: { userId: U, status: 'recognized' } });
  assert.equal(recog, 0); // обидва знову нерозпізнані
});

test('журнал: resetCity/resetAll логуються як НЕЗВОРОТНІ; undo → not_undoable', async () => {
  await applyDonation(testDb, U, { externalId: 'x', donorName: 'Анна', amountUah: 150, message: 'Київ' }, 'kyiv');
  await resetCity(testDb, U, 'kyiv');
  let log = await listAdminActions(testDb, U);
  const reset = log.find((a) => a.type === 'resetCity')!;
  assert.equal(reset.undoable, false);
  assert.deepEqual(await undoAdminAction(testDb, U, reset.id), { ok: false, reason: 'not_undoable' });

  await resetAll(testDb, U);
  log = await listAdminActions(testDb, U);
  const resetAllRow = log.find((a) => a.type === 'resetAll')!;
  assert.equal(resetAllRow.undoable, false);
});

test('журнал: undo неіснуючого → not_found; повторний undo → already_undone', async () => {
  assert.deepEqual(await undoAdminAction(testDb, U, 'nope-id'), { ok: false, reason: 'not_found' });

  await adjustPoints(testDb, U, 'lviv', 5);
  const id = await lastActionId();
  assert.deepEqual(await undoAdminAction(testDb, U, id), { ok: true });
  assert.deepEqual(await undoAdminAction(testDb, U, id), { ok: false, reason: 'already_undone' });
});

test('журнал: undo застарілої дії (стан змінився пізніше) → stale, нічого не чіпає', async () => {
  await applyDonation(testDb, U, { externalId: 'a', donorName: 'Анна', amountUah: 150, message: 'Київ' }, 'kyiv');
  await reassignCity(testDb, U, 'a', 'lviv'); // дія1: kyiv→lviv
  const action1 = await lastActionId();
  await reassignCity(testDb, U, 'a', 'odesa'); // дія2: lviv→odesa (стан змінився)

  const res = await undoAdminAction(testDb, U, action1);
  assert.deepEqual(res, { ok: false, reason: 'stale' });
  // стан не змінено відкатом — донат лишився в odesa
  assert.deepEqual(await board(), [['odesa', 1.5]]);
});
