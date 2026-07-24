import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { buildStreamReportData } from '@/lib/reportData';
import { renderReportImage } from '@/app/og/reportImage';

// Картинка-звіт стріму — PNG через next/og. nodejs-рантайм (читаємо шрифт із диска).
// Параметри: format (співвідношення), top (глибина топу), download (віддати як файл).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Валідація query до бізнес-логіки (Zod). Некоректні/відсутні format|top|labels → дефолти
// (горизонт / топ-5 / 3 назви на мапі) через .catch, щоб прев'ю не ламалось на руками зміненому URL.
const Query = z.object({
  format: z.enum(['landscape', 'square', 'vertical', 'portrait']).catch('landscape'),
  top: z.coerce.number().pipe(z.union([z.literal(5), z.literal(10)])).catch(5),
  labels: z.coerce.number().pipe(z.union([z.literal(0), z.literal(3), z.literal(10)])).catch(3),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const U = await requireUserId();
  const { id } = await params;

  const sp = new URL(req.url).searchParams;
  const { format, top, labels } = Query.parse(Object.fromEntries(sp)); // .catch → parse не кидає
  const download = sp.get('download') === '1'; // файл віддаємо лише на явне ?download=1

  const data = await buildStreamReportData(prisma, U, id, top);
  if (!data) return new Response('Стрім не знайдено', { status: 404 });

  const res = await renderReportImage(data, { format, topN: top, labelsN: labels });
  if (!download) return res;

  // Завантаження: той самий PNG, але з Content-Disposition, щоб браузер зберіг файл.
  const buf = await res.arrayBuffer();
  return new Response(buf, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="stream-${id}-${format}.png"`,
    },
  });
}
