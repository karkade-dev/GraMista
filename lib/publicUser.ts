import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

// Резолв стрімера для контекстів без сесії: оверлеї (capability-токен overlayKey) і публічна
// сторінка §18 (handle). Невідомий ключ → null (порожньо/404). Лише публічні дані.
export async function userIdByOverlayKey(db: PrismaClient, key: string): Promise<string | null> {
  if (!key) return null;
  const u = await db.user.findUnique({ where: { overlayKey: key }, select: { id: true } });
  return u?.id ?? null;
}

export async function userIdByHandle(db: PrismaClient, handle: string): Promise<string | null> {
  if (!handle) return null;
  const u = await db.user.findUnique({ where: { handle }, select: { id: true } });
  return u?.id ?? null;
}

export function generateOverlayKey(): string {
  return randomBytes(24).toString('base64url');
}

// Ліниво гарантує overlayKey (перше відкриття /settings чи конструктора оверлеїв).
export async function ensureOverlayKey(db: PrismaClient, userId: string): Promise<string> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { overlayKey: true } });
  if (u?.overlayKey) return u.overlayKey;
  const overlayKey = generateOverlayKey();
  await db.user.update({ where: { id: userId }, data: { overlayKey } });
  return overlayKey;
}

// Перегенерація (revoke старих силок) — кнопка в /settings.
export async function regenerateOverlayKey(db: PrismaClient, userId: string): Promise<string> {
  const overlayKey = generateOverlayKey();
  await db.user.update({ where: { id: userId }, data: { overlayKey } });
  return overlayKey;
}

// — Донат-док (/dock): окремий capability-ключ, дзеркало overlayKey. Окремий від overlayKey,
// бо док показує повні імена + сирі коментарі (PII), а overlayKey — «лише публічні дані». —

export async function userIdByDockKey(db: PrismaClient, key: string): Promise<string | null> {
  if (!key) return null;
  const u = await db.user.findUnique({ where: { dockKey: key }, select: { id: true } });
  return u?.id ?? null;
}

export async function ensureDockKey(db: PrismaClient, userId: string): Promise<string> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { dockKey: true } });
  if (u?.dockKey) return u.dockKey;
  const dockKey = generateOverlayKey();
  await db.user.update({ where: { id: userId }, data: { dockKey } });
  return dockKey;
}

export async function regenerateDockKey(db: PrismaClient, userId: string): Promise<string> {
  const dockKey = generateOverlayKey();
  await db.user.update({ where: { id: userId }, data: { dockKey } });
  return dockKey;
}
