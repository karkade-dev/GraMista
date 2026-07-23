'use client';
import { useEffect, useRef } from 'react';
import { countAsNewDonation } from '@/lib/dockLive';

// Жива поведінка доку поверх SSE. На 1-й сторінці LiveRefresh (монтується окремо) робить
// router.refresh; тут — ДВА режими залежно від номера сторінки:
//  • page 1: новий донат (зміна topId після refresh) → коротка підсвітка верхнього рядка.
//  • page ≥2: список стабільний (LiveRefresh там не монтується); рахуємо нові донати з того ж
//    каналу й показуємо плашку «↑ N нових — на 1-шу сторінку» (елемент #dk-newbar від сервера).
// Каналом ідуть і службові/повторні події (lib/dockLive) — фільтруємо, а rowIds поточної
// сторінки сідають «бачені», щоб інлайн-редагування власних рядків не рахувалось новим донатом.
// Стан тримаємо в ref (переживає re-render); перший монтаж лише фіксує базову лінію.
export function DockLive({ page, topId, rowIds, firstPageHref }: { page: number; topId: string | null; rowIds: string[]; firstPageHref: string }) {
  const lastTop = useRef<string | null | undefined>(undefined);
  const newCount = useRef(0);
  const seen = useRef<Set<string> | null>(null);

  // page 1: підсвітити верхній рядок на зміну topId (крім першого показу).
  useEffect(() => {
    if (page !== 1) return;
    if (lastTop.current === undefined) { lastTop.current = topId; return; }
    if (topId && topId !== lastTop.current) {
      lastTop.current = topId;
      const first = document.querySelector('.dock-root .dk-list .row');
      if (first) {
        first.classList.remove('is-fresh');
        void (first as HTMLElement).offsetWidth; // reflow — перезапустити анімацію
        first.classList.add('is-fresh');
      }
    }
  }, [page, topId]);

  // page ≥2: рахувати нові донати з SSE й показувати плашку.
  useEffect(() => {
    if (page < 2) return;
    const dockKey = new URLSearchParams(window.location.search).get('k') ?? '';
    if (!dockKey) return;
    if (seen.current === null) seen.current = new Set(rowIds);
    const es = new EventSource(`/api/stream?d=${encodeURIComponent(dockKey)}`);
    const bar = document.getElementById('dk-newbar');
    es.onmessage = (e) => {
      if (!countAsNewDonation(e.data, seen.current!)) return;
      newCount.current += 1;
      if (bar) {
        bar.textContent = `↑ ${newCount.current} нових — на 1-шу сторінку`;
        (bar as HTMLElement).style.display = 'block';
        bar.setAttribute('href', firstPageHref);
      }
    };
    return () => es.close();
  }, [page, firstPageHref]);

  return null;
}
