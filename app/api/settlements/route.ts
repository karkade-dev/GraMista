import { prisma } from '@/lib/db';
import { searchSettlements } from '@/lib/settlements';
import { getUserId } from '@/lib/session';

// Автодоповнення міст для Адмінки (§17.5): спільний довідник + приватні синоніми цього стрімера
// (мультитенант). Без сесії — лише спільні.
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const userId = await getUserId();
  // 25 (а не 8): у назв-тезок десятки однойменних НП — менший ліміт ховав потрібний (напр.
  // Рокитне-Київська, Микільське-Сумська з population=null). Підказка області у запиті ще звужує.
  const results = await searchSettlements(prisma, q, 25, userId ?? undefined);
  return Response.json(results, { headers: { 'Cache-Control': 'no-store' } });
}
