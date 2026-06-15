'use client';
import { useEffect, useState } from 'react';
import { formatUah, formatPoints, pluralBaliv, initial } from '@/lib/format';

export interface AlertDonation {
  externalId: string;
  who: string;
  amountUah: number;
  city: string | null;
  points: number;
  /** Коментар донату для показу (уже зацензурений у getState); '' — не рендеримо. */
  message: string;
  /** Донат відкрив місто (перший бал у зборі) — святкова стрічка на алерті. */
  newCity: boolean;
  /** Закордонне місто — мітка 🌍 в алерті. */
  abroad: boolean;
}

// router.refresh (LiveRefresh) ре-маунтить компонент, тож базову лінію й активний показ тримаємо
// на рівні модуля (як OvertakeWatcher/CountUp). Перший рендер після відкриття силки лише фіксує
// базову лінію (нічого не блимає) — алерт спливає тільки на ЖИВИЙ новий донат.
let baselineId: string | null = null;
let shown: AlertDonation | null = null;
let shownUntil = 0;

export function OverlayAlert({ latest }: { latest: AlertDonation | null }) {
  const [, force] = useState(0);

  useEffect(() => {
    if (!latest) return;
    if (baselineId === null) {
      baselineId = latest.externalId;
      return;
    }
    if (latest.externalId !== baselineId) {
      baselineId = latest.externalId;
      shown = latest;
      shownUntil = Date.now() + 8000; // = тривалість CSS-анімації ov-pop (мусять збігатися)
      force((x) => x + 1);
    }
  }, [latest?.externalId]);

  useEffect(() => {
    if (!(shown && Date.now() < shownUntil)) return;
    const t = setTimeout(() => force((x) => x + 1), shownUntil - Date.now());
    return () => clearTimeout(t);
  });

  const d = shown && Date.now() < shownUntil ? shown : null;
  if (!d) return null;
  const muted = !d.city;
  return (
    <section className="ov ov-alert show" key={d.externalId}>
      {d.newCity && <div className="ov-ncty">🎉 Нове місто на мапі!</div>}
      <div className={`avatar${muted ? ' muted' : ''}`}>{initial(d.who)}</div>
      <div className="d-body">
        <div className="d-top">
          <span className="d-name">{d.who}</span>
          <span className="d-sum">+{formatUah(d.amountUah)}</span>
        </div>
        <div className="d-meta">
          <span className="place">{d.city ?? 'місто не вказане'}</span>
          {d.abroad && <span className="badge abroad">🌍 закордон</span>}
          {d.city && d.points > 0 ? (
            <span className="badge">＋ {formatPoints(d.points)} {pluralBaliv(d.points)} місту</span>
          ) : d.city ? (
            <span className="badge pot">🫙 у скарбничку</span>
          ) : (
            <span className="badge none">місто не розпізнане</span>
          )}
        </div>
        {d.message && <div className="d-msg">{d.message}</div>}
      </div>
    </section>
  );
}
