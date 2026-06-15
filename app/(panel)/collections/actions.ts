'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { notifyRefresh } from '@/lib/notify';
import {
  createCollection,
  updateCollection,
  deleteCollection,
  activateCollection,
  pauseCollection,
  completeCollection,
  moveDonationToCollection,
} from '@/lib/collections';

// Тонкі Server Actions для вкладки «Збори»: Zod-валідація → lib/collections → ревалідація.
// Будимо SSE-слухачів стрімера (оверлеї/публічна/док) спільним notifyRefresh — перемкнувся збір.

const emptyToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);
const optDate = z.preprocess(emptyToUndef, z.coerce.date().optional());
// Стартова сума («Вже зібрано»): порожнє поле = 0 (нема стартової суми).
const seedField = z.preprocess((v) => (v === '' || v == null ? 0 : v), z.coerce.number().min(0).max(1_000_000_000));

const CreateInput = z.object({
  name: z.string().trim().min(1, 'Потрібна назва').max(120),
  // Ціль необов'язкова — порожнє поле = збір-змагання без грошової цілі.
  goalUah: z.preprocess(emptyToUndef, z.coerce.number().positive().max(1_000_000_000).optional()),
  seedUah: seedField,
  endAt: optDate,
});

/** Створити збір (на паузі — активують окремою кнопкою). */
export async function createCollectionAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { name, goalUah, endAt, seedUah } = CreateInput.parse({
    name: formData.get('name'),
    goalUah: formData.get('goalUah'),
    seedUah: formData.get('seedUah'),
    endAt: formData.get('endAt'),
  });
  await createCollection(prisma, U, { name, goalUah: goalUah ?? null, seedUah, ...(endAt ? { endAt } : {}) });
  revalidatePath('/collections');
  revalidatePath('/', 'layout'); // плашка прогресу збору в спільній шапці
}

const UpdateInput = z.object({
  id: z.string().min(1),
  name: z.preprocess(emptyToUndef, z.string().trim().max(120).optional()),
  goalUah: z.preprocess(emptyToUndef, z.coerce.number().positive().max(1_000_000_000).optional()),
  seedUah: seedField,
  endAt: optDate,
});

/** Редагувати збір: назва / ціль / стартова сума / дата кінця. Порожнє поле цілі = прибрати ціль. */
export async function updateCollectionAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { id, name, goalUah, endAt, seedUah } = UpdateInput.parse({
    id: formData.get('id'),
    name: formData.get('name'),
    goalUah: formData.get('goalUah'),
    seedUah: formData.get('seedUah'),
    endAt: formData.get('endAt'),
  });
  await updateCollection(prisma, U, id, {
    ...(name != null ? { name } : {}),
    goalUah: goalUah ?? null,
    seedUah,
    ...(endAt != null ? { endAt } : {}),
  });
  revalidatePath('/collections');
  revalidatePath('/', 'layout'); // плашка прогресу збору в спільній шапці
}

const StatusInput = z.object({
  id: z.string().min(1),
  status: z.enum(['active', 'paused', 'completed']),
});

/** Активувати / поставити на паузу / завершити збір (кнопка надсилає бажаний новий статус). */
export async function setCollectionStatusAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { id, status } = StatusInput.parse({ id: formData.get('id'), status: formData.get('status') });
  if (status === 'active') await activateCollection(prisma, U, id);
  else if (status === 'paused') await pauseCollection(prisma, U, id);
  else await completeCollection(prisma, U, id);
  revalidatePath('/collections');
  revalidatePath('/', 'layout'); // зміна активного збору змінює плашку в шапці
  await notifyRefresh(prisma, U); // оверлеї/публічна перемикаються без F5
}

const MoveInput = z.object({
  externalId: z.string().min(1),
  collectionId: z.preprocess((v) => (v === '' ? null : v), z.string().nullable()),
});

/** Зарахувати донат у збір (або прибрати зі збору) — зі стрічки дашборду. */
export async function moveDonationToCollectionAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { externalId, collectionId } = MoveInput.parse({
    externalId: formData.get('externalId'),
    collectionId: formData.get('collectionId'),
  });
  await moveDonationToCollection(prisma, U, externalId, collectionId);
  revalidatePath('/dashboard');
  revalidatePath('/collections');
  revalidatePath('/dock'); // дію можна викликати з доку — інакше сам док не оновиться після перенесення
  await notifyRefresh(prisma, U); // оверлеї/публічна оновлюють топ/суму без F5
}

const DeleteInput = z.object({ id: z.string().min(1) });

/** Видалити збір: стріми лишаються, лише відв'язуються. */
export async function deleteCollectionAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { id } = DeleteInput.parse({ id: formData.get('id') });
  await deleteCollection(prisma, U, id);
  revalidatePath('/collections');
  revalidatePath('/', 'layout'); // видалення активного збору прибирає плашку в шапці
  redirect('/collections');
}
