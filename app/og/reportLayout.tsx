import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportData, ReportFormat, ReportTopCity } from '@/lib/reportData';
import { titleFontSize } from '@/lib/title';
import { formatUahWhole } from '@/lib/format';
import { mapImageDataUri, projectToBox, type MapBox } from './mapBackground';

// Готовий логотип-плитка (бурштин + 🏙️ Segoe) — той самий знак, що на лендингу. Пре-рендер у PNG,
// бо satori/Linux-сервер не має системного емодзі-шрифту; читаємо раз і вкладаємо data-URI.
let brandLogoCache: string | null = null;
function brandLogoUri(): string {
  if (!brandLogoCache) {
    const png = readFileSync(join(process.cwd(), 'app', 'og', 'brand-logo.png'));
    brandLogoCache = `data:image/png;base64,${png.toString('base64')}`;
  }
  return brandLogoCache;
}

// Розкладки картинок-звіту (satori-JSX). Data-шар format-agnostic — тут лише малюємо.
// ⚠ Satori: КОЖЕН <div> із >1 дитиною мусить мати display:'flex' (пастка з HANDOFF),
// інакше рендер падає; одиничний рядок-дитина — виняток.
// Емодзі НЕ вживаємо — satori тягнув би twemoji по мережі (§10 спеки). Текст — Onest (повний
// статичний файл), словознак бренду — Manrope (fontFamily:'Brand'), як на лендингу.

// Полотна форматів (px). Landscape — як наявні OG; решта — під пости мереж.
export const REPORT_SIZES: Record<ReportFormat, { width: number; height: number }> = {
  landscape: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
  vertical: { width: 1080, height: 1920 },
  portrait: { width: 1080, height: 1350 },
};

// Тепла темна гама (токени globals.css) — спільна для всіх розкладок.
export const C = {
  bg: '#1B1714',
  card: '#241E19',
  card2: '#2B231D',
  line: '#3A2F26',
  ink: '#F3E9DF',
  ink2: '#CDBCAB',
  ink3: '#9A8979',
  accent: '#D0875A',
  accentSoft: '#E2A878',
  accentDeep: '#B66E43',
  gold: '#E0B66B',
};

/**
 * Горизонт 1200×630 (як OG-прев'ю посилань). Ліворуч — flex-колонка на всю висоту
 * (лого → назва → підзаголовок → [ціль] → лейбл → список flex:1 → 3 числа): хоч 1, хоч 2 рядки
 * назви, хоч 5, хоч 10 міст — числа не налазять, бо список забирає вільний простір. Праворуч —
 * мапа міст цього стріму/збору з підписом топ-1.
 */
export function layoutLandscape(data: ReportData, topN: 5 | 10, labelsN: number): React.ReactElement {
  const rows = data.top.slice(0, topN);
  const titlePx = titleFontSize(data.title.length, 'landscape');
  const compact = rows.length > 5;
  const s: RowSizes = compact
    ? { rankW: 30, rankFs: 20, nameFs: 22, ptsFs: 22, barW: 150, barH: 11, ptsW: 78 }
    : { rankW: 34, rankFs: 22, nameFs: 25, ptsFs: 24, barW: 168, barH: 13, ptsW: 84 };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        backgroundColor: C.bg,
        // Легка глибина без серпанку над текстом: теплий вінʼєт унизу-праворуч (під мапою) +
        // м'який вертикальний градієнт.
        backgroundImage:
          'radial-gradient(1200px 620px at 86% 118%, rgba(224,168,120,0.16), transparent 60%),' +
          'linear-gradient(178deg, #221B16 0%, #1B1714 60%, #17120E 100%)',
        color: C.ink,
        fontFamily: 'Onest',
      }}
    >
      <div style={{ position: 'absolute', left: 56, top: 44, display: 'flex' }}>{brandLockup(1)}</div>
      <div style={{ position: 'absolute', right: 56, top: 56, display: 'flex' }}>{kicker(18, kickerText(data.kind))}</div>

      {/* Ціль збору — праворуч над мапою (щоб ліва колонка лишалась повністю під рейтинг). */}
      {data.goal && <div style={{ position: 'absolute', left: 648, top: 108, display: 'flex' }}>{progressBar(data.goal, 500)}</div>}

      {/* Мапа міст праворуч + підпис топ-1 (HTML поверх — resvg не малює текст SVG). */}
      <div style={{ position: 'absolute', left: 628, top: 176, display: 'flex' }}>{mapBlock(data, 524, 400, labelsN)}</div>

      {/* Ліва колонка на всю висоту — назва + рейтинг + числа. */}
      <div style={{ position: 'absolute', left: 56, top: 110, width: 568, height: 482, display: 'flex', flexDirection: 'column' }}>
        {/* Назва — не ріжемо, а зменшуємо кегль (за довжиною) і клампимо у 2 рядки. */}
        <div style={{ fontSize: titlePx, fontWeight: 700, lineHeight: 1.08, lineClamp: 2 }}>{data.title}</div>
        <div style={{ fontSize: 21, color: C.ink3, marginTop: 8 }}>{data.subtitle}</div>

        <div style={{ fontSize: 18, color: C.ink3, marginTop: 20, letterSpacing: 0.3 }}>{topLabel(data.kind)}</div>

        {/* Список топ-міст (flex:1 займає всю вільну висоту → рівні відступи між рядками). */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginTop: 8, overflow: 'hidden' }}>
          {data.empty ? <div style={{ fontSize: 22, color: C.ink2 }}>Міста ще набирають бали</div> : topRows(rows, s)}
        </div>

        {/* 3 числа: сума (акцент) + двоє другорядних. */}
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>{numberCards(data, { width: 568, gap: 12, valueFs: 32, labelFs: 15, padX: 14, padY: 11 })}</div>
      </div>
    </div>
  );
}

const GRAD =
  'radial-gradient(1000px 600px at 84% 116%, rgba(224,168,120,0.14), transparent 62%),' +
  'linear-gradient(178deg, #221B16 0%, #1B1714 60%, #17120E 100%)';

/** Розміри елементів рядка топу — формати ущільнюють при топ-10. */
interface RowSizes {
  rankW: number;
  rankFs: number;
  nameFs: number;
  ptsFs: number;
  barW: number;
  barH: number;
  ptsW: number;
}

/** Рядки топу: кожен flex:1 — рівно ділять доступну висоту списку. Ранг — плоске число
 *  (№1 акцентом, решта приглушено), без бейджа-плитки; бали — Onest, світлі. */
function topRows(rows: ReportTopCity[], s: RowSizes): React.ReactElement[] {
  return rows.map((c) => (
    <div key={c.rank} style={{ display: 'flex', alignItems: 'center', flex: 1, minHeight: 0, gap: 14 }}>
      <div
        style={{
          width: s.rankW,
          flexShrink: 0,
          fontSize: s.rankFs,
          fontWeight: 700,
          color: c.rank === 1 ? C.accentSoft : C.ink3,
          textAlign: 'center',
        }}
      >
        {String(c.rank)}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: s.nameFs,
          color: C.ink,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {c.abroad ? `${c.name} · за кордоном` : c.name}
      </div>
      <div style={{ width: s.barW, height: s.barH, borderRadius: 999, backgroundColor: C.card2, display: 'flex', flexShrink: 0, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(4, c.pct * 100)}%`, height: '100%', backgroundImage: `linear-gradient(90deg, ${C.accentDeep}, ${C.accentSoft})`, borderRadius: 999 }} />
      </div>
      <div style={{ width: s.ptsW, fontSize: s.ptsFs, fontWeight: 700, color: C.ink, textAlign: 'right', flexShrink: 0 }}>
        {c.points}
      </div>
    </div>
  ));
}

/**
 * Лого-локап: плитка-скайлайн (бурштиновий градієнт як на лендингу) + словознак «GraMista»
 * (Manrope) + таглайн «змагання міст України». Іконка — інлайн-«будинки» (не емодзі: у satori
 * емодзі тягнеться по мережі).
 */
function brandLockup(scale: number): React.ReactElement {
  const tile = Math.round(46 * scale);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(14 * scale) }}>
      <img
        src={brandLogoUri()}
        width={tile}
        height={tile}
        style={{ borderRadius: Math.round(tile * 0.32), boxShadow: '0 6px 16px rgba(182,110,67,0.32)' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontFamily: 'Brand', fontWeight: 800, fontSize: Math.round(30 * scale), letterSpacing: 0.2, lineHeight: 1 }}>
          <span style={{ color: C.ink }}>Gra</span>
          <span style={{ color: C.accentSoft }}>Mista</span>
        </div>
        <div style={{ fontSize: Math.round(13.5 * scale), color: C.ink3, marginTop: 3 }}>змагання міст України</div>
      </div>
    </div>
  );
}

/** Текст кикера/лейбла топу за типом звіту (стрім чи збір) — єдине джерело формулювань. */
function kickerText(kind: ReportData['kind']): string {
  return kind === 'collection' ? 'Звіт збору' : 'Звіт стріму';
}
function topLabel(kind: ReportData['kind']): string {
  return kind === 'collection' ? 'Топ міст збору' : 'Топ міст стріму';
}

/** Кикер-категорія-пігулка («Звіт стріму»/«Звіт збору»). */
function kicker(fs: number, text: string): React.ReactElement {
  return (
    <div style={{ display: 'flex', fontSize: fs, fontWeight: 700, color: C.accentSoft, border: `1px solid ${C.line}`, borderRadius: 999, padding: '7px 20px' }}>
      {text}
    </div>
  );
}

/**
 * Мапа міст як `<img>` + HTML-підписи топ-N міст поверх (resvg не малює <text> із вкладеного SVG).
 * labelsN — скільки назв показати (0 = без назв). Позиції — проєкція координат у пікселі боксу.
 * Легкий анти-наліз: підпис, чия пігулка накрила б уже поставлену, пропускаємо (вищий у топі —
 * пріоритетніший), щоб назви не наповзали одна на одну.
 */
function mapBlock(data: ReportData, w: number, h: number, labelsN: number): React.ReactElement {
  // Мале поле — щоб контур України заповнював бокс (герой), а не тулився вузькою смугою посередині.
  const box: MapBox = { width: w, height: h, pad: 14, vivid: true };
  const src = mapImageDataUri(data.map.map((p) => ({ lat: p.lat, lon: p.lon, points: p.points })), box);
  const fs = Math.min(22, Math.max(15, Math.round(w * 0.026)));
  // Підписи НЕ ховаємо (інакше губились би потрібні міста типу Дніпро/Вінниця поряд із сусідами),
  // а РОЗНОСИМО вертикально: пробуємо центр пігулки над крапкою, під, ще вище/нижче — беремо перший
  // без збігу з уже поставленою (горизонтально — сума півширин обох пігулок; вертикально — висота).
  const halfWidth = (name: string) => name.length * fs * 0.3 + 10;
  const step = Math.round(fs * 1.35);
  const placed: { x: number; y: number; hw: number }[] = [];
  const labels: { x: number; y: number; name: string }[] = [];
  for (const c of data.mapLabels.slice(0, Math.max(0, labelsN))) {
    const p = projectToBox(box, c.lon, c.lat);
    if (!p) continue;
    const hw = halfWidth(c.name);
    const cands = [p.y - step, p.y + step, p.y - step * 2, p.y + step * 2, p.y - step * 3, p.y + step * 3];
    let cy = p.y - step;
    for (const cand of cands) {
      const clash = placed.some((q) => Math.abs(q.x - p.x) < (q.hw + hw) * 0.92 && Math.abs(q.y - cand) < fs * 1.3);
      if (!clash) { cy = cand; break; }
    }
    placed.push({ x: p.x, y: cy, hw });
    labels.push({ x: p.x, y: cy, name: c.name });
  }
  return (
    <div style={{ position: 'relative', width: w, height: h, display: 'flex' }}>
      <img src={src} width={w} height={h} />
      {labels.map((l, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: Math.round(l.x),
            top: Math.round(l.y),
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'rgba(20,16,13,0.78)',
            border: `1px solid ${C.line}`,
            borderRadius: 999,
            padding: '3px 11px',
            fontSize: fs,
            fontWeight: 700,
            color: C.ink,
            whiteSpace: 'nowrap',
          }}
        >
          {l.name}
        </div>
      ))}
    </div>
  );
}

/**
 * Прогрес-бар цілі збору (лише коли ціль задана). Бар клампимо в 100%, а текст показує
 * фактичний відсоток (може бути >100 при перевиконанні).
 */
function progressBar(goal: NonNullable<ReportData['goal']>, width: number): React.ReactElement {
  const fill = Math.min(100, goal.pct);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width }}>
      <div style={{ display: 'flex', width, height: 14, borderRadius: 999, backgroundColor: C.card2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(2, fill)}%`, height: '100%', backgroundImage: `linear-gradient(90deg, ${C.accentDeep}, ${C.accentSoft})`, borderRadius: 999 }} />
      </div>
      <div style={{ fontSize: 18, color: C.ink3, marginTop: 8 }}>
        {`ціль ${formatUahWhole(goal.goalUah)} · ${goal.pct}%`}
      </div>
    </div>
  );
}

/** Ширина рядка в em (наближено, Onest): цифра ~0.6, вузький пробіл-роздільник розрядів ~0.25.
 *  Потрібна, щоб підібрати кегль під фактичну ширину картки, а не вгадувати бакетами. */
function widthEm(s: string): number {
  let em = 0;
  for (const ch of s) {
    if (ch === ' ' || ch === ' ') em += 0.25;
    else if (ch === ',' || ch === '.') em += 0.3;
    else em += 0.6;
  }
  return em;
}

export interface CardSizes {
  /** Повна ширина ряду карток (потрібна, щоб порахувати ширину однієї картки). */
  width: number;
  gap: number;
  /** Стеля кегля значення (більше не піднімаємось, навіть коли число коротке). */
  valueFs: number;
  labelFs: number;
  padX: number;
  padY: number;
}

/**
 * Один кегль на всі три числа — той, що вміщає найдовше з них у картку. Числа стоять на
 * спільній лінії й читаються як один ряд; сума виділена кольором, а не розміром (різні кеглі
 * робили ряд «драбинкою», а сума при бакетах «за довжиною» взагалі виходила дрібнішою за «200»).
 */
export function cardValueFontSize(values: string[], z: CardSizes): number {
  const inner = (z.width - z.gap * (values.length - 1)) / values.length - z.padX * 2;
  const longest = Math.max(...values.map(widthEm));
  return Math.max(14, Math.min(z.valueFs, Math.floor(inner / longest)));
}

/** Три картки чисел: сума (акцентом) + двоє другорядних. Однакові ширини, спільний кегль. */
function numberCards(data: ReportData, z: CardSizes): React.ReactElement[] {
  const items = [
    { label: data.hero.label, value: data.hero.value, accent: true },
    ...data.stats.map((st) => ({ label: st.label, value: st.value, accent: false })),
  ];
  const vf = cardValueFontSize(items.map((st) => st.value), z);
  return items.map((st, i) => {
    return (
      <div
        key={i}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          flexBasis: 0,
          backgroundColor: C.card,
          backgroundImage: 'linear-gradient(180deg, rgba(255,244,232,0.05), rgba(255,244,232,0))',
          border: `1px solid ${C.line}`,
          borderRadius: 14,
          padding: `${z.padY}px ${z.padX}px`,
        }}
      >
        <div style={{ fontSize: vf, fontWeight: 700, lineHeight: 1.05, color: st.accent ? C.accentSoft : C.ink, whiteSpace: 'nowrap' }}>{st.value}</div>
        <div style={{ fontSize: z.labelFs, color: C.ink3, marginTop: 5 }}>{st.label}</div>
      </div>
    );
  });
}

/**
 * Квадрат 1080×1080 (Instagram-стрічка, TG-пост). Абсолютні регіони з явними розмірами.
 */
export function layoutSquare(data: ReportData, topN: 5 | 10, labelsN: number): React.ReactElement {
  const rows = data.top.slice(0, topN);
  const compact = rows.length > 5;
  const s: RowSizes = compact
    ? { rankW: 32, rankFs: 20, nameFs: 21, ptsFs: 21, barW: 214, barH: 11, ptsW: 92 }
    : { rankW: 40, rankFs: 26, nameFs: 30, ptsFs: 30, barW: 220, barH: 16, ptsW: 104 };
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', backgroundColor: C.bg, backgroundImage: GRAD, color: C.ink, fontFamily: 'Onest' }}>
      <div style={{ position: 'absolute', left: 56, top: 52, display: 'flex' }}>{brandLockup(1.08)}</div>
      <div style={{ position: 'absolute', right: 56, top: 62, display: 'flex' }}>{kicker(22, kickerText(data.kind))}</div>
      <div style={{ position: 'absolute', left: 56, top: 150, width: 968, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: titleFontSize(data.title.length, 'square'), fontWeight: 700, lineHeight: 1.08, lineClamp: 2 }}>{data.title}</div>
        <div style={{ fontSize: 24, color: C.ink3, marginTop: 8 }}>{data.subtitle}</div>
        {data.goal && <div style={{ display: 'flex', marginTop: 14 }}>{progressBar(data.goal, 968)}</div>}
      </div>
      {/* Мапа-герой: велика, правильний аспект (заповнює бокс). */}
      <div style={{ position: 'absolute', left: 200, top: 272, display: 'flex' }}>{mapBlock(data, 680, 376, labelsN)}</div>
      <div style={{ position: 'absolute', left: 56, top: 664, fontSize: 23, color: C.ink3 }}>{topLabel(data.kind)}</div>
      <div style={{ position: 'absolute', left: 56, top: 704, width: 968, height: 224, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {data.empty ? <div style={{ fontSize: 26, color: C.ink2 }}>Міста ще набирають бали</div> : topRows(rows, s)}
      </div>
      <div style={{ position: 'absolute', left: 56, bottom: 44, width: 968, display: 'flex', gap: 16 }}>{numberCards(data, { width: 968, gap: 16, valueFs: 40, labelFs: 18, padX: 20, padY: 13 })}</div>
    </div>
  );
}

/**
 * Вертикаль 1080×1920 (Stories) і портрет 1080×1350 (IG-стрічка) — спільна стопка на
 * абсолютних регіонах. Вертикаль тримає верх/низ safe-zone. Знизу QR-донат, якщо переданий.
 */
export function layoutTall(
  data: ReportData,
  topN: 5 | 10,
  opts: { portrait: boolean; qrImg?: string; labelsN: number },
): React.ReactElement {
  const rows = data.top.slice(0, topN);
  const compact = rows.length > 5;
  const s: RowSizes = compact
    ? { rankW: 40, rankFs: 23, nameFs: 25, ptsFs: 25, barW: 230, barH: 13, ptsW: 108 }
    : { rankW: 50, rankFs: 30, nameFs: 36, ptsFs: 36, barW: 260, barH: 18, ptsW: 130 };
  const P = opts.portrait;
  // Регіони: вертикаль зсунута вниз на safe-zone; список вміщає топ-10 (listH ≥ 10×рядок). mapW/mapH —
  // правильний аспект (~1.5:1), щоб контур був героєм, а не смугою.
  const c = P
    ? { brand: 52, kicker: 60, title: 130, mapW: 700, map: 288, mapH: 444, toplbl: 752, list: 792, listH: 262, stats: 1066, qr: 1174 }
    : { brand: 222, kicker: 230, title: 320, mapW: 840, map: 470, mapH: 540, toplbl: 1030, list: 1072, listH: 330, stats: 1414, qr: 1512 };
  const mapLeft = Math.round((1080 - c.mapW) / 2);
  const handle = data.qr ? (data.qr.url.split('/').filter(Boolean).pop() ?? '') : '';
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', backgroundColor: C.bg, backgroundImage: GRAD, color: C.ink, fontFamily: 'Onest' }}>
      <div style={{ position: 'absolute', left: 56, top: c.brand, display: 'flex' }}>{brandLockup(1.14)}</div>
      <div style={{ position: 'absolute', right: 56, top: c.kicker, display: 'flex' }}>{kicker(24, kickerText(data.kind))}</div>
      <div style={{ position: 'absolute', left: 56, top: c.title, width: 968, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: titleFontSize(data.title.length, P ? 'portrait' : 'vertical'), fontWeight: 700, lineHeight: 1.08, lineClamp: 2 }}>{data.title}</div>
        <div style={{ fontSize: 28, color: C.ink3, marginTop: 10 }}>{data.subtitle}</div>
        {data.goal && <div style={{ display: 'flex', marginTop: 14 }}>{progressBar(data.goal, 968)}</div>}
      </div>
      <div style={{ position: 'absolute', left: mapLeft, top: c.map, display: 'flex' }}>{mapBlock(data, c.mapW, c.mapH, opts.labelsN)}</div>
      <div style={{ position: 'absolute', left: 56, top: c.toplbl, fontSize: 26, color: C.ink3 }}>{topLabel(data.kind)}</div>
      <div style={{ position: 'absolute', left: 56, top: c.list, width: 968, height: c.listH, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {data.empty ? <div style={{ fontSize: 30, color: C.ink2 }}>Міста ще набирають бали</div> : topRows(rows, s)}
      </div>
      <div style={{ position: 'absolute', left: 56, top: c.stats, width: 968, display: 'flex', gap: 20 }}>{numberCards(data, { width: 968, gap: 20, valueFs: 42, labelFs: 20, padX: 22, padY: 12 })}</div>
      {opts.qrImg && (
        <div style={{ position: 'absolute', left: 56, top: c.qr, width: 968, display: 'flex', alignItems: 'center', gap: 26, backgroundColor: C.card, border: `1px solid ${C.line}`, borderRadius: 24, padding: '22px 28px' }}>
          <img src={opts.qrImg} width={128} height={128} style={{ borderRadius: 12 }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 36, fontWeight: 700 }}>
              <span style={{ color: C.ink }}>Донать → </span>
              <span style={{ color: C.accentSoft }}>/{handle}</span>
            </div>
            <div style={{ fontSize: 25, color: C.ink3, marginTop: 4 }}>наведи камеру на QR</div>
          </div>
        </div>
      )}
    </div>
  );
}
