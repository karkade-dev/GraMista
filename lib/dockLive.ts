import { REFRESH_EVENT_ID } from './notify';

// Чиста логіка лічильника «↑ N нових» доку (сторінки ≥2). БЕЗ Prisma — імпортується
// клієнтським DockLive. Каналом SSE ідуть не лише нові донати: службові __refresh__
// (перемкнувся збір, пакетні дії адмінки) і повторні події того самого донату
// (assign/reassign/поза-грою). Рахуємо подію новим донатом лише коли в payload є
// справжній externalId, який ще не бачили в цій сесії.
export function countAsNewDonation(rawData: string, seen: Set<string>): boolean {
  let externalId: unknown;
  try {
    externalId = (JSON.parse(rawData) as { externalId?: unknown }).externalId;
  } catch {
    return false; // не-JSON у каналі — не донат
  }
  if (typeof externalId !== 'string' || !externalId || externalId === REFRESH_EVENT_ID) return false;
  if (seen.has(externalId)) return false;
  seen.add(externalId);
  return true;
}
