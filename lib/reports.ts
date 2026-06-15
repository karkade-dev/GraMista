import { formatUah, formatPoints, formatDate } from './format';
import type { StreamSummary } from './streams';
import type { CollectionRow } from './collections';

// Дані для картинки-звіту: чисте відображення підсумку стріму/збору → структура для рендеру
// (рендер у PNG — app/og/reportImage через next/og). Логіка тут, без JSX/бібліотек рендеру.

export interface ReportStat {
  label: string;
  value: string;
}

export interface ReportImageData {
  /** Надзаголовок-категорія («Звіт стріму» / «Звіт збору»). */
  kicker: string;
  title: string;
  subtitle: string;
  /** 3 ключові числа. */
  stats: ReportStat[];
  /** Топ-міста (назва + бали), до 3. */
  topCities: { name: string; points: string }[];
}

/** Підсумок стріму → дані картинки-звіту. */
export function streamReportImage(s: StreamSummary): ReportImageData {
  return {
    kicker: 'Звіт стріму',
    title: s.name,
    subtitle: formatDate(s.startedAt.getTime()),
    stats: [
      { label: 'Зібрано', value: formatUah(s.sumUah) },
      { label: 'Донатів', value: String(s.donations) },
      { label: 'Балів містам', value: formatPoints(s.points) },
    ],
    topCities: s.topCities.map((c) => ({ name: c.name, points: formatPoints(c.points) })),
  };
}

/** Підсумок збору → дані картинки-звіту (відсоток — фактичний, може >100). Ціль необов'язкова. */
export function collectionReportImage(c: CollectionRow): ReportImageData {
  const pct = c.goalUah && c.goalUah > 0 ? Math.round((c.displayedUah / c.goalUah) * 100) : 0;
  return {
    kicker: 'Звіт збору',
    title: c.name,
    subtitle: c.goalUah != null ? `Ціль ${formatUah(c.goalUah)}` : 'Збір-змагання',
    stats: [
      { label: 'Зібрано', value: formatUah(c.displayedUah) },
      // Без цілі відсоток не має сенсу — показуємо к-сть міст у грі.
      c.goalUah != null
        ? { label: 'Виконано', value: `${pct}%` }
        : { label: 'Міст у грі', value: String(c.topCities.length) },
      { label: 'Стрімів', value: String(c.streamCount) },
    ],
    topCities: c.topCities.map((x) => ({ name: x.name, points: formatPoints(x.points) })),
  };
}
