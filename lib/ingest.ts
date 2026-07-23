import type { PrismaClient } from '@prisma/client';
import { resolveCity } from './cityResolve';
import { applyDonation, type ApplyResult, type DonationInput } from './scoring';

export interface ProcessResult extends ApplyResult {
  settlementId: string | null;
}

/**
 * Обробка одного живого донату: розпізнати місто в коментарі (резолвер у БД) → застосувати бали
 * (через скарбничку), привʼязавши до активного стріму (якщо запущено).
 * Єдиний шлях інтейку донату — викликає вебхук monobank і будь-яке інше джерело.
 */
export async function processDonation(
  db: PrismaClient,
  userId: string,
  d: DonationInput,
): Promise<ProcessResult> {
  // Тумблер «битва міст» + опції закордону читаємо разом (один запит).
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { cityBattle: true, abroadCities: true, abroadHideAggressor: true },
  });
  const settlementId =
    (await resolveCity(db, d.message, {
      abroad: user?.abroadCities ?? false,
      hideAggressor: user?.abroadHideAggressor ?? false,
      userId, // приватні синоніми цього стрімера + спільні (мультитенант)
    }))?.settlementId ?? null;
  const awardPoints = user?.cityBattle ?? true;
  const active = await db.stream.findFirst({
    where: { userId, endedAt: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  // Активний збір ловить усі донати напряму — байдуже, йде стрім чи ні.
  const activeCol = await db.collection.findFirst({
    where: { userId, status: 'active' },
    select: { id: true },
  });
  const res = await applyDonation(db, userId, d, settlementId, active?.id ?? null, {
    awardPoints,
    collectionId: activeCol?.id ?? null,
  });
  return { ...res, settlementId };
}
