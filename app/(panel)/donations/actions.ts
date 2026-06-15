'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { moveDonationToStream } from '@/lib/streams';

// Тонкі Server Actions вкладки «Донати»: Zod-валідація → lib → ревалідація.

const MoveInput = z.object({
  externalId: z.string().min(1),
  // '' → без стріму (null); інакше — id стріму
  streamId: z.preprocess((v) => (v === '' ? null : v), z.string().min(1).nullable()),
});

/** Перенести донат в інший стрім (бали їдуть разом; '' → без стріму). */
export async function moveDonationAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const { externalId, streamId } = MoveInput.parse({
    externalId: formData.get('externalId'),
    streamId: formData.get('streamId'),
  });
  const moved = await moveDonationToStream(prisma, U, externalId, streamId);
  if (!moved) {
    // Не приховуємо провал: нормальним UI-шляхом недосяжно (донат і стрім беруться з
    // відрендереної сторінки під тим самим userId) — false означає застарілий список
    // або стрім, видалений в іншій вкладці. Дані не змінились → ревалідувати нічого.
    console.error('[moveDonationAction] донат або стрім не знайдено', { userId: U, externalId, streamId });
    return;
  }
  // бали міняють приналежність стрімам → впливає на топ стрімів/збори; шапка теж читає стрім
  revalidatePath('/', 'layout');
}
