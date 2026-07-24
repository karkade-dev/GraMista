import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { cityDetail } from '@/lib/dashboard';
import { formatUah, formatPoints, formatDateTime, pluralBaliv, initial } from '@/lib/format';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const s = await prisma.settlement.findFirst({ where: { id }, select: { name: true } });
    return { title: s?.name ? `Місто · ${s.name}` : 'Місто' };
  } catch {
    return { title: 'Місто' };
  }
}

export default async function CityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const U = await requireUserId();
  const { id } = await params;
  // Картка міста — у рамці поточного змагання (активний збір), як дашборд/публічна; нема збору → весь час.
  const col = await prisma.collection.findFirst({ where: { userId: U, status: 'active' }, select: { id: true } });
  const c = await cityDetail(prisma, U, id, {}, { collectionId: col?.id, allRecent: true });
  if (!c) notFound();

  return (
    <div className="tab">
      <section className="card donations-card">
        <div className="card-head">
          <div className="card-title">
            <Link href="/dashboard" className="back-link">
              ← Дашборд
            </Link>
            <span className="ic">📍</span> {c.name}
          </div>
          {c.oblast && <div className="card-hint">{c.oblast}</div>}
        </div>

        <div className="stream-summary">
          <div className="sumbox">
            <span className="sb-val accent">{formatUah(c.raisedUah)}</span>
            <span className="sb-lbl">зібрано</span>
          </div>
          <div className="sumbox">
            <span className="sb-val">{c.donations}</span>
            <span className="sb-lbl">донатів</span>
          </div>
          <div className="sumbox">
            <span className="sb-val">
              {formatPoints(c.points)} <em>{pluralBaliv(c.points)}</em>
            </span>
            <span className="sb-lbl">балів</span>
          </div>
        </div>

        <div className="stream-grid">
          {/* Усі донати міста — повна історія (у рамці активного збору) */}
          <div className="stream-col">
            <div className="col-title">💛 Усі донати</div>
            <div className="feed scroll city-feed">
              {c.recent.length === 0 ? (
                <div className="empty">У цьому місті ще немає донатів.</div>
              ) : (
                c.recent.map((d, i) => (
                  <div className="donate" key={i}>
                    <div className={`avatar${d.points > 0 ? '' : ' muted'}`}>{initial(d.who)}</div>
                    <div className="d-body">
                      <div className="d-top">
                        <span className="d-name">{d.who}</span>
                        <span className="d-sum">+{formatUah(d.amountUah)}</span>
                      </div>
                      <div className="d-meta">
                        {formatDateTime(d.at)}
                        {d.points > 0 ? ` · ＋${formatPoints(d.points)} ${pluralBaliv(d.points)}` : ''}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Топ-донатери міста (анонімно) */}
          <div className="stream-col">
            <div className="col-title">🏅 Топ-донатери</div>
            <div className="top-list scroll stream-top">
              {c.topDonors.length === 0 ? (
                <div className="empty">—</div>
              ) : (
                c.topDonors.map((t, i) => {
                  const rank = i + 1;
                  const medal = rank <= 3 ? ` medal r${rank}` : '';
                  return (
                    <div className={`row${medal}`} key={i}>
                      <div className="rank">{rank}</div>
                      <div className="city">{t.who}</div>
                      <div className="pts">{formatUah(t.totalUah)}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
