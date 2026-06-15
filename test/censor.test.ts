import { test } from 'node:test';
import assert from 'node:assert/strict';
import { censorText, commentForDisplay, toCommentMode, parseWordList, wordListsForUi } from '../lib/censor';
import { BASE_BANNED } from '../lib/censorWords';
import { oneLineComment } from '../lib/format';

const M = (mode: 'mask' | 'replace') => ({ mode, added: '', allowed: '' });

// --- censorText: базові режими ---

test('mask: мат маскується (перша літера + зірочки), решта тексту неторкана', () => {
  assert.equal(censorText('тебе люблю, хуйня якась', M('mask')), 'тебе люблю, х**** якась');
  assert.equal(censorText('блять', M('mask')), 'б****');
});

test('replace: заборонений токен → [цензура]', () => {
  assert.equal(censorText('ну ти й мудак', M('replace')), 'ну ти й [цензура]');
});

test('порожній текст і текст без мату — без змін', () => {
  assert.equal(censorText('', M('mask')), '');
  assert.equal(censorText('Слава Україні!', M('mask')), 'Слава Україні!');
});

// --- хибні спрацювання (білий список) ---

test('міста й звичайні слова НЕ цензуряться', () => {
  assert.equal(censorText('Їдемо в Хуст і Херсон', M('mask')), 'Їдемо в Хуст і Херсон');
  assert.equal(censorText('бляха, сукня з сукна', M('mask')), 'бляха, сукня з сукна');
  assert.equal(censorText('застрахуй банку', M('mask')), 'застрахуй банку');
  assert.equal(censorText('барсука бачив у лісі', M('mask')), 'барсука бачив у лісі');
  // Сукачі/Сукачівка — реальні села (Київщина); дрочена — страва.
  assert.equal(censorText('привіт із Сукачів', M('mask')), 'привіт із Сукачів');
  assert.equal(censorText('Сукачівка з вами', M('mask')), 'Сукачівка з вами');
  assert.equal(censorText('бабусина дрочена', M('mask')), 'бабусина дрочена');
});

// --- слюри (політика Twitch Hateful Conduct) ---

test('слюри цензуряться: етнічні й гомофобні', () => {
  assert.equal(censorText('негр', M('mask')), 'н***');
  assert.equal(censorText('жид', M('mask')), 'ж**');
  assert.equal(censorText('хохол і хохли', M('mask')), 'х**** і х****');
  assert.equal(censorText('нігер', M('replace')), '[цензура]');
  assert.equal(censorText('хачик', M('mask')), 'х****');
  assert.equal(censorText('гомік', M('mask')), 'г****');
});

test('колізії зі слюрами НЕ цензуряться', () => {
  assert.equal(censorText('вінегрет з буряка', M('mask')), 'вінегрет з буряка');
  assert.equal(censorText('хачапурі по-аджарськи', M('mask')), 'хачапурі по-аджарськи');
  assert.equal(censorText('привіт з Нігерії', M('mask')), 'привіт з Нігерії');
  assert.equal(censorText('дожидаюся перемоги', M('mask')), 'дожидаюся перемоги');
  assert.equal(censorText('цікава книга', M('mask')), 'цікава книга');
  assert.equal(censorText('розпис хохлома', M('mask')), 'розпис хохлома');
});

// --- обфускація ---

test('латинські двійники, цифри, зірочки-вайлдкарди ловляться', () => {
  assert.equal(censorText('пи3да', M('mask')), 'п****');
  // Маска лишає ПЕРШУ ЛІТЕРУ ОРИГІНАЛУ: в 'xуй' вона латинська 'x' — очікуємо латинську.
  assert.equal(censorText('xуй', M('mask')), 'x**');
  assert.equal(censorText('х*й', M('mask')), 'х**');
  assert.equal(censorText('хуууйня', M('mask')), 'х******');
});

test('розірване по літерах слово (х у й) зливається і маскується', () => {
  assert.equal(censorText('х у й тобі', M('mask')), 'х** тобі');
});

test('невинні одиночні літери не зачіпаються злиттям', () => {
  assert.equal(censorText('я в шоці', M('mask')), 'я в шоці');
});

// --- власні слова й винятки ---

test('added: власне слово стрімера цензурується', () => {
  assert.equal(censorText('капець жабам', { mode: 'mask', added: 'жаб', allowed: '' }), 'капець ж****');
});

test('allowed: виняток стрімера перемагає базовий список', () => {
  assert.equal(censorText('сука', { mode: 'mask', added: '', allowed: 'сука' }), 'сука');
});

test('parseWordList: коми, нові рядки, регістр', () => {
  assert.deepEqual(parseWordList('Жаба, КІТ\nпес'), ['жаба', 'кіт', 'пес']);
  assert.deepEqual(parseWordList(''), []);
});

// --- wordListsForUi: списки для UI налаштувань ---

test('wordListsForUi: порожні поля → base повний, custom/exceptions порожні', () => {
  const l = wordListsForUi('', '');
  assert.deepEqual(l.base, [...BASE_BANNED]);
  assert.deepEqual(l.custom, []);
  assert.deepEqual(l.exceptions, []);
});

test('wordListsForUi: виняток ховає базовий стем (зникає з base, є в exceptions)', () => {
  const l = wordListsForUi('', 'сука');
  assert.ok(!l.base.includes('сука'));
  assert.deepEqual(l.exceptions, ['сука']);
  // решта базових лишилась
  assert.ok(l.base.includes('хуй'));
});

test('wordListsForUi: власне слово видно в custom', () => {
  const l = wordListsForUi('жаба', '');
  assert.deepEqual(l.custom, ['жаба']);
});

test('wordListsForUi: власне слово, що збігається з базовим, не дублюється в custom', () => {
  const l = wordListsForUi('сука', '');
  assert.deepEqual(l.custom, []);
  assert.ok(l.base.includes('сука'));
});

// --- commentForDisplay: 4 режими ---

test('commentForDisplay: mask/replace чистять вільний текст', () => {
  const s = { mode: 'mask' as const, added: '', allowed: '' };
  assert.equal(commentForDisplay('Київ хуйло', 'Київ', s), 'Київ х****');
});

test('commentForDisplay: city → лише назва міста; без міста → порожньо', () => {
  const s = { mode: 'city' as const, added: '', allowed: '' };
  assert.equal(commentForDisplay('будь-який текст', 'Львів', s), 'Львів');
  assert.equal(commentForDisplay('будь-який текст', null, s), '');
});

test('commentForDisplay: hide → завжди порожньо', () => {
  const s = { mode: 'hide' as const, added: '', allowed: '' };
  assert.equal(commentForDisplay('текст', 'Київ', s), '');
});

// --- oneLineComment ---

test('oneLineComment: переноси → пробіл, тримінг', () => {
  assert.equal(oneLineComment('привіт\nз  Києва '), 'привіт з Києва');
});

test('oneLineComment: довгий текст обрізається до 140 з «…»', () => {
  const long = 'а'.repeat(200);
  const out = oneLineComment(long);
  assert.equal(out.length, 140);
  assert.ok(out.endsWith('…'));
});

// --- toCommentMode ---

test('toCommentMode: валідні проходять, сміття → mask', () => {
  assert.equal(toCommentMode('city'), 'city');
  assert.equal(toCommentMode('hide'), 'hide');
  assert.equal(toCommentMode('replace'), 'replace');
  assert.equal(toCommentMode('neon'), 'mask');
  assert.equal(toCommentMode(null), 'mask');
  assert.equal(toCommentMode(undefined), 'mask');
});

// --- інтеграція з БД: getState чистить, listDonations (адмінка) — сире ---

import { test as dbTest, beforeEach, after } from 'node:test';
import { testDb, resetDynamic } from './db';
import { DEFAULT_USER_ID } from '../lib/tenant';
import { applyDonation } from '../lib/scoring';
import { getState } from '../lib/dashboard';
import { listDonations } from '../lib/donations';

const U = DEFAULT_USER_ID;
const USER_DEFAULTS = { commentMode: 'mask', bannedWordsAdded: '', bannedWordsAllowed: '', showCommentPublic: true };

beforeEach(async () => {
  await resetDynamic();
  await testDb.user.update({ where: { id: U }, data: USER_DEFAULTS });
});

after(async () => {
  await testDb.user.update({ where: { id: U }, data: USER_DEFAULTS });
  await testDb.$disconnect();
});

dbTest('getState: message чиститься (mask), адмінська історія listDonations — сира', async () => {
  await applyDonation(testDb, U, { externalId: 'cz1', donorName: 'X', amountUah: 100, message: 'Київ ху*ло' }, 'kyiv');
  const state = await getState(testDb, U);
  assert.equal(state.recent[0]?.message, 'Київ х****');
  const page = await listDonations(testDb, U, {});
  assert.equal(page.rows[0]?.message, 'Київ ху*ло');
});

dbTest('режим city: лише назва міста; hide: порожньо', async () => {
  await applyDonation(testDb, U, { externalId: 'cz2', donorName: 'X', amountUah: 50, message: 'привіт із Києва' }, 'kyiv');
  await testDb.user.update({ where: { id: U }, data: { commentMode: 'city' } });
  const s1 = await getState(testDb, U);
  const settlement = await testDb.settlement.findUnique({ where: { id: 'kyiv' }, select: { name: true } });
  assert.equal(s1.recent[0]?.message, settlement?.name ?? '');

  await testDb.user.update({ where: { id: U }, data: { commentMode: 'hide' } });
  const s2 = await getState(testDb, U);
  assert.equal(s2.recent[0]?.message, '');
});

dbTest('власні слова (added) і винятки (allowed) діють у getState', async () => {
  await testDb.user.update({ where: { id: U }, data: { bannedWordsAdded: 'жаба', bannedWordsAllowed: 'сука' } });
  await applyDonation(testDb, U, { externalId: 'cz3', donorName: 'X', amountUah: 10, message: 'жаба сука' }, 'kyiv');
  const state = await getState(testDb, U);
  assert.equal(state.recent[0]?.message, 'ж*** сука');
});

dbTest('audience admin: коментар видно стрімеру, навіть коли режим city/hide ховає його від глядачів', async () => {
  // Донат без розпізнаного міста + режим "city": глядач коментаря не бачить (місто порожнє),
  // але стрімер на дашборді має бачити текст — щоб знати, яке місто призначити вручну.
  await applyDonation(testDb, U, { externalId: 'cz4', donorName: 'X', amountUah: 70, message: 'тестовий' }, null);
  await testDb.user.update({ where: { id: U }, data: { commentMode: 'city' } });
  assert.equal((await getState(testDb, U)).recent[0]?.message, '');
  assert.equal((await getState(testDb, U, {}, { audience: 'admin' })).recent[0]?.message, 'тестовий');
});

dbTest('audience admin: мат у коментарі все одно маскується (на панель сирий мат не йде)', async () => {
  await applyDonation(testDb, U, { externalId: 'cz5', donorName: 'X', amountUah: 70, message: 'привіт ху*ло' }, null);
  await testDb.user.update({ where: { id: U }, data: { commentMode: 'hide' } });
  assert.equal((await getState(testDb, U, {}, { audience: 'admin' })).recent[0]?.message, 'привіт х****');
});
