import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFontSize } from '../lib/title';

test('коротка назва — великий кегль, горизонт', () => {
  assert.equal(titleFontSize(9, 'landscape'), 48);
});
test('середня — 40px', () => {
  assert.equal(titleFontSize(29, 'landscape'), 40);
});
test('довга 60 симв. — 26px (влазить у 2 рядки)', () => {
  assert.equal(titleFontSize(60, 'landscape'), 26);
});
test('монотонність: довша назва не отримує більший кегль', () => {
  for (let n = 1; n < 90; n++) {
    assert.ok(titleFontSize(n + 1, 'landscape') <= titleFontSize(n, 'landscape'));
  }
});
test('квадрат — більший кегль за той самий текст (більше місця)', () => {
  assert.ok(titleFontSize(29, 'square') >= titleFontSize(29, 'landscape'));
});
