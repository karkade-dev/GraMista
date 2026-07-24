'use client';

import { useMemo, useState } from 'react';

// Коментар донату з навчанням синоніма: за замовчуванням — звичайний текст; на наведення тихо
// зʼявляється «запамʼятати написання». Клік → слова стають клікабельні → обираєш слово(а) →
// зберігаєш як ПРИВАТНИЙ синонім міста (rememberSpellingAction → addAlias). Показується лише коли
// донат уже має місто (settlementId): нерозпізнаному спершу призначають місто звичайним шляхом.
// Реюзається на дашборді, у вкладці «Донати» і в доку — єдине джерело цієї взаємодії.

type Action = (settlementId: string, alias: string) => Promise<{ ok: boolean }>;

// Слово = літери/цифри з апострофами й дефісами всередині («Нью-Йорк», «обʼєднані» — одне слово);
// решта (пробіли, пунктуація, емодзі) — роздільники, рендеряться як є й не клікабельні.
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’ʼ-]*|[^\p{L}\p{N}]+/gu;
const isWord = (s: string): boolean => /^[\p{L}\p{N}]/u.test(s);

export function TeachableComment({
  comment,
  settlementId,
  city,
  action,
  quote = false,
}: {
  comment: string;
  settlementId: string | null;
  city: string | null;
  action: Action;
  /** Обгорнути коментар у «лапки» (дашборд/док показують так). */
  quote?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const segs = useMemo(() => {
    const parts = comment.match(TOKEN) ?? [];
    let wi = 0;
    return parts.map((text) => ({ text, w: isWord(text) ? wi++ : -1 }));
  }, [comment]);

  // Нема міста (нерозпізнано) чи порожній коментар — звичайний текст, без навчання.
  if (!settlementId || !city || !comment) return <>{quote ? `«${comment}»` : comment}</>;

  const teachable = segs.some((s) => s.w >= 0);
  const selText = sel
    ? segs.filter((s) => s.w >= sel.start && s.w <= sel.end).map((s) => s.text).join(' ')
    : '';

  function pick(i: number): void {
    setSel((cur) => {
      if (!cur) return { start: i, end: i };
      if (i === cur.start - 1) return { start: i, end: cur.end };
      if (i === cur.end + 1) return { start: cur.start, end: i };
      if (i >= cur.start && i <= cur.end) return null;
      return { start: i, end: i };
    });
  }

  async function save(): Promise<void> {
    if (!sel || !settlementId) return;
    setSaving(true);
    const res = await action(settlementId, selText);
    setSaving(false);
    setSel(null);
    setActive(false);
    setFlash(res.ok ? `✓ запамʼятав «${selText}» — далі впізнається сам` : 'не вдалося зберегти');
    setTimeout(() => setFlash(null), 3500);
  }

  if (!active) {
    return (
      <span className="tc">
        {quote ? `«${comment}»` : comment}
        {teachable && (
          <button
            type="button"
            className="tc-trigger"
            onClick={() => setActive(true)}
            title="Запамʼятати написання міста з коментаря"
          >
            запамʼятати написання
          </button>
        )}
        {flash && <span className="tc-flash">{flash}</span>}
      </span>
    );
  }

  return (
    <span className="tc tc-on">
      <span className="tc-words">
        {quote && '«'}
        {segs.map((s, i) =>
          s.w >= 0 ? (
            <span
              key={i}
              className={'tc-w' + (sel && s.w >= sel.start && s.w <= sel.end ? ' picked' : '')}
              onClick={() => pick(s.w)}
            >
              {s.text}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
        {quote && '»'}
      </span>
      {sel ? (
        <span className="tc-confirm">
          Запамʼятати <b>«{selText}»</b> для <b>{city}</b>?
          <button type="button" className="tc-save" disabled={saving} onClick={save}>
            {saving ? '…' : 'запамʼятати'}
          </button>
          <button type="button" className="tc-x" onClick={() => setSel(null)} aria-label="скинути вибір">
            ×
          </button>
        </span>
      ) : (
        <span className="tc-confirm">
          клікни слово-місто в коментарі
          <button type="button" className="tc-x" onClick={() => setActive(false)} aria-label="закрити">
            ×
          </button>
        </span>
      )}
    </span>
  );
}
