'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Живе оновлення дашборду: слухає SSE-канал /api/stream і на кожен новий донат
// викликає router.refresh() — пере-рендер Server Component зі свіжими даними з lib/
// (топ/стрічка/мапа/лічильники), без повного перезавантаження сторінки.
// EventSource сам перепідключається, якщо з'єднання обірветься.
// channelKey (overlayKey) задається для оверлеїв у OBS, де нема cookie-сесії — щоб SSE
// знав, чий канал слухати. dockKey — те саме для донат-доку /dock. Панель лишає їх порожніми
// і скоупиться cookie-сесією.
export function LiveRefresh({ channelKey, dockKey, publicHandle, globalChannel }: { channelKey?: string; dockKey?: string; publicHandle?: string; globalChannel?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    // Оверлей → ?k=<overlayKey>; док → ?d=<dockKey>; публічна сторінка → ?h=<handle>;
    // глобальна мапа → ?g=1; панель — cookie-сесія.
    const url = channelKey
      ? `/api/stream?k=${encodeURIComponent(channelKey)}`
      : dockKey
        ? `/api/stream?d=${encodeURIComponent(dockKey)}`
        : publicHandle
          ? `/api/stream?h=${encodeURIComponent(publicHandle)}`
          : globalChannel
            ? '/api/stream?g=1'
            : '/api/stream';
    const es = new EventSource(url);

    // Дебаунс: серія донатів підряд дасть один refresh, а не молотіння сервера.
    let timer: ReturnType<typeof setTimeout> | null = null;
    es.onmessage = (e) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
      // «Спалах» міста на мапі — окремо від refresh (миттєво, без дебаунсу).
      // MapUkraine слухає цю подію; flash=null для нерозпізнаних донатів.
      try {
        const data = JSON.parse(e.data) as { flash?: unknown };
        if (data.flash) window.dispatchEvent(new CustomEvent('gramista:flash', { detail: data.flash }));
      } catch {
        // не-JSON (heartbeat сюди не доходить) — просто ігноруємо
      }
    };

    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [router, channelKey, dockKey, publicHandle, globalChannel]);

  return null;
}
