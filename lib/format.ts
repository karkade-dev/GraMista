/** Форматування для UI. Числа — з нерозривним тонким пробілом між тисячами. */

const THIN = ' '; // narrow no-break space

/** 38600 → «38 600 ₴»; дробові копійки показуємо лише якщо є. */
export function formatUah(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const [int, frac] = rounded.toFixed(2).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
  return frac === '00' ? `${grouped}${THIN}₴` : `${grouped},${frac}${THIN}₴`;
}

/**
 * Ціла гривня для агрегованих підсумків/лідербордів: «31 572 ₴», завжди без копійок.
 * Копійки в сумах — шум, який ламає вирівнювання колонки (одні рядки з копійками, інші без).
 * Для окремих донатів (де копійки бувають значущі) лишається formatUah.
 */
export function formatUahWhole(n: number): string {
  const int = Math.round(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
  return `${int}${THIN}₴`;
}

/** Бали: до 1 знака після коми, без зайвого нуля (12.5 → «12.5», 3 → «3»). */
export function formatPoints(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Український відмінок слова «бал»: 1 бал, 2–4 бали, 5–20 балів (з урахуванням 11–14). */
export function pluralBaliv(n: number): string {
  const abs = Math.abs(Math.round(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'бал';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'бали';
  return 'балів';
}

/** Український відмінок слова «місто»: 1 місто, 2–4 міста, 5+ міст. */
export function pluralMist(n: number): string {
  const abs = Math.abs(Math.round(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'місто';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'міста';
  return 'міст';
}

/** Дата-час локально: «дд.мм.рррр гг:хв» (для історії донатів, CSV). */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Лише дата локально: «дд.мм.рррр» (для дат збору). */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Тривалість у «г:хв:сс» (для таймера стріму). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}`;
}

/** Перша літера імені для аватара (велика); порожнє → «?». */
export function initial(name: string): string {
  const ch = name.trim()[0];
  return ch ? ch.toUpperCase() : '?';
}

/** Коментар донату в один рядок для оверлеїв/стрічок: переноси/повтори пробілів → пробіл, обрізка з «…». */
export function oneLineComment(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1).trimEnd() + '…';
}
