// Кегль назви за довжиною: satori не міряє текст під час рендеру, тож обираємо
// розмір порогами за к-стю символів (як OG-генератори). Пороги вивірені рендером
// у Chromium з шрифтом Onest — див. docs/specs/2026-07-18-report-images-design.md §7.
import type { ReportFormat } from './reportData';

// [maxLen, px] — перший поріг, у який влазить довжина; впорядковано за зростанням.
const BUCKETS: Record<ReportFormat, [number, number][]> = {
  landscape: [[18, 48], [29, 40], [40, 34], [52, 30], [66, 26], [Infinity, 24]],
  square: [[20, 56], [32, 46], [46, 38], [64, 32], [Infinity, 28]],
  vertical: [[22, 64], [36, 52], [52, 44], [72, 36], [Infinity, 30]],
  portrait: [[22, 60], [36, 50], [52, 42], [72, 34], [Infinity, 28]],
};

export function titleFontSize(len: number, format: ReportFormat): number {
  for (const [maxLen, px] of BUCKETS[format]) if (len <= maxLen) return px;
  return BUCKETS[format].at(-1)![1];
}
