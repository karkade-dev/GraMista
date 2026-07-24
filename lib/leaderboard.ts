import { Prisma, type PrismaClient } from '@prisma/client';

export interface LeaderRow {
  settlementId: string;
  name: string;
  points: number;
}

export interface LbFilter {
  /** null — без обмеження (повний список міст); за замовчуванням 20. */
  limit?: number | null;
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
  // Порядок при рівних балах мусить бути стабільним: groupBy повертає групи невпорядковано,
  // тож без детермінованого тай-брейку той самий стан давав би різний ранг на картинці-звіті,
  // у тексті й на оверлеї. Спершу за назвою (укр. локаль), далі за settlementId.
  rows.sort((a, b) => {
    const byPoints = asc ? a.points - b.points : b.points - a.points;
    if (byPoints !== 0) return byPoints;
    const byName = a.name.localeCompare(b.name, 'uk');
    return byName !== 0 ? byName : a.settlementId.localeCompare(b.settlementId);
  });
  return limit == null ? rows : rows.slice(0, limit);
}
