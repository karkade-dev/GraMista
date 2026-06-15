'use client';

import { useState } from 'react';
import type { LeaderRow } from '@/lib/leaderboard';
import { formatPoints } from '@/lib/format';

const MEDALS = ['🥇', '🥈', '🥉'];

// Подія «відкрити картку міста» — той самий патерн, що gramista:flash (роз'єднує топ/мапу/картку).
export function openCity(settlementId: string) {
  window.dispatchEvent(new CustomEvent('gramista:city', { detail: { settlementId } }));
}

function Row({ c, i }: { c: LeaderRow; i: number }) {
  return (
    <div className="pub-trow" onClick={() => openCity(c.settlementId)}>
      <span className="medal">{MEDALS[i] ?? i + 1}</span>
      <span className="nm">{c.name}</span>
      <span className="pts">{formatPoints(c.points)} б</span>
    </div>
  );
}

function TopList({ rows, allLabel = 'Усі міста' }: { rows: LeaderRow[]; allLabel?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const shown = rows.slice(0, expanded ? 30 : 10);
  return (
    <>
      <div className="pub-toplist">
        {shown.map((c, i) => <Row key={c.settlementId} c={c} i={i} />)}
        {rows.length === 0 && <div className="pub-empty">ще жодне місто не має балів</div>}
      </div>
      {rows.length > 10 && (
        <button type="button" className="pub-texpand" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'згорнути ▴' : 'показати топ-30 ▾'}
        </button>
      )}
      {rows.length > 30 && (
        <div className="pub-tfoot">
          <button type="button" onClick={() => setAllOpen(true)}>усі міста →</button>
        </div>
      )}
      {allOpen && (
        <div className="pub-race-bg" onClick={() => setAllOpen(false)}>
          <div className="pub-panel pub-all" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="x" aria-label="закрити" onClick={() => setAllOpen(false)}>✕</button>
            <h3>{allLabel} ({rows.length})</h3>
            <div className="list">
              {rows.map((c, i) => <Row key={c.settlementId} c={c} i={i} />)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function TopCities({ rows, abroadRows }: { rows: LeaderRow[]; abroadRows?: LeaderRow[] }) {
  if (abroadRows) {
    return (
      <div className="pub-topsplit">
        <div>
          <div className="pub-topcap pub-topcap-ua">Міста України</div>
          <TopList rows={rows} />
        </div>
        <div>
          <div className="pub-topcap pub-topcap-abroad">🌍 Світ / Діаспора</div>
          <TopList rows={abroadRows} allLabel="Усі закордонні міста" />
        </div>
      </div>
    );
  }
  return <TopList rows={rows} />;
}
