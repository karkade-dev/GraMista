'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { RecentItem } from '@/lib/dashboard';
import { formatUah, oneLineComment } from '@/lib/format';
import { openCity } from './TopCities';

// router.refresh (живе оновлення) ре-маунтить компонент, тож «що вже бачили» тримаємо на рівні
// модуля (патерн CountUp/OvertakeWatcher): нові externalId отримують клас .new → анімація вʼїзду.
let seen: Set<string> | null = null;

export function FeedList({ rows, biggestId, showComments }: { rows: RecentItem[]; biggestId: string | null; showComments?: boolean }) {
  const prevRef = useRef(seen);
  useEffect(() => {
    seen = new Set(rows.map((r) => r.externalId));
  }, [rows]);

  if (rows.length === 0) return <div className="pub-empty">поки тихо — стань першим 😉</div>;
  const prev = prevRef.current;
  return (
    <div>
      {rows.slice(0, 8).map((r) => {
        // Донат із розпізнаним містом клікабельний → openCity (мапа летить + картка), як рядок топу.
        const sid = r.settlementId;
        const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
          if (sid && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openCity(sid);
          }
        };
        return (
          <div
            key={r.externalId}
            className={
              'pub-frow' +
              (sid ? ' clickable' : '') +
              (r.externalId === biggestId ? ' biggest' : '') +
              (r.newCity ? ' opener' : '') +
              (prev && !prev.has(r.externalId) ? ' new' : '')
            }
            {...(sid
              ? { role: 'button' as const, tabIndex: 0, onClick: () => openCity(sid), onKeyDown: onKey }
              : {})}
          >
            <span className="who">{r.who}</span>
            {r.city && <span className="cty">{r.city}</span>}
            {r.newCity && <span className="ncty">🆕 нове місто</span>}
            {r.abroad && <span className="acty">🌍 закордон</span>}
            <span className="amt">+{formatUah(r.amountUah)}</span>
            {showComments && r.message && <div className="fmsg">{oneLineComment(r.message)}</div>}
          </div>
        );
      })}
    </div>
  );
}
