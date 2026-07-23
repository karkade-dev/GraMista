'use client';

import { useEffect, useState } from 'react';
import type { CityDetail } from '@/lib/dashboard';
import { formatUah, formatPoints, pluralBaliv } from '@/lib/format';

const MEDALS = ['🥇', '🥈', '🥉'];

// Картка міста (клік на крапку мапи / рядок топу / результат пошуку): слухає подію
// gramista:city (патерн gramista:flash), тягне публічні дані з API і показує панель.
export function CityCardHost({ handle, jarUrl }: { handle: string; jarUrl: string | null }) {
  const [card, setCard] = useState<{ detail: CityDetail; place: number | null } | null>(null);

  useEffect(() => {
    const onCity = async (e: Event) => {
      const id = (e as CustomEvent<{ settlementId: string }>).detail?.settlementId;
      if (!id) return;
      try {
        const r = await fetch(
          `/api/public/${encodeURIComponent(handle)}/city/${encodeURIComponent(id)}`,
        );
        if (!r.ok) return;
        setCard((await r.json()) as { detail: CityDetail; place: number | null });
      } catch {
        // мережа недоступна — картку просто не відкриваємо
      }
    };
    window.addEventListener('gramista:city', onCity);
    return () => window.removeEventListener('gramista:city', onCity);
  }, [handle]);

  if (!card) return null;
  const { detail, place } = card;
  return (
    <aside className="pub-panel pub-citycard" aria-label={`Місто ${detail.name}`}>
      <button type="button" className="x" aria-label="закрити" onClick={() => setCard(null)}>✕</button>
      <h3>{detail.name}</h3>
      <div className="place">
        {place !== null ? `${MEDALS[place - 1] ?? ''} ${place} місце · ` : ''}
        {formatPoints(detail.points)} {pluralBaliv(detail.points)}
        {detail.oblast ? ` · ${detail.oblast}` : ''}
      </div>
      {detail.topDonors.length > 0 ? (
        <>
          <div className="cdcap">Топ донатерів</div>
          {detail.topDonors.slice(0, 5).map((d, i) => (
            <div className="cdon" key={i}>
              <span>{d.who}</span>
              {d.count > 1 && <span className="n">×{d.count}</span>}
              <span className="a">+{formatUah(d.totalUah)}</span>
            </div>
          ))}
        </>
      ) : (
        <div className="cdon" style={{ color: 'var(--ink-3)' }}>ще без донатів — виправ це 😉</div>
      )}
      {jarUrl && (
        <a className="pub-don" href={jarUrl} target="_blank" rel="noreferrer">
          ⚡ Задонатити за це місто
        </a>
      )}
    </aside>
  );
}
