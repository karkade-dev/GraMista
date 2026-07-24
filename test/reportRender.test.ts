import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderReportImage } from '../app/og/reportImage';
import { cardValueFontSize, type CardSizes } from '../app/og/reportLayout';
import type { ReportData, ReportFormat } from '../lib/reportData';

// Смоук-рендер: фактичний PNG із next/og (satori). Ловить satori-падіння (multi-child div без
// display:flex), тофу-гліфи в шрифті й биту розкладку — браузер про шрифти бреше, звіряємо PNG.
// Стрес-дані: довга назва (2 рядки), апостроф (Кам'янець), ₴ (резервний шрифт), реальні UA-координати.
const stress: ReportData = {
  kind: 'stream',
  title: 'Великий недільний благодійний марафон на дрони, РЕБ та тепловізори',
  subtitle: '13.07.2026 20:00 · 4:20:00',
  hero: { label: 'зібрано за стрім', value: '1 284 300 ₴' },
  stats: [
    { label: 'донатів', value: '342' },
    { label: 'балів', value: '8 640' },
  ],
  top: [
    { rank: 1, name: 'Київ', points: '1 240', pct: 1, abroad: false },
    { rank: 2, name: "Кам'янець-Подільський", points: '890', pct: 0.72, abroad: false },
    { rank: 3, name: 'Львів', points: '640', pct: 0.52, abroad: false },
    { rank: 4, name: 'Харків', points: '410', pct: 0.33, abroad: false },
    { rank: 5, name: 'Варшава', points: '120', pct: 0.1, abroad: true },
  ],
  map: [
    { lat: 50.45, lon: 30.52, points: 1240 },
    { lat: 49.84, lon: 24.03, points: 640 },
    { lat: 49.99, lon: 36.25, points: 410 },
  ],
  mapLabels: [
    { lat: 50.45, lon: 30.52, name: 'Київ' },
    { lat: 49.84, lon: 24.03, name: 'Львів' },
    { lat: 49.99, lon: 36.25, name: 'Харків' },
  ],
  qr: null,
  empty: false,
};

// Топ-10 (найтісніший випадок кожного формату) + одне довге ім'я + закордонне місто.
const many: ReportData = {
  ...stress,
  top: Array.from({ length: 10 }, (_, i) => ({
    rank: i + 1,
    name: i === 1 ? "Кам'янець-Подільський" : `Місто №${i + 1}`,
    points: String(1000 - i * 90),
    pct: (1000 - i * 90) / 1000,
    abroad: i === 9,
  })),
  map: [
    { lat: 50.45, lon: 30.52, points: 1240 },
    { lat: 49.84, lon: 24.03, points: 640 },
    { lat: 49.99, lon: 36.25, points: 410 },
    { lat: 48.47, lon: 35.05, points: 280 },
  ],
};
const withQr: ReportData = { ...stress, qr: { url: 'https://gramista.example/orest' } };

// Збір: kind:'collection' + прогрес-бар цілі (goal задано). Ціль перевиконана (pct>100) — бар
// клампимо, текст показує факт. Без цілі — goal відсутній, бар не малюється.
const collGoal: ReportData = {
  ...stress,
  kind: 'collection',
  title: 'Великий збір на реанімобіль для 3-ї окремої штурмової бригади',
  subtitle: '01.06.2026 – 18.07.2026',
  goal: { raisedUah: 742000, goalUah: 1000000, pct: 74 },
};
const collOver: ReportData = { ...collGoal, goal: { raisedUah: 1350000, goalUah: 1000000, pct: 135 } };
const collNoGoal: ReportData = { ...collGoal, goal: undefined };

async function png(data: ReportData, format: ReportFormat, topN: 5 | 10, labelsN = 3): Promise<Buffer> {
  const res = await renderReportImage(data, { format, topN, labelsN });
  return Buffer.from(await res.arrayBuffer());
}

/** PNG-сигнатура: байти 1..3 = "PNG" + непорожній буфер. */
function assertPng(buf: Buffer): void {
  assert.ok(buf.length > 1000, `замало байтів: ${buf.length}`);
  assert.equal(buf.subarray(1, 4).toString('ascii'), 'PNG');
}

const FORMATS: ReportFormat[] = ['landscape', 'square', 'vertical', 'portrait'];
for (const format of FORMATS) {
  test(`${format}: топ-5 рендериться у валідний PNG`, async () => assertPng(await png(stress, format, 5)));
  test(`${format}: топ-10 рендериться (найтісніший випадок)`, async () => assertPng(await png(many, format, 10)));
  test(`${format}: порожній стрім рендериться (лише контур, рядок замість топу)`, async () =>
    assertPng(await png({ ...stress, top: [], map: [], empty: true }, format, 5)));
}

test('вертикаль із QR рендериться (гілка qrDataUri)', async () => assertPng(await png(withQr, 'vertical', 5)));
test('портрет із QR рендериться', async () => assertPng(await png(withQr, 'portrait', 5)));

// Підписи міст на мапі: 10 назв (анти-наліз) і 0 назв (без підписів) — обидві гілки рендеряться.
test('мапа з 10 підписами рендериться (анти-наліз пігулок)', async () => assertPng(await png(many, 'square', 10, 10)));
test('мапа без підписів рендериться (labels=0)', async () => assertPng(await png(stress, 'landscape', 5, 0)));

// Звіт збору з прогрес-баром цілі має рендеритись у кожному форматі (бар у title-flex-блоці).
for (const format of FORMATS) {
  test(`${format}: збір із ціллю (прогрес-бар) рендериться`, async () => assertPng(await png(collGoal, format, 5)));
}
test('збір із перевиконаною ціллю рендериться (бар клампимо, текст фактичний)', async () =>
  assertPng(await png(collOver, 'landscape', 10)));
test('збір без цілі рендериться (goal відсутній — бар не малюється)', async () =>
  assertPng(await png(collNoGoal, 'square', 5)));

// Числа знизу стоять одним рядом: спільний кегль (сума виділена кольором, не розміром) і він
// мусить вміщати найдовше число в картку — інакше довга сума знову «випадала» з ряду.
const CARD_ZONES: Record<string, CardSizes> = {
  landscape: { width: 568, gap: 12, valueFs: 32, labelFs: 15, padX: 14, padY: 11 },
  square: { width: 968, gap: 16, valueFs: 40, labelFs: 18, padX: 20, padY: 13 },
  tall: { width: 968, gap: 20, valueFs: 42, labelFs: 20, padX: 22, padY: 12 },
};
const SUMS = ['0 ₴', '584 380 ₴', '1 284 300 ₴', '12 345 678 ₴', '123 456 789 ₴'];
/** Оцінка ширини рядка тим самим правилом, що й у розкладці (цифра ~0.6em, роздільник ~0.25em). */
function em(s: string): number {
  return [...s].reduce((a, ch) => a + (ch === ' ' || ch === ' ' ? 0.25 : ch === ',' || ch === '.' ? 0.3 : 0.6), 0);
}
for (const [zone, z] of Object.entries(CARD_ZONES)) {
  test(`${zone}: найдовша сума вміщається в картку на спільному кеглі`, () => {
    const inner = (z.width - z.gap * 2) / 3 - z.padX * 2;
    for (const sum of SUMS) {
      const fs = cardValueFontSize([sum, '200', '10'], z);
      assert.ok(em(sum) * fs <= inner, `${sum}: ${Math.round(em(sum) * fs)}px > ${inner}px картки`);
      assert.ok(fs >= 14, `${sum}: кегль ${fs} закалий`);
    }
  });
  test(`${zone}: короткі числа не роздувають кегль вище стелі`, () => {
    assert.equal(cardValueFontSize(['0 ₴', '1', '1'], z), z.valueFs);
  });
}
