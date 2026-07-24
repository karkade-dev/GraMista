import { z } from 'zod';
import { prisma } from '@/lib/db';
import { validateHandle } from '@/lib/handle';
import { userIdByHandle } from '@/lib/publicUser';
import { searchSettlements } from '@/lib/settlements';
import { leaderboard } from '@/lib/leaderboard';

export const dynamic = 'force-dynamic';

const qSchema = z.string().trim().min(2).max(60);

// Пошук міста для публічної сторінки: довідник (searchSettlements) + місце/бали стрімера.
// place=null, points=0 → місто без балів («стань першим»). Лише публічні дані.
export async function GET(req: Request, ctx: { params: Promise<{ handle: string }> }): Promise<Response> {
  const { handle } = await ctx.params;
  const v = validateHandle(decodeURIComponent(handle));
  if (!v.ok) return new Response('not found', { status: 404 });
  const userId = await userIdByHandle(prisma, v.handle);
  if (!userId) return new Response('not found', { status: 404 });

  const parsed = qSchema.safeParse(new URL(req.url).searchParams.get('q') ?? '');
  if (!parsed.success) return Response.json([]);

  // Місце/бали — у межах активного збору (поточне змагання); нема збору → за весь час.
  const col = await prisma.collection.findFirst({ where: { userId, status: 'active' }, select: { id: true } });
  const [hits, rows] = await Promise.all([
    // userId власника handle → глядач бачить і приватні синоніми цього стрімера (це його змагання).
    // 15 (а не 5): тезок з однаковою назвою десятки; глядач має знайти своє село (область у запиті звужує).
    searchSettlements(prisma, parsed.data, 15, userId),
    leaderboard(prisma, userId, { limit: 100_000, ...(col ? { collectionId: col.id } : {}) }),
  ]);
  const byId = new Map(rows.map((r, i) => [r.settlementId, { place: i + 1, points: r.points }]));
  return Response.json(
    hits.map((h) => ({
      id: h.id,
      name: h.name,
      oblast: h.oblast,
      raion: h.raion,
      ...(byId.get(h.id) ?? { place: null, points: 0 }),
    })),
  );
}
