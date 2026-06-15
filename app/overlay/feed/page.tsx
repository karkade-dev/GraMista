import { prisma } from '@/lib/db';
import { userIdByOverlayKey } from '@/lib/publicUser';
import { getState } from '@/lib/dashboard';
import { getActiveCollection } from '@/lib/collections';
import { windowFor, type Range } from '@/lib/period';
import { formatUah, formatPoints, pluralBaliv, initial, oneLineComment } from '@/lib/format';
import { parseOverlayConfig } from '@/lib/overlayConfig';
import { OverlayShell } from '@/app/overlay/OverlayShell';
import { OverlayAlert } from '@/app/OverlayAlert';

export const dynamic = 'force-dynamic';
type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function FeedOverlay({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const key = typeof sp.k === 'string' ? sp.k : '';
  const U = await userIdByOverlayKey(prisma, key);
  if (!U) return <div className="ov-empty">Силку оверлея не розпізнано. Відкрий «Оверлеї» в панелі й скопіюй свіже посилання.</div>;
  const cfg = parseOverlayConfig(sp, { period: 'all', rows: 6 });

  // Скоуп: стрім / активний збір (нема збору → фолбек на «весь час») / часове вікно.
  let scope: { streamId?: string; collectionId?: string } = {};
  if (cfg.period === 'stream') {
    const s = await prisma.stream.findFirst({
      where: { userId: U, endedAt: null },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    scope = s ? { streamId: s.id } : {};
  } else if (cfg.period === 'collection') {
    const col = await getActiveCollection(prisma, U);
    scope = col ? { collectionId: col.id } : {};
  }
  const window = cfg.period === 'stream' || cfg.period === 'collection' ? {} : windowFor(cfg.period as Range);
  const state = await getState(prisma, U, window, scope);
  const recent = state.recent;

  return (
    <OverlayShell config={cfg} channelKey={key}>
      {cfg.feed === 'list' ? (
        <section className="ov ov-list">
          {cfg.title && (
            <div className="ov-head">
              <div className="ov-title">💛 Останні донати</div>
            </div>
          )}
          {recent.slice(0, cfg.rows).map((d) => {
            const muted = !d.city;
            return (
              <div className="li" key={d.externalId}>
                <div className={`av${muted ? ' muted' : ''}`}>{initial(d.who)}</div>
                <div className="lb">
                  <div className="l-top">
                    <span className="l-name">{d.who}</span>
                    <span className="l-sum">+{formatUah(d.amountUah)}</span>
                  </div>
                  <div className="l-meta">
                    {d.city ? <b>{d.city}</b> : 'місто не вказане'}
                    {d.newCity && <span className="l-ncty">🆕 нове місто</span>}
                    {d.abroad && <span className="l-acty">🌍 закордон</span>}
                    {d.city && d.points > 0
                      ? ` · +${formatPoints(d.points)} ${pluralBaliv(d.points)}`
                      : d.city
                        ? ' · у скарбничку'
                        : ''}
                  </div>
                  {cfg.comment && d.message && <div className="l-msg">{oneLineComment(d.message)}</div>}
                </div>
              </div>
            );
          })}
        </section>
      ) : (
        <OverlayAlert
          latest={
            recent[0]
              ? {
                  externalId: recent[0].externalId,
                  who: recent[0].who,
                  amountUah: recent[0].amountUah,
                  city: recent[0].city,
                  points: recent[0].points,
                  message: cfg.comment ? oneLineComment(recent[0].message) : '',
                  newCity: recent[0].newCity,
                  abroad: recent[0].abroad,
                }
              : null
          }
        />
      )}
    </OverlayShell>
  );
}
