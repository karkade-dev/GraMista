import { prisma } from '@/lib/db';
import { userIdByOverlayKey } from '@/lib/publicUser';
import { getState } from '@/lib/dashboard';
import { getActiveCollection } from '@/lib/collections';
import { windowFor, type Range } from '@/lib/period';
import { parseOverlayConfig } from '@/lib/overlayConfig';
import { OverlayShell } from '@/app/overlay/OverlayShell';
import { MapUkraine } from '@/app/MapUkraine';

export const dynamic = 'force-dynamic';
type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function MapOverlay({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const key = typeof sp.k === 'string' ? sp.k : '';
  const U = await userIdByOverlayKey(prisma, key);
  if (!U) return <div className="ov-empty">Силку оверлея не розпізнано. Відкрий «Оверлеї» в панелі й скопіюй свіже посилання.</div>;
  const cfg = parseOverlayConfig(sp, { period: 'all' });

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

  return (
    <OverlayShell config={cfg} channelKey={key}>
      <div className="ov-map-canvas">
        <MapUkraine points={state.map} showControls={false} initialLabels="all" initialView="points" world={state.abroadWorldMap} />
      </div>
    </OverlayShell>
  );
}
