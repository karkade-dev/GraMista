'use client';
import { useEffect, useState } from 'react';
import { CopyButton } from '@/app/CopyButton';

type Ctrl = 'style' | 'period' | 'rows' | 'sort' | 'scope' | 'feed' | 'scale' | 'chroma' | 'title' | 'comment';
interface Widget {
  path: string;
  label: string;
  icon: string;
  ctrls: Ctrl[];
  defPeriod?: string;
}

const WIDGETS: Widget[] = [
  { path: 'top', label: 'Топ міст', icon: '🏆', ctrls: ['style', 'period', 'rows', 'sort', 'scope', 'scale', 'chroma', 'title'], defPeriod: 'collection' },
  { path: 'feed', label: 'Донати', icon: '💛', ctrls: ['style', 'period', 'feed', 'comment', 'rows', 'scale', 'chroma', 'title'], defPeriod: 'collection' },
  { path: 'raised', label: 'Зібрано', icon: '💰', ctrls: ['style', 'period', 'scale', 'chroma', 'title'], defPeriod: 'stream' },
  { path: 'goal', label: 'Прогрес збору', icon: '🎯', ctrls: ['style', 'scale', 'chroma', 'title'] },
  { path: 'timer', label: 'Таймер', icon: '⏱', ctrls: ['style', 'scale', 'chroma', 'title'] },
  { path: 'map', label: 'Мапа', icon: '🗺️', ctrls: ['style', 'period', 'chroma'], defPeriod: 'collection' },
];

const OPTIONS: Record<Ctrl, { label: string; values: [string, string][] } | 'rows' | 'scale' | 'title' | 'comment'> = {
  style: { label: 'Стиль', values: [['glass', 'Скло'], ['solid', 'Щільне'], ['minimal', 'Мінімал']] },
  period: { label: 'Період', values: [['collection', 'Збір'], ['stream', 'Стрім'], ['week', 'Тиждень'], ['month', 'Місяць'], ['all', 'Весь час']] },
  sort: { label: 'Порядок', values: [['desc', 'Більші зверху'], ['asc', 'Менші зверху']] },
  scope: { label: 'Міста', values: [['ua', 'Україна'], ['abroad', 'Закордон'], ['both', 'Разом']] },
  feed: { label: 'Вигляд', values: [['card', 'Картка'], ['list', 'Список']] },
  chroma: { label: 'Фон', values: [['none', 'Прозорий'], ['green', 'Зелений'], ['blue', 'Синій'], ['magenta', 'Малиновий']] },
  rows: 'rows',
  scale: 'scale',
  title: 'title',
  comment: 'comment',
};

function WidgetCard({ w, origin, overlayKey }: { w: Widget; origin: string; overlayKey: string }) {
  const [cfg, setCfg] = useState<Record<string, string>>(() => ({ ...(w.defPeriod ? { period: w.defPeriod } : {}) }));
  // k=<overlayKey> прив'язує силку до стрімера (оверлей відкривається в OBS без сесії).
  const params = new URLSearchParams(cfg);
  params.set('k', overlayKey);
  const path = `/overlay/${w.path}?${params.toString()}`;
  const url = origin ? origin + path : path;
  // Прев'ю в конструкторі — без живого SSE (preview=1): 6 iframe не тримають по з'єднанню.
  // Силка для OBS (url вище) лишається живою.
  const previewPath = `${path}&preview=1`;
  const set = (k: string, v: string) => setCfg((c) => ({ ...c, [k]: v }));

  return (
    <div className="ovb-card">
      <div className="ovb-head">
        <span>{w.icon} {w.label}</span>
      </div>
      <iframe className="ovb-preview" src={previewPath} title={w.label} />
      <div className="ovb-ctrls">
        {w.ctrls.map((ctrl) => {
          const o = OPTIONS[ctrl];
          if (o === 'rows')
            return (
              <label key={ctrl}>
                Рядків
                <input type="number" min={1} max={20} value={cfg.rows ?? ''} placeholder="5" onChange={(e) => set('rows', e.target.value)} />
              </label>
            );
          if (o === 'scale')
            return (
              <label key={ctrl}>
                Масштаб %
                <input type="number" min={50} max={200} step={10} value={cfg.scale ?? ''} placeholder="100" onChange={(e) => set('scale', e.target.value)} />
              </label>
            );
          if (o === 'title')
            return (
              <label key={ctrl} className="ovb-check">
                <input type="checkbox" checked={cfg.title !== '0'} onChange={(e) => set('title', e.target.checked ? '1' : '0')} /> Заголовок
              </label>
            );
          if (o === 'comment')
            return (
              <label key={ctrl} className="ovb-check">
                <input type="checkbox" checked={cfg.comment !== '0'} onChange={(e) => set('comment', e.target.checked ? '1' : '0')} /> Коментар
              </label>
            );
          return (
            <label key={ctrl}>
              {o.label}
              <select value={cfg[ctrl] ?? o.values[0]?.[0] ?? ''} onChange={(e) => set(ctrl, e.target.value)}>
                {o.values.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <div className="ovb-url">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <CopyButton text={url} label="Силка" />
      </div>
    </div>
  );
}

export function OverlayBuilder({ overlayKey }: { overlayKey: string }) {
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  return (
    <div className="ovb-grid">
      {WIDGETS.map((w) => (
        <WidgetCard key={w.path} w={w} origin={origin} overlayKey={overlayKey} />
      ))}
    </div>
  );
}
