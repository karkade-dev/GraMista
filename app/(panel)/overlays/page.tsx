import { OverlayBuilder } from '@/app/OverlayBuilder';
import { DockLinkCard } from '@/app/DockLinkCard';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { ensureOverlayKey, ensureDockKey } from '@/lib/publicUser';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Оверлеї' };

export default async function OverlaysPage() {
  const U = await requireUserId();
  const overlayKey = await ensureOverlayKey(prisma, U);
  const dockKey = await ensureDockKey(prisma, U);
  return (
    <div className="tab-overlays scroll">
      <p className="ov-intro">
        Кожен віджет — окрема силка. Додай у OBS як <b>Browser Source</b> і розстав, як зручно. Налаштуй
        вигляд і скопіюй силку.
      </p>
      <OverlayBuilder overlayKey={overlayKey} />

      <p className="ov-intro" style={{ marginTop: 24 }}>
        <b>Док донатів</b> — окреме непрозоре вікно зі стрічкою донатів для другого монітора або
        Custom Browser Dock в OBS (Docks → Custom Browser Docks). Глядач його не бачить.
      </p>
      <div className="ovb-grid">
        <DockLinkCard dockKey={dockKey} />
      </div>
    </div>
  );
}
