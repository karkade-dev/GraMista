import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrDataUri } from '../app/og/qr';

test('qrDataUri повертає PNG data-URI', async () => {
  const uri = await qrDataUri('https://example.test/orest');
  assert.match(uri, /^data:image\/png;base64,/);
  assert.ok(uri.length > 200);
});
