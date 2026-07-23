import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { getUnrecognized, UNRECOGNIZED_PER_PAGE } from '@/lib/admin';
import { listAdminActions } from '@/lib/adminLog';
import { formatUah, formatDateTime, initial } from '@/lib/format';
import { CityAutocomplete } from '@/app/CityAutocomplete';
import { ConfirmSubmit } from '@/app/ConfirmSubmit';
import {
  assignCityAction,
  bulkAssignCityAction,
  adjustPointsAction,
  addAliasAction,
  resetCityAction,
  resetAllAction,
  undoActionAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Адмінка' };

type SP = Record<string, string | undefined>;

export default async function AdminPage({ searchParams }: { searchParams: Promise<SP> }) {
  const U = await requireUserId();
  const sp = await searchParams;
  const search = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const skip = (page - 1) * UNRECOGNIZED_PER_PAGE;

  const [{ items: unrecognized, total }, actions] = await Promise.all([
    getUnrecognized(prisma, U, { search, skip, limit: UNRECOGNIZED_PER_PAGE }),
    listAdminActions(prisma, U, 30),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / UNRECOGNIZED_PER_PAGE));
  const pageHref = (p: number) => {
    const qp = new URLSearchParams();
    if (search) qp.set('q', search);
    if (p > 1) qp.set('page', String(p));
    const qs = qp.toString();
    return `/admin${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="tab">
      <section className="card donations-card">
        <div className="card-head">
          <div className="card-title">
            <span className="ic">⚙</span> Адмінка
          </div>
          <div className="card-hint">ручне керування: міста, бали, скидання</div>
        </div>

        <div className="don-table-wrap scroll">
          {/* Нерозпізнані донати */}
          <div className="admin-section">
            <div className="as-title">
              🔎 Нерозпізнані донати
              <span className="head-count">{total}</span>
            </div>
            <p className="as-hint">Місто не визначилось автоматично — признач його вручну, і бали донарахуються.</p>

            <form className="don-filters" action="/admin" method="get">
              <input
                type="text"
                name="q"
                defaultValue={search ?? ''}
                placeholder="Пошук за іменем або повідомленням…"
                className="fld grow"
                maxLength={120}
              />
              <button type="submit" className="btn-find">
                Шукати
              </button>
              {search && (
                <Link href="/admin" className="btn-clear">
                  Скинути
                </Link>
              )}
            </form>

            {unrecognized.length === 0 ? (
              <div className="empty">{search ? 'За цим пошуком нічого немає.' : 'Усі донати розпізнані 🎉'}</div>
            ) : (
              <>
                <div className="bulk-assign">
                  <span className="rr-label">Масово: познач кілька й признач одне місто →</span>
                  <CityAutocomplete
                    action={bulkAssignCityAction}
                    formId="bulk-assign"
                    buttonLabel="Призначити обраним"
                    placeholder="місто для обраних…"
                  />
                </div>
                <div className="unrec-list">
                  {unrecognized.map((d) => (
                    <div className="unrec-item" key={d.externalId}>
                      <label className="unrec-pick" title="Обрати для масового призначення">
                        <input type="checkbox" name="externalIds" value={d.externalId} form="bulk-assign" />
                      </label>
                      <div className="avatar muted">{initial(d.who)}</div>
                    <div className="ui-body">
                      <div className="ui-top">
                        <span className="ui-name">{d.who}</span>
                        {d.outOfGame && (
                          <span className="oog-badge" title="Донат поза грою: призначення міста запише місто, але в гру його поверне лише кнопка «✅ у гру» (Донати/док).">
                            поза грою
                          </span>
                        )}
                        <span className="ui-sum">+{formatUah(d.amountUah)}</span>
                      </div>
                      {d.message && <div className="ui-comment">{d.message}</div>}
                      <div className="ui-meta">{formatDateTime(d.at)}</div>
                    </div>
                    <div className="assign">
                      <CityAutocomplete
                        action={assignCityAction}
                        hidden={{ externalId: d.externalId }}
                        autoSubmit
                        placeholder="призначити місто…"
                      />
                    </div>
                  </div>
                  ))}
                </div>
              </>
            )}

            {pageCount > 1 && (
              <div className="pager">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className="pg">
                    ← Попередні
                  </Link>
                ) : (
                  <span className="pg off">← Попередні</span>
                )}
                <span className="pg-info">
                  стор. {page} з {pageCount}
                </span>
                {page < pageCount ? (
                  <Link href={pageHref(page + 1)} className="pg">
                    Далі →
                  </Link>
                ) : (
                  <span className="pg off">Далі →</span>
                )}
              </div>
            )}
          </div>

          {/* Ручне коригування балів */}
          <div className="admin-section">
            <div className="as-title">⚖️ Ручне коригування балів</div>
            <p className="as-hint">Додати або відняти бали місту вручну (виправлення помилки). Від'ємне число — відняти.</p>
            <CityAutocomplete action={adjustPointsAction} buttonLabel="Застосувати" placeholder="місто…">
              <input type="number" name="points" className="fld num" placeholder="± бали" step="1" required />
            </CityAutocomplete>
          </div>

          {/* Додати синонім місту */}
          <div className="admin-section">
            <div className="as-title">🏷️ Додати синонім місту</div>
            <p className="as-hint">
              Синонім (інша назва/написання) допоможе авто-розпізнавати місто. Одразу працює для пошуку міст;
              для авто-розпізнавання живих донатів застосується після перезапуску інжесту.
            </p>
            <CityAutocomplete action={addAliasAction} buttonLabel="Додати синонім" placeholder="місто…">
              <input type="text" name="alias" className="fld" placeholder="новий синонім (напр. «столиця»)" maxLength={64} required />
            </CityAutocomplete>
          </div>

          {/* Скидання */}
          <div className="admin-section danger-zone">
            <div className="as-title">♻️ Скидання</div>
            <p className="as-hint">
              Скидання видаляє бали й скарбнички, але історія донатів і стріми лишаються. Дія рідкісна — будь обережний.
            </p>
            <div className="reset-row">
              <span className="rr-label">Скинути бали одного міста:</span>
              <CityAutocomplete
                action={resetCityAction}
                autoSubmit
                confirmMessage="Скинути всі бали міста «{city}»? Історія донатів лишиться."
                placeholder="місто для скидання…"
              />
            </div>
            <form action={resetAllAction} className="reset-all">
              <ConfirmSubmit
                className="btn-danger"
                message="СКИНУТИ ВСІ БАЛИ всіх міст? Топ і мапа обнуляться. Історія донатів лишиться. Це не можна скасувати."
              >
                🗑 Скинути ВСІ бали
              </ConfirmSubmit>
            </form>
          </div>

          {/* Журнал дій адміна: аудит + відкат оборотних дій */}
          <div className="admin-section">
            <div className="as-title">🧾 Журнал дій</div>
            <p className="as-hint">
              Останні дії в Адмінці. Оборотні можна відкотити (бали перерахуються); скидання балів — незворотні (лише запис).
            </p>
            {actions.length === 0 ? (
              <div className="empty">Дій ще не було.</div>
            ) : (
              <div className="log-list">
                {actions.map((a) => (
                  <div className={`log-item${a.undone ? ' undone' : ''}`} key={a.id}>
                    <div className="li-body">
                      <span className="li-summary">{a.summary}</span>
                      <span className="li-meta">{formatDateTime(a.at)}</span>
                    </div>
                    <div className="li-action">
                      {a.undone ? (
                        <span className="li-tag undone">відкочено</span>
                      ) : a.undoable ? (
                        <form action={undoActionAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <button type="submit" className="btn-undo" title="Відкотити цю дію">
                            ↩ відкотити
                          </button>
                        </form>
                      ) : (
                        <span className="li-tag" title="Скидання знищує бали — відновити не можна">
                          незворотна
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
