'use client';

import { useState } from 'react';

// Перемикач формату/глибини топу картинки-звіту (стрім або збір): показує прев'ю активної
// комбінації й дає завантажити PNG. Це «завантажити картинку» (не «копіювати силку») — файл
// під логіном, глядачеві лінк не відкриється (див. спеку §2/§13). basePath задає роут звіту
// (`/streams/<id>/report-image` чи `/collections/<id>/report-image`) — компонент спільний (DRY).
const FORMATS = [
  { key: 'landscape', label: 'Горизонт' },
  { key: 'square', label: 'Квадрат' },
  { key: 'vertical', label: 'Вертикаль' },
  { key: 'portrait', label: 'Портрет' },
] as const;

type FormatKey = (typeof FORMATS)[number]['key'];

// Скільки назв міст підписати на мапі (0 — без назв).
const LABELS = [
  { v: 0, label: 'Без назв' },
  { v: 3, label: '3 назви' },
  { v: 10, label: '10 назв' },
] as const;

export function ReportExport({ basePath }: { basePath: string }) {
  const [format, setFormat] = useState<FormatKey>('landscape');
  const [top, setTop] = useState<5 | 10>(5);
  const [labels, setLabels] = useState<0 | 3 | 10>(3);
  // Лічильник для примусового перерендеру: браузер кешує <img> за URL, тож при незмінних
  // налаштуваннях прев'ю не оновилось би після нових донатів/зміни міста. Кнопка «Оновити» додає
  // &v=N — новий URL змушує стягнути свіжий рендер (роут force-dynamic, дані завжди актуальні).
  const [nonce, setNonce] = useState(0);
  const base = `${basePath}?format=${format}&top=${top}&labels=${labels}${nonce ? `&v=${nonce}` : ''}`;

  return (
    <div className="report-export">
      <div className="col-title">🖼 Картинка звіту</div>
      <div className="re-tabs">
        {FORMATS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`re-tab${format === f.key ? ' on' : ''}`}
            onClick={() => setFormat(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="re-tabs">
        {([5, 10] as const).map((n) => (
          <button
            key={n}
            type="button"
            className={`re-tab${top === n ? ' on' : ''}`}
            onClick={() => setTop(n)}
          >
            Топ-{n}
          </button>
        ))}
      </div>
      <div className="re-tabs">
        <span className="re-tab-lbl">Назви на мапі:</span>
        {LABELS.map((o) => (
          <button
            key={o.v}
            type="button"
            className={`re-tab${labels === o.v ? ' on' : ''}`}
            onClick={() => setLabels(o.v)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {/* key змушує <img> перезавантажитись при зміні комбінації (той самий елемент, новий src). */}
      <img key={base} className="re-preview" src={base} alt="Прев'ю картинки-звіту" />
      <div className="re-actions">
        <a className="btn-find re-download" href={`${base}&download=1`}>
          ⬇ Завантажити картинку
        </a>
        <button type="button" className="btn-soft re-refresh" onClick={() => setNonce((n) => n + 1)}>
          🔄 Оновити
        </button>
      </div>
    </div>
  );
}
