import { prisma } from '@/lib/db';
import { userIdByOverlayKey } from '@/lib/publicUser';
import { leaderboard } from '@/lib/leaderboard';
import { getActiveCollection } from '@/lib/collections';
import { windowFor, type Range } from '@/lib/period';
import { formatPoints, pluralBaliv } from '@/lib/format';
import { parseOverlayConfig } from '@/lib/overlayConfig';
import { OverlayShell } from '@/app/overlay/OverlayShell';
import { OvertakeWatcher } from '@/app/OvertakeWatcher';

export const dynamic = 'force-dynamic';
type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function TopOverlay({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const key = typeof sp.k === 'string' ? sp.k : '';
  const U = await userIdByOverlayKey(prisma, key);
  if (!U) return <div className="ov-empty">Силку оверлея не розпізнано. Відкрий «Оверлеї» в панелі й скопіюй свіже посилання.</div>;
  const cfg = parseOverlayConfig(sp, { period: 'all', rows: 5 });
  const asc = cfg.sort === 'asc';
  const country = cfg.scope === 'both' ? undefined : cfg.scope; // 'ua' | 'abroad' | undefined

  let rows;
  if (cfg.period === 'stream') {
    const s = await prisma.stream.findFirst({
      where: { userId: U, endedAt: null },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    rows = await leaderboard(prisma, U, s ? { streamIds: [s.id], limit: cfg.rows, asc, country } : { limit: cfg.rows, asc, country });
  } else if (cfg.period === 'collection') {
    const col = await getActiveCollection(prisma, U);
    rows = await leaderboard(prisma, U, col ? { collectionId: col.id, limit: cfg.rows, asc, country } : { limit: cfg.rows, asc, country });
  } else {
    rows = await leaderboard(prisma, U, { ...windowFor(cfg.period as Range), limit: cfg.rows, asc, country });
  }
  const maxPts = rows.reduce((m, c) => Math.max(m, c.points), 1);

  return (
    <OverlayShell config={cfg} channelKey={key}>
      <section className="ov ov-top">
        {cfg.title && (
          <div className="ov-head">
            <div className="ov-title">🏆 Топ міст</div>
            <div className="ov-hint">1 бал = 100 ₴</div>
          </div>
        )}
        <div className="toplist">
          {rows.map((c, i) => {
            const rank = i + 1;
            const medal = rank <= 3 ? ` medal r${rank}` : '';
            return (
              <div className={`trow${medal}`} key={c.settlementId}>
                <div className="rank">{rank}</div>
                <div className="tcity">{c.name}</div>
                <div className="tbar">
                  <i style={{ width: `${Math.max(6, (c.points / maxPts) * 100)}%` }} />
                </div>
                <div className="tpts">
                  {formatPoints(c.points)}
                  <em>{pluralBaliv(c.points)}</em>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {!asc && (
        <OvertakeWatcher
          order={rows.map((c) => ({ id: c.settlementId, name: c.name }))}
          viewKey={`ovl-top:${cfg.period}`}
        />
      )}
    </OverlayShell>
  );
}
