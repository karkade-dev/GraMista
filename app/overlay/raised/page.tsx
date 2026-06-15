import { prisma } from '@/lib/db';
import { userIdByOverlayKey } from '@/lib/publicUser';
import { getActiveCollection } from '@/lib/collections';
import { windowFor, createdAtWhere, type Range } from '@/lib/period';
import { parseOverlayConfig } from '@/lib/overlayConfig';
import { OverlayShell } from '@/app/overlay/OverlayShell';
import { CountUp } from '@/app/CountUp';

export const dynamic = 'force-dynamic';
type SP = Promise<Record<string, string | string[] | undefined>>;
const LABEL: Record<string, string> = { collection: 'за збір', stream: 'за стрім', week: 'за тиждень', month: 'за місяць', all: 'за весь час' };

export default async function RaisedOverlay({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const key = typeof sp.k === 'string' ? sp.k : '';
  const U = await userIdByOverlayKey(prisma, key);
  if (!U) return <div className="ov-empty">Силку оверлея не розпізнано. Відкрий «Оверлеї» в панелі й скопіюй свіже посилання.</div>;
  const cfg = parseOverlayConfig(sp, { period: 'stream' });

  let where: { userId: string; streamId?: string; collectionId?: string; createdAt?: { gte?: Date; lt?: Date } };
  // seedUah ≠ 0 лише для періоду «за збір»: стартова сума додається до показу бара, не до інших періодів.
  let seedUah = 0;
  // Фактичний період показу: коли стріму/збору нема, скоуп падає на «весь час» — і підпис теж,
  // щоб не показувати суму за весь час під написом «за стрім»/«за збір».
  let effective = cfg.period;
  if (cfg.period === 'stream') {
    const s = await prisma.stream.findFirst({
      where: { userId: U, endedAt: null },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (s) where = { userId: U, streamId: s.id };
    else { where = { userId: U }; effective = 'all'; }
  } else if (cfg.period === 'collection') {
    const col = await getActiveCollection(prisma, U);
    if (col) { where = { userId: U, collectionId: col.id }; seedUah = col.seedUah.toNumber(); }
    else { where = { userId: U }; effective = 'all'; }
  } else {
    const ca = createdAtWhere(windowFor(cfg.period as Range));
    where = { userId: U, ...(ca ? { createdAt: ca } : {}) };
  }
  const agg = await prisma.donation.aggregate({ where, _sum: { amount: true } });
  const sum = (agg._sum.amount?.toNumber() ?? 0) + seedUah;

  return (
    <OverlayShell config={cfg} channelKey={key}>
      <section className="ov ov-total ov-raised">
        {cfg.title && <span className="lbl">Зібрано {LABEL[effective]}</span>}
        <span className="val">
          <CountUp id="raised" value={sum} />
        </span>
      </section>
    </OverlayShell>
  );
}
