'use client';
import { useEffect, useState } from 'react';
import { CopyButton } from '@/app/CopyButton';

// Картка «Док донатів» у вкладці «Оверлеї»: контроли (період / на сторінку / масштаб),
// прев'ю-iframe (без живого SSE — preview=1) і «копіювати силку». Док — НЕ Browser Source,
// а окреме вікно / Custom Browser Dock в OBS; силка ПРИВАТНА (повні імена + коментарі).
const PERIODS: [string, string][] = [['all', 'Весь час'], ['stream', 'Стрім'], ['today', 'Сьогодні'], ['week', 'Тиждень'], ['month', 'Місяць']];
const PERS: [string, string][] = [['20', '20'], ['30', '30'], ['50', '50']];

export function DockLinkCard({ dockKey }: { dockKey: string }) {
  const [origin, setOrigin] = useState('');
  const [period, setPeriod] = useState('all');
  const [per, setPer] = useState('20');
  const [scale, setScale] = useState('100');
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const params = new URLSearchParams({ k: dockKey, period, per, scale });
  const path = `/dock?${params.toString()}`;
  const url = origin ? origin + path : path;

  return (
    <div className="ovb-card">
      <div className="ovb-head"><span>🪟 Док донатів</span></div>
      <iframe className="ovb-preview" src={`${path}&preview=1`} title="Док донатів" />
      <div className="ovb-ctrls">
        <label>Період
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>На сторінку
          <select value={per} onChange={(e) => setPer(e.target.value)}>
            {PERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Масштаб %
          <input type="number" min={50} max={200} step={10} value={scale} onChange={(e) => setScale(e.target.value)} />
        </label>
      </div>
      <p className="dock-warn">🔒 Приватна силка: показує <b>повні імена й коментарі</b>. Це для тебе (другий монітор / Custom Browser Dock в OBS) — не показуй на стрімі й не ділись. Перегенерувати — у «Налаштуваннях».</p>
      <div className="ovb-url">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <CopyButton text={url} label="Силка для OBS" />
      </div>
    </div>
  );
}
