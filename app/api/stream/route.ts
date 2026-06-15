import { prisma } from '@/lib/db';
import { donationFlashShared } from '@/lib/map';
import { userIdByOverlayKey, userIdByHandle, userIdByDockKey } from '@/lib/publicUser';
import { getUserId } from '@/lib/session';
import { parseDonationNotify } from '@/lib/notify';
import { normalizeHandle } from '@/lib/handle';
import { subscribe, type Unsubscribe } from '@/lib/donationBus';
import { bustPublicPage } from '@/lib/publicPage';

// Потокова відповідь — без кешу й статичної генерації; потрібен Node-рантайм (pg тримає TCP).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// SSE-канал живого оновлення: спільна шина donationBus (один LISTEN на процес) роздає
// NOTIFY-payload "<userId>:<externalId>" усім запитам; кожен фільтрує свій скоуп.
// Скоуп: ?k=<overlayKey> (оверлеї) · ?d=<dockKey> (донат-док) · ?h=<handle> (публічна
// сторінка) · ?g=1 (глобальна мапа /ukraine — донати ВСІХ учасників) · cookie-сесія (панель).
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const key = params.get('k') ?? '';
  const dockKey = params.get('d') ?? '';
  const pubHandle = normalizeHandle(params.get('h') ?? '');
  const global = params.get('g') === '1';
  const U = global
    ? null
    : key
      ? await userIdByOverlayKey(prisma, key)
      : dockKey
        ? await userIdByDockKey(prisma, dockKey)
        : pubHandle
          ? await userIdByHandle(prisma, pubHandle)
          : await getUserId();
  if (!global && !U) return new Response('unauthorized', { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: Unsubscribe | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const cleanup = async () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (unsubscribe) {
          const u = unsubscribe;
          unsubscribe = null;
          await u();
        }
      };

      // Коментар одразу відкриває потік (браузер не чекає першого байта).
      controller.enqueue(encoder.encode(': connected\n\n'));

      try {
        unsubscribe = await subscribe(async (payload) => {
          const parsed = parseDonationNotify(payload);
          if (!parsed) return;
          if (global) {
            // Глобальний канал: пропускаємо донати БУДЬ-ЯКОГО учасника мапи (донати — рідкі
            // події, один findUnique на подію дешевший за кешування списку учасників).
            const owner = await prisma.user.findUnique({ where: { id: parsed.userId }, select: { showOnGlobalMap: true, hiddenFromGlobalMap: true } });
            if (!owner?.showOnGlobalMap || owner.hiddenFromGlobalMap) return;
          } else if (parsed.userId !== U) {
            return; // не свій стрімер
          }
          // Донат стрімера публічної сторінки → скинути її TTL-кеш ДО router.refresh()
          // глядачів (дебаунс 250мс дає запас) — refresh уже бачить свіжі дані.
          if (pubHandle) bustPublicPage(pubHandle);
          const externalId = parsed.externalId;
          // Збагачуємо подію містом+сумою (для «спалаху» на мапі); null — якщо
          // донат нерозпізнаний/без координат. У не-глобальному каналі parsed.userId === U.
          // Shared-варіант: підписники того самого донату ділять ОДИН запит (не N).
          let flash = null;
          try {
            flash = await donationFlashShared(prisma, parsed.userId, externalId);
          } catch (e) {
            console.error('[stream] donationFlash:', (e as Error).message);
          }
          // Дефолтна подія (без event:) → ловиться через EventSource.onmessage.
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ externalId, flash })}\n\n`));
          } catch {
            void cleanup(); // потік уже закрито (клієнт відпав під час лукапу)
          }
        });
      } catch (e) {
        await cleanup();
        controller.error(e);
        return;
      }

      // Heartbeat-коментар — щоб проксі/браузер не рвали ідл-з'єднання.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          void cleanup();
        }
      }, 25_000);

      // Розрив з боку клієнта (навігація/F5/закрита вкладка) — прибрати ресурси.
      request.signal.addEventListener('abort', () => {
        void cleanup();
      });
    },
    async cancel() {
      // Споживач потоку скасував читання — теж прибираємо (ідемпотентно з abort вище).
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (unsubscribe) {
        const u = unsubscribe;
        unsubscribe = null;
        await u();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
