import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { getStreams, getCombined, streamComparison, streamReportText, type StreamSummary } from '@/lib/streams';
import { formatUah, formatPoints, formatDateTime, formatDuration, pluralBaliv } from '@/lib/format';
import { CopyButton } from '@/app/CopyButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Стріми' };

type SP = Record<string, string | string[] | undefined>;

const SORTS: { value: 'date' | 'sum' | 'points'; label: string }[] = [
  { value: 'date', label: 'За датою' },
  { value: 'sum', label: 'За сумою' },
  { value: 'points', label: 'За балами' },
];

function parseSort(v: string | string[] | undefined): 'date' | 'sum' | 'points' {
  return v === 'sum' || v === 'points' ? v : 'date';
}

function periodLabel(s: StreamSummary): string {
  const start = formatDateTime(s.startedAt.getTime());
  return s.endedAt ? `${start} · ${formatDuration(s.durationMs)}` : `${start} · у ефірі`;
}

export default async function StreamsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const U = await requireUserId();
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const idsRaw = sp.ids;
  const selectedIds = Array.isArray(idsRaw) ? idsRaw : idsRaw ? [idsRaw] : [];

  const streams = await getStreams(prisma, U, sort);
  const combined = selectedIds.length >= 2 ? await getCombined(prisma, U, selectedIds) : null;
  const selected = new Set(selectedIds);
  // Графік порівняння — смужки суми/балів кожного обраного стріму (у порядку списку).
  const compareBars = combined ? streamComparison(streams.filter((s) => selected.has(s.id))) : [];

  return (
    <div className="tab">
      <section className="card streams-card">
        <div className="card-head">
          <div className="card-title">
            <span className="ic">🎬</span> Стріми
          </div>
          <div className="segmented sort-seg">
            {SORTS.map((s) => (
              <Link key={s.value} href={`/streams?sort=${s.value}`} className={sort === s.value ? 'active' : undefined}>
                {s.label}
              </Link>
            ))}
          </div>
        </div>

        {combined && (
          <div className="combo-panel">
            <div className="combo-head">
              <span className="combo-title">⚖️ Порівняння {selectedIds.length} стрімів</span>
              <span className="combo-sum">
                {formatUah(combined.sumUah)} · {formatPoints(combined.leaderboard.reduce((a, c) => a + c.points, 0))}{' '}
                {pluralBaliv(combined.leaderboard.reduce((a, c) => a + c.points, 0))}
              </span>
              <Link href={`/streams?sort=${sort}`} className="combo-clear">
                Скинути
              </Link>
            </div>
            {/* Графік: смужки суми (₴) і балів кожного стріму, нормалізовані до максимуму */}
            <div className="combo-chart">
              {compareBars.map((b) => (
                <div className="cc-row" key={b.id}>
                  <div className="cc-name" title={b.name}>{b.name}</div>
                  <div className="cc-bars">
                    <div className="cc-bar sum">
                      <i style={{ width: `${Math.max(b.sumPct, 1.5)}%` }} />
                      <span>{formatUah(b.sumUah)}</span>
                    </div>
                    <div className="cc-bar pts">
                      <i style={{ width: `${Math.max(b.pointsPct, 1.5)}%` }} />
                      <span>
                        {formatPoints(b.points)} {pluralBaliv(b.points)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="combo-cities">
              {combined.leaderboard.slice(0, 12).map((c, i) => (
                <span className="chip" key={c.settlementId}>
                  <b>{i + 1}</b> {c.name}
                  <em>
                    {formatPoints(c.points)} {pluralBaliv(c.points)}
                  </em>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="don-table-wrap scroll">
          {streams.length === 0 ? (
            <div className="empty">Стрімів ще немає. Почни перший стрім із шапки.</div>
          ) : (
            <form method="get" action="/streams" className="stream-list">
              <input type="hidden" name="sort" value={sort} />
              {streams.map((s) => (
                <div className={`stream-card${selected.has(s.id) ? ' picked' : ''}`} key={s.id}>
                  <label className="stream-pick" title="Обрати для порівняння">
                    <input type="checkbox" name="ids" value={s.id} defaultChecked={selected.has(s.id)} />
                  </label>
                  <div className="stream-main">
                    <Link href={`/streams/${s.id}`} className="stream-name">
                      {s.name}
                      {!s.endedAt && <span className="live-tag">● у ефірі</span>}
                    </Link>
                    <div className="stream-meta">
                      {periodLabel(s)}
                      {s.url && (
                        <>
                          {' · '}
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="stream-link" title={s.url}>
                            ↗ дивитись
                          </a>
                        </>
                      )}
                    </div>
                    <div className="stream-cities">
                      {s.topCities.length === 0 ? (
                        <span className="stream-nocity">без балів містам</span>
                      ) : (
                        s.topCities.map((c, i) => (
                          <span className="chip sm" key={c.settlementId}>
                            <b>{i + 1}</b> {c.name}
                          </span>
                        ))
                      )}
                    </div>
                    <details className="edit-details">
                      <summary>📋 Звіт</summary>
                      <div className="report-box">
                        <pre className="report-text">{streamReportText(s)}</pre>
                        <div className="report-actions">
                          <CopyButton text={streamReportText(s)} label="Копіювати звіт" />
                          <a href={`/streams/${s.id}/report-image`} target="_blank" rel="noopener" className="btn-img">
                            🖼 Картинка звіту
                          </a>
                        </div>
                      </div>
                    </details>
                  </div>
                  <div className="stream-stats">
                    <div className="ss sum">{formatUah(s.sumUah)}</div>
                    <div className="ss">
                      {s.donations} донат. · {formatPoints(s.points)} {pluralBaliv(s.points)}
                    </div>
                  </div>
                </div>
              ))}
              <div className="stream-actions">
                <button type="submit" className="btn-find">
                  ⚖️ Порівняти обрані
                </button>
                <span className="pg-info">обери 2+ стріми й натисни «Порівняти»</span>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
