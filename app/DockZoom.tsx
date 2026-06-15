'use client';
import { useEffect, useState } from 'react';

// Масштаб доку: A−/A+ міняють zoom кореня .dock-root і зберігають у localStorage (per-браузер).
// Старт — збережене значення або initialScale зі силки (?scale). 50..200%, крок 10.
const KEY = 'gramista.dock.scale';

export function DockZoom({ initialScale }: { initialScale: number }) {
  const [scale, setScale] = useState(initialScale);

  useEffect(() => {
    const saved = Number.parseInt(localStorage.getItem(KEY) ?? '', 10);
    if (Number.isFinite(saved)) setScale(Math.min(200, Math.max(50, saved)));
  }, []);

  useEffect(() => {
    const root = document.querySelector('.dock-root') as HTMLElement | null;
    if (root) root.style.zoom = String(scale / 100);
    localStorage.setItem(KEY, String(scale));
  }, [scale]);

  const bump = (d: number) => setScale((s) => Math.min(200, Math.max(50, s + d)));

  return (
    <span className="dk-zoom">
      <button type="button" onClick={() => bump(-10)} aria-label="Менший">A−</button>
      <span className="zp">{scale}%</span>
      <button type="button" onClick={() => bump(10)} aria-label="Більший">A+</button>
    </span>
  );
}
