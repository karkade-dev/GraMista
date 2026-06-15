import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from './db';
import {
  userIdByOverlayKey, userIdByHandle, ensureOverlayKey, regenerateOverlayKey,
  userIdByDockKey, ensureDockKey, regenerateDockKey,
} from '../lib/publicUser';

before(async () => {
  await testDb.user.upsert({
    where: { id: 'pu-user' },
    update: { handle: 'orest', overlayKey: 'KEY123' },
    create: { id: 'pu-user', email: 'pu@x.dev', name: 'PU', handle: 'orest', overlayKey: 'KEY123' },
  });
});
after(async () => {
  await testDb.user.deleteMany({ where: { id: 'pu-user' } });
  await testDb.$disconnect();
});

test('userIdByOverlayKey знаходить за токеном', async () => {
  assert.equal(await userIdByOverlayKey(testDb, 'KEY123'), 'pu-user');
});
test('userIdByOverlayKey: невідомий/порожній → null', async () => {
  assert.equal(await userIdByOverlayKey(testDb, 'NOPE'), null);
  assert.equal(await userIdByOverlayKey(testDb, ''), null);
});
test('userIdByHandle знаходить за слагом', async () => {
  assert.equal(await userIdByHandle(testDb, 'orest'), 'pu-user');
});
test('regenerateOverlayKey міняє ключ; старий більше не резолвиться', async () => {
  const fresh = await regenerateOverlayKey(testDb, 'pu-user');
  assert.notEqual(fresh, 'KEY123');
  assert.equal(await userIdByOverlayKey(testDb, 'KEY123'), null);
  assert.equal(await userIdByOverlayKey(testDb, fresh), 'pu-user');
});
test('ensureOverlayKey повертає наявний, не перезаписує', async () => {
  const k1 = await ensureOverlayKey(testDb, 'pu-user');
  const k2 = await ensureOverlayKey(testDb, 'pu-user');
  assert.equal(k1, k2);
});

test('ensureDockKey створює ключ, окремий від overlayKey; повторний — той самий', async () => {
  const dk1 = await ensureDockKey(testDb, 'pu-user');
  assert.ok(dk1 && dk1.length > 10);
  const dk2 = await ensureDockKey(testDb, 'pu-user');
  assert.equal(dk1, dk2); // не перезаписує
  const overlay = await ensureOverlayKey(testDb, 'pu-user');
  assert.notEqual(dk1, overlay); // окремий ключ
});

test('userIdByDockKey резолвить за токеном; невідомий/порожній → null', async () => {
  const dk = await ensureDockKey(testDb, 'pu-user');
  assert.equal(await userIdByDockKey(testDb, dk), 'pu-user');
  assert.equal(await userIdByDockKey(testDb, 'NOPE'), null);
  assert.equal(await userIdByDockKey(testDb, ''), null);
});

test('regenerateDockKey міняє ключ; старий більше не резолвиться', async () => {
  const old = await ensureDockKey(testDb, 'pu-user');
  const fresh = await regenerateDockKey(testDb, 'pu-user');
  assert.notEqual(fresh, old);
  assert.equal(await userIdByDockKey(testDb, old), null);
  assert.equal(await userIdByDockKey(testDb, fresh), 'pu-user');
});
