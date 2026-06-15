import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import {
  listDonations,
  listDonationCities,
  parseDonationFilter,
  parseDonationSort,
  parseCursor,
  encodeCursor,
  DONATIONS_PER_PAGE,
  type DonationCursor,
  type DonationSort,
} from '@/lib/donations';
import { formatUah, formatPoints, formatDateTime, initial } from '@/lib/format';
import { ensureDockKey } from '@/lib/publicUser';
import { OpenDockButton } from '@/app/OpenDockButton';
import { CityAutocomplete } from '@/app/CityAutocomplete';
import { ReassignCityCell } from '@/app/ReassignCityCell';
import { StreamPicker } from '@/app/StreamPicker';
import { assignCityAction, reassignCityAction } from '@/app/(panel)/admin/actions';
import { moveDonationAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Донати' };

type SP = Record<string, string | undefined>;

export default async function DonationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const U = await requireUserId();
  const sp = await searchParams;
  const filter = parseDonationFilter(sp);
  const { sort, dir } = parseDonationSort(sp);
  const cursor = parseCursor(sp.cursor);
  const nav = sp.nav === 'prev' ? 'prev' : 'next';

  const [page, cities, streams, dockKey] = await Promise.all([
    listDonations(prisma, U, filter, { cursor, nav, sort, dir }),
    listDonationCities(prisma, U),
    prisma.stream.findMany({ where: { userId: U }, select: { id: true, name: true }, orderBy: { startedAt: 'desc' } }),
    ensureDockKey(prisma, U),
  ]);

  // Поточні фільтри (без сортування/курсора) — основа для всіх лінків
  const baseParams = new URLSearchParams();
  if (sp.q) baseParams.set('q', sp.q);
  if (sp.min) baseParams.set('min', sp.min);
  if (sp.max) baseParams.set('max', sp.max);
  if (sp.status) baseParams.set('status', sp.status);
  if (sp.city) baseParams.set('city', sp.city);
  if (sp.stream) baseParams.set('stream', sp.stream);
  if (sp.period) baseParams.set('period', sp.period);

  // Лінк зміни сортування: той самий стовпець → перемкнути напрямок; новий → desc. Курсор скидаємо.
  const sortHref = (field: DonationSort) => {
    const p = new URLSearchParams(baseParams);
    p.set('sort', field);
    p.set('dir', sort === field && dir === 'desc' ? 'asc' : 'desc');
    return `/donations?${p.toString()}`;
  };
  const sortArrow = (field: DonationSort) => (sort === field ? (dir === 'desc' ? ' ↓' : ' ↑') : ' ↕');

  // Пагінація й експорт несуть поточні фільтри + сортування.
  const pageHref = (c: DonationCursor, navDir: 'next' | 'prev') => {
    const p = new URLSearchParams(baseParams);
    p.set('sort', sort);
    p.set('dir', dir);
    p.set('cursor', encodeCursor(c));
    p.set('nav', navDir);
    return `/donations?${p.toString()}`;
  };
  const exportParams = new URLSearchParams(baseParams);
  exportParams.set('sort', sort);
  exportParams.set('dir', dir);
  const exportHref = `/donations/export?${exportParams.toString()}`;
  const hasFilters = baseParams.toString().length > 0;

  return (
    <div className="tab">
      <section className="card donations-card">
        <div className="card-head">
          <div className="card-title">
            <span className="ic">💛</span> Історія донатів
          </div>
          <div className="card-actions">
            <OpenDockButton dockKey={dockKey} />
            <a href={exportHref} className="btn-csv" download>
              ⬇ Експорт CSV
            </a>
          </div>
        </div>

        <form className="don-filters" action="/donations" method="get">
          <input
            type="text"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Пошук за донатером…"
            className="fld grow"
            maxLength={120}
          />
          <input
            type="number"
            name="min"
            defaultValue={sp.min ?? ''}
            placeholder="сума від, ₴"
            className="fld num"
            min={0}
            step="1"
          />
          <input
            type="number"
            name="max"
            defaultValue={sp.max ?? ''}
            placeholder="до, ₴"
            className="fld num"
            min={0}
            step="1"
          />
          <select name="city" defaultValue={sp.city ?? ''} className="fld">
            <option value="">усі міста</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="stream" defaultValue={sp.stream ?? ''} className="fld">
            <option value="">усі стріми</option>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select name="period" defaultValue={sp.period ?? ''} className="fld">
            <option value="">весь час</option>
            <option value="week">тиждень</option>
            <option value="month">місяць</option>
          </select>
          <select name="status" defaultValue={sp.status ?? ''} className="fld">
            <option value="">усі статуси</option>
            <option value="recognized">розпізнані (з балами)</option>
            <option value="pocket">у скарбничці</option>
            <option value="unrecognized">не розпізнані</option>
          </select>
          {/* Зберігаємо поточне сортування при застосуванні фільтра */}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <button type="submit" className="btn-find">
            Шукати
          </button>
          {hasFilters && (
            <Link href="/donations" className="btn-clear">
              Скинути
            </Link>
          )}
        </form>

        <div className="don-table-wrap scroll">
          {page.rows.length === 0 ? (
            <div className="empty">
              {hasFilters ? 'За цим фільтром донатів немає.' : 'Донатів ще немає.'}
            </div>
          ) : (
            <table className="dtable">
              <thead>
                <tr>
                  <th>
                    <Link href={sortHref('date')} className={`th-sort${sort === 'date' ? ' on' : ''}`}>
                      Час{sortArrow('date')}
                    </Link>
                  </th>
                  <th>Донатер</th>
                  <th className="num">
                    <Link href={sortHref('amount')} className={`th-sort${sort === 'amount' ? ' on' : ''}`}>
                      Сума{sortArrow('amount')}
                    </Link>
                  </th>
                  <th>Місто</th>
                  <th>Стрім</th>
                  <th className="num">Бали</th>
                  <th>Повідомлення</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((d) => (
                  <tr key={d.externalId}>
                    <td className="when">{formatDateTime(d.at)}</td>
                    <td className="who">
                      <span className={`av${d.status === 'recognized' && d.points > 0 ? '' : ' muted'}`}>
                        {initial(d.who)}
                      </span>
                      {d.who}
                    </td>
                    <td className="num sum">+{formatUah(d.amountUah)}</td>
                    <td>
                      {d.city ? (
                        <ReassignCityCell
                          key={d.city}
                          externalId={d.externalId}
                          city={d.city}
                          action={reassignCityAction}
                        />
                      ) : (
                        <div className="inline-assign">
                          <CityAutocomplete
                            action={assignCityAction}
                            hidden={{ externalId: d.externalId }}
                            placeholder="призначити місто…"
                            autoSubmit
                          />
                        </div>
                      )}
                    </td>
                    <td>
                      {/* key ремонтить пікер на серверне значення після збереження: без нього
                          неконтрольований <select> лишається на старому після server-action і
                          візуально «скидається» на «без стріму», хоч у БД уже збережено (як ReassignCityCell). */}
                      <StreamPicker
                        key={d.streamId ?? 'none'}
                        action={moveDonationAction}
                        externalId={d.externalId}
                        streams={streams}
                        current={d.streamId}
                      />
                    </td>
                    <td className="num">
                      {d.points > 0 ? (
                        <span className="pts-add">+{formatPoints(d.points)}</span>
                      ) : d.city ? (
                        <span className="pts-pot" title="у скарбничку міста">
                          🫙
                        </span>
                      ) : (
                        <span className="pts-zero">—</span>
                      )}
                    </td>
                    <td className="msg">{d.message || <span className="pts-zero">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="pager">
          {page.prevCursor ? (
            <Link href={pageHref(page.prevCursor, 'prev')} className="pg">
              ← Новіші
            </Link>
          ) : (
            <span className="pg off">← Новіші</span>
          )}
          <span className="pg-info">по {DONATIONS_PER_PAGE} на сторінку</span>
          {page.nextCursor ? (
            <Link href={pageHref(page.nextCursor, 'next')} className="pg">
              Старіші →
            </Link>
          ) : (
            <span className="pg off">Старіші →</span>
          )}
        </div>
      </section>
    </div>
  );
}
