import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJars, setWebhook, jarUrlFromSendId, MonoApiError } from '../lib/monobank';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test('fetchJars: віддає банки з копійками→грн, токен летить у X-Token', async () => {
  let seenToken = '', seenUrl = '';
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    seenUrl = String(_url);
    seenToken = new Headers(init?.headers).get('X-Token') ?? '';
    return new Response(JSON.stringify({
      name: 'Тест',
      jars: [{ id: 'acc1', sendId: 'jar/AbCd1234', title: 'На дрони', balance: 150050, goal: null }],
    }), { status: 200 });
  }) as typeof fetch;
  const jars = await fetchJars('tok123');
  assert.equal(seenUrl, 'https://api.monobank.ua/personal/client-info');
  assert.equal(seenToken, 'tok123');
  assert.deepEqual(jars, [{ id: 'acc1', sendId: 'jar/AbCd1234', title: 'На дрони', balanceUah: 1500.5 }]);
});

test('jarUrlFromSendId: sendId уже містить jar/ — сегмент не дублюється', () => {
  assert.equal(jarUrlFromSendId('jar/AbCd1234'), 'https://send.monobank.ua/jar/AbCd1234');
  // захист від зайвого слеша чи випадкового повного URL
  assert.equal(jarUrlFromSendId('/jar/AbCd1234'), 'https://send.monobank.ua/jar/AbCd1234');
  assert.equal(jarUrlFromSendId('https://send.monobank.ua/jar/AbCd1234'), 'https://send.monobank.ua/jar/AbCd1234');
});

test('fetchJars: без банок → порожній список (jars відсутнє у відповіді)', async () => {
  mockFetch(200, { name: 'Тест' });
  assert.deepEqual(await fetchJars('tok'), []);
});

test('fetchJars: 403 → MonoApiError «Невалідний токен»', async () => {
  mockFetch(403, { errorDescription: 'Unknown X-Token' });
  await assert.rejects(fetchJars('bad'), (e: Error) =>
    e instanceof MonoApiError && e.message === 'Невалідний токен');
});

test('fetchJars: 429 → MonoApiError про ліміт запитів', async () => {
  mockFetch(429, {});
  await assert.rejects(fetchJars('tok'), (e: Error) =>
    e instanceof MonoApiError && /зачекай/i.test(e.message));
});

test('setWebhook: POST /personal/webhook з webHookUrl у тілі', async () => {
  let seenBody = '', seenMethod = '', seenUrl = '';
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    seenUrl = String(_url);
    seenMethod = init?.method ?? '';
    seenBody = String(init?.body ?? '');
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  await setWebhook('tok', 'https://x.ua/api/mono/hook/s1');
  assert.equal(seenUrl, 'https://api.monobank.ua/personal/webhook');
  assert.equal(seenMethod, 'POST');
  assert.deepEqual(JSON.parse(seenBody), { webHookUrl: 'https://x.ua/api/mono/hook/s1' });
});
