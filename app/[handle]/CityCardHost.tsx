'use client';

import { useEffect, useRef, useState } from 'react';
import type { CityDetail } from '@/lib/dashboard';
import type { DonationFlash } from '@/lib/map';
import { formatUah, formatPoints, pluralBaliv } from '@/lib/format';

const MEDALS = ['🥇', '🥈', '🥉'];

// Картка міста (клік на крапку мапи / рядок топу / результат пошуку): слухає подію
// gramista:city (патерн gramista:flash), тягне публічні дані з API і показує панель.
// Живий донат у ВІДКРИТЕ місто (gramista:flash із тим самим settlementId) перезавантажує
// картку — інакше бали/донати в ній лишалися б застарілими, поки топ і мапа вже оновились.
export function CityCardHost({ handle, jarUrl }: { handle: string; jarUrl: string | null }) {
  const [card, setCard] = useState<{ detail: CityDetail; place: number | null } | null>(null);
  const openIdRef = useRef<string | null>(null);

  useEffect(() => {
    const load = async (id: string) => {
      try {
        const r = await fetch(
          `/api/public/${encodeURIComponent(handle)}/city/${encodeURIComponent(id)}`,
        );
        if (!r.ok) return;
        if (openIdRef.current !== id) return; // картку встигли закрити/перемкнути
        setCard((await r.json()) as { detail: CityDetail; place: number | null });
      } catch {
        // мережа недоступна — картку просто не відкриваємо
      }
    };

    const onCity = (e: Event) => {
      const id = (e as CustomEvent<{ settlementId: string }>).detail?.settlementId;
      if (!id) return;
      openIdRef.current = id;
      void load(id);
    };
    const onFlash = (e: Event) => {
      const f = (e as CustomEvent<DonationFlash>).detail;
      if (f?.settlementId && f.settlementId === openIdRef.current) void load(f.settlementId);
    };
    window.addEventListener('gramista:city', onCity);
    window.addEventListener('gramista:flash', onFlash);
    return () => {
      window.removeEventListener('gramista:city', onCity);
      window.removeEventListener('gramista:flash', onFlash);
    };
  }, [handle]);

  const onClose = () => {
    openIdRef.current = null;
    setCard(null);
  };

  if (!card) return null;
  const { detail, place } = card;
  return (
    <aside className="pub-panel pub-citycard" aria-label={`Місто ${detail.name}`}>
      <button type="button" className="x" aria-label="закрити" onClick={onClose}>✕</button>
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
