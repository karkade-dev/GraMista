import type { PrismaClient } from '@prisma/client';

// Шина NOTIFY веб↔воркер. Payload = "<userId>:<externalId>" — щоб SSE-слухач відбирав лише
// донати свого стрімера (мультитенант). userId — cuid (без ':'), тож ділимо по ПЕРШІЙ ':'.
export function encodeDonationNotify(userId: string, externalId: string): string {
  return `${userId}:${externalId}`;
}

export function parseDonationNotify(payload: string): { userId: string; externalId: string } | null {
  const i = payload.indexOf(':');
  if (i <= 0 || i === payload.length - 1) return null;
  return { userId: payload.slice(0, i), externalId: payload.slice(i + 1) };
}

/** Службова «подія без донату»: будить SSE-слухачів стрімера (перемкнувся активний збір тощо). */
export const REFRESH_EVENT_ID = '__refresh__';

/**
 * Будить SSE-слухачів стрімера живою подією донату → оверлеї/публічна/док/глобальна оновлюють
 * топ і мапу без F5, а MapUkraine «висвічує» місто (спалах за externalId). Єдине джерело істини
 * для pg_notify — і вебхук, і ручні дії адмінки шлють подію цим хелпером (не дублюючи SQL).
 */
export async function notifyDonation(
  db: PrismaClient,
  userId: string,
  externalId: string,
): Promise<void> {
  await db.$executeRaw`SELECT pg_notify('donation', ${encodeDonationNotify(userId, externalId)})`;
}

/** Те саме, але службовою подією без конкретного донату: лише refresh, без спалаху міста. */
export async function notifyRefresh(db: PrismaClient, userId: string): Promise<void> {
  await notifyDonation(db, userId, REFRESH_EVENT_ID);
}
