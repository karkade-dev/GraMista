'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { assignCity, assignCityBulk, reassignCity, adjustPoints, resetCity, resetAll, setDonationOutOfGame } from '@/lib/admin';
import { addAlias } from '@/lib/settlements';
import { undoAdminAction } from '@/lib/adminLog';
import { notifyDonation, notifyRefresh } from '@/lib/notify';

// Тонкі Server Actions Адмінки (§17.5): Zod-валідація → lib/admin → ревалідація.
// Дії змінюють бали → впливають на дашборд/мапу/топ, тож ревалідуємо весь layout.
// revalidatePath оновлює лише власну вкладку стрімера; оверлеї/публічна/док живуть на SSE,
// тож після зміни балів ще й будимо шину (notifyDonation/notifyRefresh) — інакше місто
// з'являється в топі, але не «висвічується» на живій мапі.

const AssignInput = z.object({ externalId: z.string().min(1), settlementId: z.string().min(1) });

/** Призначити місто нерозпізнаному донату → донарахувати бали (та сама логіка, що й у живого донату). */
export async function assignCityAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { externalId, settlementId } = AssignInput.parse({
    externalId: formData.get('externalId'),
    settlementId: formData.get('settlementId'),
  });
  await assignCity(prisma, U, externalId, settlementId);
  revalidatePath('/', 'layout');
  await notifyDonation(prisma, U, externalId); // спалах + поява міста на живій мапі
}

const ReassignInput = z.object({ externalId: z.string().min(1), settlementId: z.string().min(1) });

/** Змінити місто ВЖЕ розпізнаному донату → перерахувати бали обох міст (replay, поріг враховано). */
export async function reassignCityAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { externalId, settlementId } = ReassignInput.parse({
    externalId: formData.get('externalId'),
    settlementId: formData.get('settlementId'),
  });
  await reassignCity(prisma, U, externalId, settlementId);
  revalidatePath('/', 'layout');
  await notifyDonation(prisma, U, externalId); // спалах нового міста; старе оновиться на refresh
}

const SetGameInput = z.object({ externalId: z.string().min(1), out: z.enum(['true', 'false']) });

/** Вивести донат з гри / повернути в гру (поштучно). Перераховує бали + ховає/показує глядачам наживо. */
export async function setDonationGameAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { externalId, out } = SetGameInput.parse({
    externalId: formData.get('externalId'),
    out: formData.get('out'),
  });
  await setDonationOutOfGame(prisma, U, externalId, out === 'true');
  revalidatePath('/', 'layout');
  await notifyDonation(prisma, U, externalId); // спалах гасне/зʼявляється, стрічка/сума глядачів оновлюються
}

const RememberInput = z.object({ settlementId: z.string().min(1), alias: z.string().trim().min(1).max(64) });

/**
 * Запам'ятати написання з коментаря як ПРИВАТНИЙ синонім міста (клік по слову в стрічці/доку).
 * Кличе addAlias (приватний для стрімера, журналюється з відкатом). Без revalidatePath — синонім
 * впливає на МАЙБУТНІ донати (resolveCity читає БД наживо), поточні екрани не змінюються.
 */
export async function rememberSpellingAction(settlementId: string, alias: string): Promise<{ ok: boolean }> {
  const U = await requireUserId();
  const parsed = RememberInput.safeParse({ settlementId, alias });
  if (!parsed.success) return { ok: false };
  const res = await addAlias(prisma, U, parsed.data.settlementId, parsed.data.alias);
  return { ok: res !== null };
}

const BulkAssignInput = z.object({
  externalIds: z.array(z.string().min(1)).min(1, 'Оберіть хоча б один донат'),
  settlementId: z.string().min(1),
});

/** Масово призначити одне місто обраним нерозпізнаним донатам. */
export async function bulkAssignCityAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { externalIds, settlementId } = BulkAssignInput.parse({
    externalIds: formData.getAll('externalIds'),
    settlementId: formData.get('settlementId'),
  });
  await assignCityBulk(prisma, U, externalIds, settlementId);
  revalidatePath('/', 'layout');
  await notifyRefresh(prisma, U); // пакетна дія: міста з'являються на мапі без спалаху кожного
}

const AdjustInput = z.object({
  settlementId: z.string().min(1),
  points: z.coerce.number().refine((n) => Number.isFinite(n) && n !== 0, 'Потрібне ненульове число'),
});

/** Ручне коригування балів міста (може бути від'ємним). */
export async function adjustPointsAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { settlementId, points } = AdjustInput.parse({
    settlementId: formData.get('settlementId'),
    points: formData.get('points'),
  });
  await adjustPoints(prisma, U, settlementId, points);
  revalidatePath('/', 'layout');
  await notifyRefresh(prisma, U); // змінились бали міста → мапа/топ оновлюються наживо
}

const AliasInput = z.object({
  settlementId: z.string().min(1),
  alias: z.string().trim().min(2, 'Синонім закороткий').max(64),
});

/** Додати ПРИВАТНИЙ синонім місту (видно лише цьому стрімеру; надалі його донати з цим написанням авто-розпізнаються — резолвер читає БД наживо). */
export async function addAliasAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { settlementId, alias } = AliasInput.parse({
    settlementId: formData.get('settlementId'),
    alias: formData.get('alias'),
  });
  await addAlias(prisma, U, settlementId, alias);
  revalidatePath('/admin');
}

const ResetCityInput = z.object({ settlementId: z.string().min(1) });

/** Скинути бали + скарбнички одного міста (історія донатів лишається). */
export async function resetCityAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { settlementId } = ResetCityInput.parse({ settlementId: formData.get('settlementId') });
  await resetCity(prisma, U, settlementId);
  revalidatePath('/', 'layout');
  await notifyRefresh(prisma, U); // місто зникає з мапи/топу наживо
}

/** Скинути ВСІ бали + скарбнички (історія донатів і стріми лишаються). */
export async function resetAllAction(): Promise<void> {
  const U = await requireUserId();
  await resetAll(prisma, U);
  revalidatePath('/', 'layout');
  await notifyRefresh(prisma, U); // мапа/топ очищаються наживо
}

const UndoInput = z.object({ id: z.string().min(1) });

/** Відкотити дію з журналу (оборотну) — зворотна операція + позначка undoneAt. */
export async function undoActionAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { id } = UndoInput.parse({ id: formData.get('id') });
  await undoAdminAction(prisma, U, id);
  revalidatePath('/', 'layout');
  await notifyRefresh(prisma, U); // відкат міг змінити бали → мапа/топ оновлюються наживо
}
