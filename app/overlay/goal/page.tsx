import { prisma } from '@/lib/db';
import { userIdByOverlayKey } from '@/lib/publicUser';
import { collectionSummary } from '@/lib/collections';
import { formatUah } from '@/lib/format';
import { parseOverlayConfig } from '@/lib/overlayConfig';
import { OverlayShell } from '@/app/overlay/OverlayShell';

export const dynamic = 'force-dynamic';
type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function GoalOverlay({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const key = typeof sp.k === 'string' ? sp.k : '';
  const U = await userIdByOverlayKey(prisma, key);
  if (!U) return <div className="ov-empty">Силку оверлея не розпізнано. Відкрий «Оверлеї» в панелі й скопіюй свіже посилання.</div>;
  const cfg = parseOverlayConfig(sp);
  const col = await prisma.collection.findFirst({
    where: { userId: U, status: 'active' },
    orderBy: { startAt: 'desc' },
  });
  const cs = col ? await collectionSummary(prisma, U, col) : null;

  return (
    <OverlayShell config={cfg} channelKey={key}>
      {cs && (
        <section className="ov ov-goal">
          {cfg.title && <div className="ov-title">🎯 {cs.name}</div>}
          {cs.goalUah != null ? (
            <>
              <div className="goal-bar">
                <i style={{ width: `${cs.displayedPercent}%` }} />
              </div>
              <div className="goal-val">
                <b>{formatUah(cs.displayedUah)}</b> / {formatUah(cs.goalUah)}{' '}
                <span className="goal-pct">{Math.round(cs.displayedPercent)}%</span>
              </div>
            </>
          ) : (
            <div className="goal-val">
              <b>{formatUah(cs.displayedUah)}</b>
            </div>
          )}
        </section>
      )}
    </OverlayShell>
  );
}
