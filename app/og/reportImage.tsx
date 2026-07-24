import React from 'react';
import { ImageResponse } from 'next/og';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportData, ReportFormat } from '@/lib/reportData';
import { REPORT_SIZES, layoutLandscape, layoutSquare, layoutTall } from './reportLayout';
import { qrDataUri } from './qr';

// Рендер картинки-звіту (стрім/збір) у PNG через next/og (satori) — перевірене рішення, не свій рендер.
// Шрифт Onest (кирилична підмножина, woff) читаємо ліниво з диска під час запиту.

let fontsCache: { name: string; data: Buffer; weight: 400 | 700 | 800; style: 'normal' }[] | null = null;
export function ogFonts() {
  if (!fontsCache) {
    const dir = join(process.cwd(), 'app', 'og', 'fonts');
    const f = (n: string) => readFileSync(join(dir, n));
    fontsCache = [
      // Onest — увесь текст і числа звіту (назва, міста, суми, дати). Повний статичний файл
      // (кирилиця+латиниця+цифри в одному) — satori бере один файл на (родину+вагу), тож сабсети
      // не годяться; цифри в тексті лишаються Onest, а не тікають у резерв.
      { name: 'Onest', data: f('onest-full-400.ttf'), weight: 400, style: 'normal' },
      { name: 'Onest', data: f('onest-full-700.ttf'), weight: 700, style: 'normal' },
      // Manrope — лише словознак бренду «GraMista» (латиниця), як на лендингу.
      { name: 'Brand', data: f('manrope-latin-800-normal.woff'), weight: 800, style: 'normal' },
      // DejaVu — страхувальний резерв для гліфів поза Onest (напр. рідкісні символи).
      { name: 'DejaVu', data: f('DejaVuSans.ttf'), weight: 400, style: 'normal' },
    ];
  }
  return fontsCache;
}

/**
 * Мультиформатний рендер звіту: обирає розкладку за format і полотно за REPORT_SIZES.
 * Async — вертикаль/портрет генерують QR (await qrDataUri) до передачі в layout, щоб самі
 * розкладки лишались синхронними.
 */
export async function renderReportImage(
  data: ReportData,
  opts: { format: ReportFormat; topN: 5 | 10; labelsN: number },
): Promise<ImageResponse> {
  const labelsN = opts.labelsN;
  let layout: React.ReactElement;
  if (opts.format === 'square') {
    layout = layoutSquare(data, opts.topN, labelsN);
  } else if (opts.format === 'vertical' || opts.format === 'portrait') {
    const qrImg = data.qr ? await qrDataUri(data.qr.url) : undefined;
    layout = layoutTall(data, opts.topN, { portrait: opts.format === 'portrait', qrImg, labelsN });
  } else {
    layout = layoutLandscape(data, opts.topN, labelsN);
  }
  return new ImageResponse(layout, { ...REPORT_SIZES[opts.format], fonts: ogFonts() });
}
