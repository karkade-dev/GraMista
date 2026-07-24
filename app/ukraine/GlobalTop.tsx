'use client';

import { useState } from 'react';
import { formatUahWhole } from '@/lib/format';
import type { GlobalTopRow, GlobalWindow } from '@/lib/globalMap';
import { openCity } from './openCity';

const MEDALS = ['🥇', '🥈', '🥉'];
const TABS: { w: GlobalWindow; label: string }[] = [
  { w: 'all', label: 'Весь час' },
  { w: 'month', label: 'Місяць' },
  { w: 'week', label: 'Тиждень' },
];

// Топ міст ₴ із перемикачем вікна. Три набори рендеряться сервером заздалегідь — острівець
// лише перемикає видимий (нуль зайвих API-роутів). Рядок клікабельний → картка міста.
export function GlobalTop({ all, month, week }: { all: GlobalTopRow[]; month: GlobalTopRow[]; week: GlobalTopRow[] }) {
  const [w, setW] = useState<GlobalWindow>('all');
  const rows = w === 'all' ? all : w === 'month' ? month : week;

  return (
    <>
      <div className="ukr-wtabs">
        {TABS.map((t) => (
          <button key={t.w} type="button" className={'ukr-wtab' + (w === t.w ? ' on' : '')} onClick={() => setW(t.w)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="ukr-toplist">
        {rows.length === 0 ? (
          <div className="ukr-empty">Тут поки порожньо — запали перше місто 🔥</div>
        ) : (
          rows.map((r, i) => (
            <button key={r.settlementId} type="button" className="ukr-trow" onClick={() => openCity(r.settlementId)}>
              <span className="medal">{MEDALS[i] ?? i + 1}</span>
              <span className="nm">{r.name}</span>
              <span className="uah">{formatUahWhole(r.sumUah)}</span>
            </button>
          ))
        )}
      </div>
      <div className="ukr-hint">запали своє місто — <b>задонать і напиши його в коментарі</b></div>
    </>
  );
}
