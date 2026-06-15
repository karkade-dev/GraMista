import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  encodeDonationNotify,
  parseDonationNotify,
  notifyDonation,
  notifyRefresh,
  REFRESH_EVENT_ID,
} from '../lib/notify';
import { testDb } from './db';
import { subscribe } from '../lib/donationBus';

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://gramista:gramista@localhost:5435/gramista_test?schema=public';
const OPTS = { connectionString: TEST_URL };

after(async () => { await testDb.$disconnect(); });

test('encode→parse роундтріп', () => {
  assert.deepEqual(parseDonationNotify(encodeDonationNotify('user1', 'ext-9')),
    { userId: 'user1', externalId: 'ext-9' });
});

test('externalId із двокрапкою зберігається (split по першій)', () => {
  assert.deepEqual(parseDonationNotify(encodeDonationNotify('u', 'a:b:c')),
    { userId: 'u', externalId: 'a:b:c' });
});

test('биті payload → null', () => {
  assert.equal(parseDonationNotify('noseparator'), null);
  assert.equal(parseDonationNotify(':ext'), null);
  assert.equal(parseDonationNotify('user:'), null);
});

// Регресія: ручні дії адмінки (призначення/зміна міста тощо) мусять будити SSE-слухачів,
// інакше оверлеї/публічна/док не оновлюють мапу й топ (бал є — місто не «висвічується»).
test('notifyDonation/notifyRefresh публікують свій payload на каналі donation', async () => {
  const got: string[] = [];
  let arrived: () => void = () => {};
  const ready = new Promise<void>((res) => { arrived = res; });
  const off = await subscribe((p) => { got.push(p); if (got.length >= 2) arrived(); }, OPTS);

  await notifyDonation(testDb, 'streamer1', 'ext-42');
  await notifyRefresh(testDb, 'streamer1');

  await Promise.race([ready, delay(2000).then(() => { throw new Error('не дочекались NOTIFY за 2с'); })]);
  await off();

  // Дії await-нуться по черзі → порядок детермінований: спершу донат, далі службовий refresh.
  assert.deepEqual(got, [
    encodeDonationNotify('streamer1', 'ext-42'),
    encodeDonationNotify('streamer1', REFRESH_EVENT_ID),
  ]);
});
