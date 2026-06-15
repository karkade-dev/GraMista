import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { listCollections, collectionReportText, type CollectionRow } from '@/lib/collections';
import { formatUah, formatDate, formatPoints } from '@/lib/format';
import { ConfirmSubmit } from '@/app/ConfirmSubmit';
import { CopyButton } from '@/app/CopyButton';
import {
  createCollectionAction,
  updateCollectionAction,
  setCollectionStatusAction,
  deleteCollectionAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Збори' };

function toLocalDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function CollectionCard({ c }: { c: CollectionRow }) {
  const active = c.status === 'active';
  const paused = c.status === 'paused';
  const hasGoal = c.goalUah != null && c.goalUah > 0;
  // Показуємо «накопичено» з урахуванням стартової суми (displayed), а не лише реальні донати.
  const actualPercent = hasGoal ? Math.round((c.displayedUah / c.goalUah!) * 100) : 0;
  const reached = hasGoal && c.displayedUah >= c.goalUah!;
  const report = collectionReportText(c);

  return (
    <div className={`collection-card${active ? '' : ' done'}`}>
      <div className="cc-head">
        <div className="cc-title">
          {c.name}
          {active ? (
            <span className="cc-badge on">активний</span>
          ) : paused ? (
            <span className="cc-badge pause">на паузі</span>
          ) : (
            <span className="cc-badge off">завершено</span>
          )}
          {reached && <span className="cc-badge reached">🎉 ціль досягнуто</span>}
        </div>
        <div className="cc-sum">
          <b>{formatUah(c.displayedUah)}</b>
          {hasGoal && <> з {formatUah(c.goalUah!)}</>}
        </div>
      </div>

      {hasGoal && (
        <div className="cl-bar">
          <i style={{ width: `${c.displayedPercent}%` }} />
          <span className="cl-pct">{actualPercent}%</span>
        </div>
      )}

      <div className="cc-meta">
        <span>
          з {formatDate(c.startAt.getTime())}
          {c.endAt ? ` до ${formatDate(c.endAt.getTime())}` : ''}
        </span>
        <span className="sep" />
        <span>
          {c.streamCount} {c.streamCount === 1 ? 'стрім' : 'стрімів'}
        </span>
        {c.topCities.length > 0 && (
          <>
            <span className="sep" />
            <span className="cc-cities">
              {c.topCities.map((city, i) => (
                <span className="chip sm" key={city.settlementId}>
                  <b>{i + 1}</b> {city.name}
                  <em>{formatPoints(city.points)}</em>
                </span>
              ))}
            </span>
          </>
        )}
      </div>

      <div className="cc-actions">
        <details className="edit-details">
          <summary>✏️ Редагувати</summary>
          <form action={updateCollectionAction} className="cc-edit-form">
            <input type="hidden" name="id" value={c.id} />
            <input type="text" name="name" defaultValue={c.name} className="fld grow" maxLength={120} placeholder="назва" />
            <input type="number" name="goalUah" defaultValue={c.goalUah ?? ''} className="fld num" min={1} step="1" />
            <input type="number" name="seedUah" defaultValue={c.seedUah || ''} className="fld num" min={0} step="1" title="вже зібрано (стартова сума для бара)" placeholder="вже зібрано, ₴" />
            <input type="date" name="endAt" defaultValue={c.endAt ? toLocalDateInput(c.endAt) : ''} className="fld" />
            <button type="submit" className="btn-find">
              Зберегти
            </button>
          </form>
        </details>

        <details className="edit-details">
          <summary>📋 Звіт</summary>
          <div className="report-box">
            <pre className="report-text">{report}</pre>
            <div className="report-actions">
              <CopyButton text={report} label="Копіювати звіт" />
              <a href={`/collections/${c.id}/report-image`} target="_blank" rel="noopener" className="btn-img">
                🖼 Картинка звіту
              </a>
            </div>
          </div>
        </details>

        {active && (
          <form action={setCollectionStatusAction}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="status" value="paused" />
            <button type="submit" className="btn-soft">⏸ Пауза</button>
          </form>
        )}
        {paused && (
          <form action={setCollectionStatusAction}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="status" value="active" />
            <button type="submit" className="btn-soft">▶ Активувати</button>
          </form>
        )}
        {!active && !paused && (
          <form action={setCollectionStatusAction}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="status" value="active" />
            <button type="submit" className="btn-soft">▶ Активувати</button>
          </form>
        )}
        {(active || paused) && (
          <form action={setCollectionStatusAction}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="status" value="completed" />
            <ConfirmSubmit
              className="btn-soft"
              message={`Завершити збір «${c.name}»? Його топ і донати залишаться в архіві.`}
            >
              ✓ Завершити
            </ConfirmSubmit>
          </form>
        )}

        <form action={deleteCollectionAction}>
          <input type="hidden" name="id" value={c.id} />
          <ConfirmSubmit
            className="btn-danger sm"
            message={`Видалити збір «${c.name}»? Стріми залишаться, але відв'яжуться від збору.`}
          >
            🗑
          </ConfirmSubmit>
        </form>
      </div>
    </div>
  );
}

export default async function CollectionsPage() {
  const U = await requireUserId();
  const collections = await listCollections(prisma, U);

  return (
    <div className="tab">
      <section className="card donations-card">
        <div className="card-head">
          <div className="card-title">
            <span className="ic">🎯</span> Збори
          </div>
          <div className="card-hint">активний збір ловить усі донати · ціль необов'язкова</div>
        </div>

        <form action={createCollectionAction} className="cc-create">
          <input type="text" name="name" placeholder="Назва збору (напр. «На дрон для бригади»)…" className="fld grow" maxLength={120} required />
          <input type="number" name="goalUah" placeholder="ціль, ₴ (необов'язково)" className="fld num" min={1} step="1" />
          <input type="number" name="seedUah" placeholder="вже зібрано, ₴ (необов'язково)" className="fld num" min={0} step="1" title="стартова сума: додається до бара, не вважається реальним донатом" />
          <input type="date" name="endAt" className="fld" title="дата завершення (необов'язково)" />
          <button type="submit" className="btn-find">
            ＋ Створити збір
          </button>
        </form>

        <div className="don-table-wrap scroll">
          {collections.length === 0 ? (
            <div className="empty">
              Зборів ще немає. Створи перший — і прив'яжи до нього стріми у вкладці «Стріми».
            </div>
          ) : (
            <div className="collection-list">
              {collections.map((c) => (
                <CollectionCard c={c} key={c.id} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
