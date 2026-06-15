import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { processDonation } from './ingest';
import { notifyDonation } from './notify';

// Вебхук персонального API monobank НЕ підписаний — автентичність тримається на
// секретному URL (capability), цілість — на фільтрах нижче + ідемпотентності
// (userId, externalId). Див. docs/specs/2026-06-11-monobank-zero-token-research.md.
const eventSchema = z.object({
  type: z.literal('StatementItem'),
  data: z.object({
    account: z.string(),
    statementItem: z.object({
      id: z.string(),
      time: z.number(),
      description: z.string().optional(),
      comment: z.string().optional(),
      amount: z.number(),
      currencyCode: z.number(),
      counterName: z.string().optional(),
    }),
  }),
});

export type MonoHookResult = 'processed' | 'skipped';

export interface MonoSource {
  id: string;
  userId: string;
  monoAccountId: string | null;
}

/**
 * Джерело за секретом вебхука — лише активне. null (→ вебхук-роут відповідає 404)
 * для невідомого секрету чи відключеного джерела: три не-200 поспіль змушують
 * monobank вимкнути вебхук, і банк перестає слати рухи рахунків на наш сервер.
 */
export async function findActiveMonoSource(
  db: PrismaClient,
  secret: string,
): Promise<MonoSource | null> {
  const source = await db.donationSource.findUnique({
    where: { webhookSecret: secret },
    select: { id: true, userId: true, monoAccountId: true, status: true },
  });
  if (!source || source.status !== 'active') return null;
  return { id: source.id, userId: source.userId, monoAccountId: source.monoAccountId };
}

/** Поріг тиші підключення: довше — показуємо стрімеру банер «перепідключи банку». */
const SILENCE_THRESHOLD_DAYS = 7;

/**
 * Скільки днів від банку не було подій (від lastEventAt, а до першої події — від
 * createdAt джерела). null — тиша коротша за поріг. Це евристика: вебхук міг бути
 * вимкнений monobank після збою доставки, а API-сигналу про це нема (zero token storage).
 */
export function monoSilentDays(
  source: { lastEventAt: Date | null; createdAt: Date },
  now: Date,
): number | null {
  const since = source.lastEventAt ?? source.createdAt;
  const days = Math.floor((now.getTime() - since.getTime()) / (24 * 60 * 60 * 1000));
  return days >= SILENCE_THRESHOLD_DAYS ? days : null;
}

function donorNameFrom(item: { counterName?: string; description?: string }): string {
  if (item.counterName) return item.counterName;
  const d = item.description ?? '';
  if (d.startsWith('Від: ')) return d.slice('Від: '.length).trim() || 'Невідомо';
  return 'Невідомо';
}

/**
 * Одна подія вебхука → донат через спільний конвеєр processDonation + pg_notify.
 * Події не з обраної банки викидаються ДО будь-якого запису й логування:
 * вебхук шле рухи по всіх рахунках клієнта, особисті транзакції стрімера
 * не повинні торкатися БД.
 */
export async function handleMonoEvent(
  db: PrismaClient,
  source: MonoSource,
  payload: unknown,
): Promise<MonoHookResult> {
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) return 'skipped';
  const { account, statementItem: item } = parsed.data.data;
  if (!source.monoAccountId || account !== source.monoAccountId) return 'skipped';
  if (item.amount <= 0 || item.currencyCode !== 980) return 'skipped';

  await processDonation(db, source.userId, {
    externalId: item.id,
    donorName: donorNameFrom(item),
    amountUah: item.amount / 100,
    message: item.comment ?? '',
    sourceId: source.id,
  });
  await db.donationSource.update({ where: { id: source.id }, data: { lastEventAt: new Date() } });
  await notifyDonation(db, source.userId, item.id);
  return 'processed';
}
