import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatUah, formatUahWhole } from '../lib/format';

const THIN = ' '; // narrow no-break space (розділювач тисяч)

test('formatUahWhole: завжди без копійок, з розділювачем тисяч', () => {
  assert.equal(formatUahWhole(31572.45), `31${THIN}572${THIN}₴`);
  assert.equal(formatUahWhole(19366), `19${THIN}366${THIN}₴`);
  assert.equal(formatUahWhole(3048.8), `3${THIN}049${THIN}₴`); // округлення до цілого
  assert.equal(formatUahWhole(0), `0${THIN}₴`);
  assert.equal(formatUahWhole(999), `999${THIN}₴`);
  assert.equal(formatUahWhole(1000000), `1${THIN}000${THIN}000${THIN}₴`);
});

test('formatUah: копійки лише коли є (регресія)', () => {
  assert.equal(formatUah(19366), `19${THIN}366${THIN}₴`);
  assert.equal(formatUah(31572.45), `31${THIN}572,45${THIN}₴`);
});
