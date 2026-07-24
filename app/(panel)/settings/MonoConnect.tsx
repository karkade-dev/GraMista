'use client';
import { useActionState, useEffect, useState } from 'react';
import { listMonoJarsAction, connectMonoJarAction, type MonoConnectState } from './actions';

const EMPTY: MonoConnectState = {};

export function MonoConnect({ connected, title }: { connected: boolean; title: string | null }) {
  const [token, setToken] = useState('');
  const [jar, setJar] = useState<{ id: string; sendId: string; title: string } | null>(null);
  const [listState, listJars, listing] = useActionState(listMonoJarsAction, EMPTY);
  const [connectState, connectJar, connecting] = useActionState(connectMonoJarAction, EMPTY);

  // Після успіху токен більше не потрібен — прибираємо його зі state/DOM одразу,
  // щоб він не висів у пам'яті сторінки до перезавантаження.
  useEffect(() => {
    if (connectState.ok) setToken('');
  }, [connectState.ok]);

  if (connectState.ok) {
    return <p>Банку «{jar?.title}» підключено. Токен використано разово й не збережено.</p>;
  }

  return (
    <div>
      <p>Статус: <strong>{connected ? `підключено${title ? ` («${title}»)` : ''}` : 'не підключено'}</strong></p>

      {!listState.jars && (
        <form action={listJars}>
          <input
            type="password"
            name="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="токен з api.monobank.ua"
            autoComplete="off"
            required
          />
          <button type="submit" disabled={listing}>{listing ? 'Перевіряємо…' : 'Далі'}</button>
          <small>
            Токен — на <a href="https://api.monobank.ua" target="_blank" rel="noreferrer">api.monobank.ua</a>.
            Ми НЕ зберігаємо токен: він використовується один раз, щоб вибрати банку й налаштувати
            сповіщення, і одразу знищується.
          </small>
        </form>
      )}

      {listState.jars && (
        <form action={connectJar}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="jarId" value={jar?.id ?? ''} />
          <input type="hidden" name="sendId" value={jar?.sendId ?? ''} />
          <input type="hidden" name="jarTitle" value={jar?.title ?? ''} />
          <div className="set-group">
            {listState.jars.map((j) => (
              <label key={j.id} className="set-row">
                <input type="radio" name="jarPick" checked={jar?.id === j.id} onChange={() => setJar(j)} /> {j.title}
              </label>
            ))}
          </div>
          <button type="submit" disabled={!jar || connecting}>
            {connecting ? 'Підключаємо…' : 'Підключити цю банку'}
          </button>
          <small>Підключення замінить вебхук інших сервісів (Дяка тощо), якщо вони були.</small>
        </form>
      )}

      {(listState.error || connectState.error) && <p role="alert">{listState.error ?? connectState.error}</p>}
    </div>
  );
}
