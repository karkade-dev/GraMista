import { Prisma, type PrismaClient } from '@prisma/client';

export interface LeaderRow {
  settlementId: string;
  name: string;
  points: number;
}

export interface LbFilter {
  limit?: number;
  /** включно: подія createdAt >= from */
  from?: Date;
  /** виключно: подія createdAt < to */
  to?: Date;
  /** якщо задано — лише події цих стрімів (події без стріму виключаються) */
  streamIds?: string[];
  /** якщо задано — лише події цього збору (рамка змагання) */
  collectionId?: string;
  /** true — від найменшого до найбільшого */
  asc?: boolean;
  /** 'ua' — лише українські НП; 'abroad' — лише закордонні; не задано — всі разом. */
  country?: 'ua' | 'abroad';
}

/** Топ міст = сума балів із журналу PointEvent з фільтрами (період / стріми / напрямок). */
export async function leaderboard(
  db: PrismaClient,
  userId: string,
  filter: LbFilter = {},
): Promise<LeaderRow[]> {
  const { limit = 20, from, to, streamIds, collectionId, asc = false } = filter;

  const where: Prisma.PointEventWhereInput = { userId };
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
  if (streamIds) where.streamId = { in: streamIds };
  if (collectionId) where.collectionId = collectionId;
  if (filter.country === 'ua') where.settlement = { country: 'UA' };
  else if (filter.country === 'abroad') where.settlement = { country: { not: 'UA' } };

  const grouped = await db.pointEvent.groupBy({ by: ['settlementId'], where, _sum: { points: true } });
  if (grouped.length === 0) return [];

  const settlements = await db.settlement.findMany({
    where: { id: { in: grouped.map((g) => g.settlementId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(settlements.map((s) => [s.id, s.name]));

  const rows: LeaderRow[] = grouped.map((g) => ({
    settlementId: g.settlementId,
    name: nameById.get(g.settlementId) ?? g.settlementId,
    points: (g._sum.points ?? new Prisma.Decimal(0)).toNumber(),
  }));
  rows.sort((a, b) => (asc ? a.points - b.points : b.points - a.points));
  return rows.slice(0, limit);
}
