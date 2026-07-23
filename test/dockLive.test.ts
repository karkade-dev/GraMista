import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countAsNewDonation } from '../lib/dockLive';
import { REFRESH_EVENT_ID } from '../lib/notify';

const ev = (externalId: string) => JSON.stringify({ externalId, flash: null });

test('справжній новий донат рахується один раз', () => {
  const seen = new Set<string>();
  assert.equal(countAsNewDonation(ev('mono-1'), seen), true);
  assert.equal(countAsNewDonation(ev('mono-1'), seen), false); // повторна подія того ж донату
  assert.equal(countAsNewDonation(ev('mono-2'), seen), true);
});

test('службовий refresh (ручні дії адмінки/перемикання збору) — не «новий донат»', () => {
  const seen = new Set<string>();
  assert.equal(countAsNewDonation(ev(REFRESH_EVENT_ID), seen), false);
  assert.equal(countAsNewDonation(ev(REFRESH_EVENT_ID), seen), false);
});

test('сміття не рахується: не-JSON, без externalId, порожній id', () => {
  const seen = new Set<string>();
  assert.equal(countAsNewDonation('not json', seen), false);
  assert.equal(countAsNewDonation('{}', seen), false);
  assert.equal(countAsNewDonation(JSON.stringify({ externalId: '' }), seen), false);
  assert.equal(countAsNewDonation(JSON.stringify({ externalId: 42 }), seen), false);
});
