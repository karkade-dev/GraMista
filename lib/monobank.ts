import { z } from 'zod';

// Персональний API monobank. Токен стрімера НЕ зберігається ніде (zero token
// storage — docs/specs/2026-06-11-monobank-zero-token-research.md): він живе лише
// як аргумент цих функцій у межах одного запиту і не потрапляє в логи/БД/відповіді.
const API = 'https://api.monobank.ua';

const clientInfoSchema = z.object({
  jars: z.array(z.object({
    id: z.string(),
    sendId: z.string(),
    title: z.string(),
    balance: z.number(),
  })).optional(),
});

export interface MonoJar {
  id: string;
  sendId: string;
  title: string;
  balanceUah: number;
}

/**
 * Публічне посилання «задонатити» банки з її sendId (єдине місце, де знається формат).
 * monobank віддає sendId уже з сегментом `jar/` (напр. `jar/AaiGcJQA8N`), тож БАЗУ додаємо
 * без `jar/`, інакше вийде `.../jar/jar/...`. Захищаємось від зайвого слеша / повного URL.
 */
export function jarUrlFromSendId(sendId: string): string {
  const id = sendId.trim().replace(/^https?:\/\/send\.monobank\.ua\//i, '').replace(/^\/+/, '');
  return `https://send.monobank.ua/${id}`;
}

export class MonoApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function monoFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'X-Token': token },
  });
  if (res.status === 401 || res.status === 403) throw new MonoApiError('Невалідний токен', res.status);
  if (res.status === 429) throw new MonoApiError('Забагато запитів до monobank — зачекай хвилину', 429);
  if (!res.ok) throw new MonoApiError(`monobank: HTTP ${res.status}`, res.status);
  return res;
}

/** Банки клієнта (client-info; ліміт monobank — 1 виклик на 60 с). */
export async function fetchJars(token: string): Promise<MonoJar[]> {
  const res = await monoFetch('/personal/client-info', token);
  const info = clientInfoSchema.parse(await res.json());
  return (info.jars ?? []).map((j) => ({ id: j.id, sendId: j.sendId, title: j.title, balanceUah: j.balance / 100 }));
}

/** Реєструє вебхук; monobank одразу валідує URL GET-запитом (має віддати 200). */
export async function setWebhook(token: string, webHookUrl: string): Promise<void> {
  await monoFetch('/personal/webhook', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webHookUrl }),
  });
}
