'use server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { fetchJars, setWebhook, MonoApiError } from '@/lib/monobank';
import { validateHandle } from '@/lib/handle';
import { regenerateOverlayKey, regenerateDockKey, userIdByHandle } from '@/lib/publicUser';
import { parseWordList } from '@/lib/censor';
import { BASE_BANNED } from '@/lib/censorWords';

// Тонкі Server Actions /settings: Zod-валідація → lib/Prisma → ревалідація. Невалідні дані
// (поганий/зайнятий слаг) тихо не зберігаються (MVP без тостів — борг).

const profileSchema = z.object({
  handle: z.string().optional(),
  monobankJarUrl: z.string().url().or(z.literal('')).optional(),
  twitchUrl: z.string().url().or(z.literal('')).optional(),
  youtubeUrl: z.string().url().or(z.literal('')).optional(),
  // Чекбокс HTML-форми: 'on' коли увімкнено, відсутній — коли ні.
  publicShowStreams: z.literal('on').optional(),
  showOnGlobalMap: z.literal('on').optional(),
  abroadCities: z.literal('on').optional(),
  abroadWorldMap: z.literal('on').optional(),
  abroadTopMode: z.enum(['shared', 'separate']).optional(),
  abroadHideAggressor: z.literal('on').optional(),
});

export async function saveProfileAction(formData: FormData): Promise<void> {
  const U = await requireUserId();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const data: {
    monobankJarUrl: string | null; twitchUrl: string | null; youtubeUrl: string | null;
    publicShowStreams: boolean; showOnGlobalMap: boolean;
    abroadCities: boolean; abroadWorldMap: boolean; abroadTopMode: string; abroadHideAggressor: boolean;
    handle?: string;
  } = {
    monobankJarUrl: parsed.data.monobankJarUrl || null,
    twitchUrl: parsed.data.twitchUrl || null,
    youtubeUrl: parsed.data.youtubeUrl || null,
    publicShowStreams: parsed.data.publicShowStreams === 'on',
    showOnGlobalMap: parsed.data.showOnGlobalMap === 'on',
    abroadCities: parsed.data.abroadCities === 'on',
    abroadWorldMap: parsed.data.abroadWorldMap === 'on',
    abroadTopMode: parsed.data.abroadTopMode ?? 'separate',
    abroadHideAggressor: parsed.data.abroadHideAggressor === 'on',
  };
  if (parsed.data.handle) {
    const v = validateHandle(parsed.data.handle);
    if (!v.ok) return;
    const owner = await userIdByHandle(prisma, v.handle);
    if (owner && owner !== U) return; // слаг уже зайнятий — не зберігаємо
    data.handle = v.handle;
  }
  await prisma.user.update({ where: { id: U }, data });
  revalidatePath('/settings');
}

// Налаштування показу/цензури коментарів — тонкі actions для миттєвого збереження
// (клік у клієнтському компоненті → одразу в БД, без кнопки «Зберегти»). Слова зберігаються
// нормалізованими (parseWordList) через ', '; жодного дублювання логіки матчингу.
const modeSchema = z.enum(['mask', 'replace', 'city', 'hide']);

export async function setCommentModeAction(mode: string): Promise<void> {
  const U = await requireUserId();
  const parsed = modeSchema.safeParse(mode);
  if (!parsed.success) return;
  await prisma.user.update({ where: { id: U }, data: { commentMode: parsed.data } });
  revalidatePath('/settings');
}

export async function setShowCommentPublicAction(show: boolean): Promise<void> {
  const U = await requireUserId();
  await prisma.user.update({ where: { id: U }, data: { showCommentPublic: show === true } });
  revalidatePath('/settings');
}

const wordSchema = z.string().trim().min(2).max(40);

/** Поточні нормалізовані списки користувача (added/allowed). */
async function loadWordLists(userId: string): Promise<{ added: string[]; allowed: string[] }> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { bannedWordsAdded: true, bannedWordsAllowed: true } });
  return { added: parseWordList(u?.bannedWordsAdded ?? ''), allowed: parseWordList(u?.bannedWordsAllowed ?? '') };
}

/** Додати власне заборонене слово (і прибрати його з винятків, якщо було там). */
export async function banWordAction(word: string): Promise<void> {
  const U = await requireUserId();
  const parsed = wordSchema.safeParse(word);
  if (!parsed.success) return;
  const [norm] = parseWordList(parsed.data);
  if (!norm) return; // вайлдкарди/занадто коротке після нормалізації
  const { added, allowed } = await loadWordLists(U);
  const nextAdded = added.includes(norm) ? added : [...added, norm];
  const nextAllowed = allowed.filter((w) => w !== norm);
  await prisma.user.update({
    where: { id: U },
    data: { bannedWordsAdded: nextAdded.join(', '), bannedWordsAllowed: nextAllowed.join(', ') },
  });
  revalidatePath('/settings');
}

/**
 * Прибрати слово зі списку заборонених: власне — видаляється з доданих;
 * вбудоване — переїжджає у винятки (бо вбудований список незмінний).
 */
export async function unbanWordAction(word: string): Promise<void> {
  const U = await requireUserId();
  const parsed = wordSchema.safeParse(word);
  if (!parsed.success) return;
  const [norm] = parseWordList(parsed.data);
  if (!norm) return;
  const { added, allowed } = await loadWordLists(U);
  if (added.includes(norm)) {
    await prisma.user.update({ where: { id: U }, data: { bannedWordsAdded: added.filter((w) => w !== norm).join(', ') } });
  } else if (BASE_BANNED.includes(norm)) {
    const nextAllowed = allowed.includes(norm) ? allowed : [...allowed, norm];
    await prisma.user.update({ where: { id: U }, data: { bannedWordsAllowed: nextAllowed.join(', ') } });
  }
  revalidatePath('/settings');
}

/** Повернути слово з винятків у цензуру (прибрати з allowed). */
export async function restoreWordAction(word: string): Promise<void> {
  const U = await requireUserId();
  const parsed = wordSchema.safeParse(word);
  if (!parsed.success) return;
  const [norm] = parseWordList(parsed.data);
  if (!norm) return;
  const { allowed } = await loadWordLists(U);
  await prisma.user.update({ where: { id: U }, data: { bannedWordsAllowed: allowed.filter((w) => w !== norm).join(', ') } });
  revalidatePath('/settings');
}

// Двокроковий конект банки. Токен існує лише в аргументах цих actions у межах
// одного запиту: НЕ зберігається, НЕ логується, НЕ повертається клієнту.
const tokenSchema = z.object({ token: z.string().trim().min(20, 'Схоже, це не токен monobank') });

export interface MonoConnectState {
  jars?: { id: string; title: string }[];
  ok?: boolean;
  error?: string;
}

export async function listMonoJarsAction(_prev: MonoConnectState, formData: FormData): Promise<MonoConnectState> {
  await requireUserId();
  const parsed = tokenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Невалідний токен' };
  try {
    const jars = await fetchJars(parsed.data.token);
    if (jars.length === 0) return { error: 'У цьому акаунті monobank немає банок' };
    return { jars: jars.map(({ id, title }) => ({ id, title })) };
  } catch (e) {
    return { error: e instanceof MonoApiError ? e.message : 'Не вдалося звернутись до monobank' };
  }
}

const connectSchema = z.object({
  token: z.string().trim().min(20),
  jarId: z.string().min(1),
  jarTitle: z.string().min(1),
});

export async function connectMonoJarAction(_prev: MonoConnectState, formData: FormData): Promise<MonoConnectState> {
  const U = await requireUserId();
  const parsed = connectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Невалідні дані форми' };
  const base = process.env.APP_BASE_URL;
  if (!base) return { error: 'APP_BASE_URL не налаштовано (адреса застосунку для вебхука)' };

  const webhookSecret = randomBytes(32).toString('base64url');
  try {
    await setWebhook(parsed.data.token, `${base.replace(/\/$/, '')}/api/mono/hook/${webhookSecret}`);
  } catch (e) {
    return { error: e instanceof MonoApiError ? e.message : 'Не вдалося поставити вебхук' };
  }

  const data = {
    monoAccountId: parsed.data.jarId,
    title: parsed.data.jarTitle,
    webhookSecret,
    status: 'active',
    lastEventAt: null,
  };
  const existing = await prisma.donationSource.findFirst({ where: { userId: U, type: 'monobank' } });
  if (existing) {
    await prisma.donationSource.update({ where: { id: existing.id }, data });
  } else {
    await prisma.donationSource.create({ data: { userId: U, type: 'monobank', ...data } });
  }
  revalidatePath('/settings');
  return { ok: true };
}

export async function disconnectMonoAction(): Promise<void> {
  const U = await requireUserId();
  // Вебхук на боці monobank лишається (зняти без токена неможливо) — події
  // тихо викидаються через status!=active; стрімер може перегенерувати токен у кабінеті.
  await prisma.donationSource.updateMany({ where: { userId: U, type: 'monobank' }, data: { status: 'inactive' } });
  revalidatePath('/settings');
}

export async function regenerateOverlayAction(): Promise<void> {
  const U = await requireUserId();
  await regenerateOverlayKey(prisma, U);
  revalidatePath('/settings');
  revalidatePath('/overlays');
}

export async function regenerateDockAction(): Promise<void> {
  const U = await requireUserId();
  await regenerateDockKey(prisma, U);
  revalidatePath('/settings');
  revalidatePath('/overlays');
}
