import { prisma } from '@/lib/db';
import { userIdByDockKey } from '@/lib/publicUser';
import { listDonationsForDock, type DonationFilter } from '@/lib/donations';
import { parseDockConfig, type DockPeriod } from '@/lib/dockConfig';
import { formatUah, formatPoints, pluralBaliv, initial } from '@/lib/format';
import { listCollectionOptions } from '@/lib/collections';
import { LiveRefresh } from '@/app/LiveRefresh';
import { DockLive } from '@/app/DockLive';
import { DockZoom } from '@/app/DockZoom';
import { ReassignCityCell } from '@/app/ReassignCityCell';
import { CityAutocomplete } from '@/app/CityAutocomplete';
import { assignCityAction, reassignCityAction } from '@/app/(panel)/admin/actions';
import { moveDonationToCollectionAction } from '@/app/(panel)/collections/actions';

export const dynamic = 'force-dynamic';
type SP = Promise<Record<string, string | string[] | undefined>>;

const PERIOD_LABEL: Record<DockPeriod, string> = {
  all: 'весь час', stream: 'стрім', today: 'сьогодні', week: 'тиждень', month: 'місяць',
};

function hhmm(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Вікно номерів сторінок з «…» по краях (поточна ± 2).
function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  const out: (number | 'gap')[] = [];
  const lo = Math.max(2, page - 2);
  const hi = Math.min(pageCount - 1, page + 2);
  out.push(1);
  if (lo > 2) out.push('gap');
  for (let n = lo; n <= hi; n++) out.push(n);
  if (hi < pageCount - 1) out.push('gap');
  if (pageCount > 1) out.push(pageCount);
  return out;
}

export default async function DockPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const cfg = parseDockConfig(sp);
  const U = await userIdByDockKey(prisma, cfg.key);
  if (!U) {
    return (
      <div className="dock-root">
        <div className="dk-empty">Силку доку не розпізнано. Відкрий «Оверлеї» в панелі й скопіюй свіже посилання «Док донатів».</div>
      </div>
    );
  }

  // Період → фільтр.
  let filter: DonationFilter = {};
  if (cfg.period === 'week' || cfg.period === 'month') {
    filter = { range: cfg.period };
  } else if (cfg.period === 'today') {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    filter = { since };
  } else if (cfg.period === 'stream') {
    const s = await prisma.stream.findFirst({ where: { userId: U, endedAt: null }, orderBy: { startedAt: 'desc' }, select: { id: true } });
    if (s) filter = { streamId: s.id }; // нема ефіру → порожній фільтр = весь час
  }

  const [data, collectionOptions] = await Promise.all([
    listDonationsForDock(prisma, U, filter, { page: cfg.page, perPage: cfg.perPage }),
    listCollectionOptions(prisma, U),
  ]);

  // Збереження поточних параметрів у лінках пагінатора.
  const hrefFor = (n: number) => {
    const p = new URLSearchParams();
    p.set('k', cfg.key);
    p.set('period', cfg.period);
    p.set('per', String(cfg.perPage));
    p.set('scale', String(cfg.scale));
    p.set('page', String(n));
    return `/dock?${p.toString()}`;
  };
  const firstPageHref = hrefFor(1);

  return (
    <div className="dock-root">
      {/* Auto-refresh лише на 1-й сторінці — на ≥2 список стабільний, живе тільки лічильник DockLive. */}
      {cfg.live && data.page === 1 && <LiveRefresh dockKey={cfg.key} />}
      {cfg.live && <DockLive page={data.page} topId={data.rows[0]?.externalId ?? null} firstPageHref={firstPageHref} />}
      <div className="dk">
        <div className="dk-bar">
          <span className="live"><span className="dot" /> Донати наживо</span>
          <span className="per">{PERIOD_LABEL[cfg.period]} · {data.total}</span>
          <DockZoom initialScale={cfg.scale} />
        </div>

        {data.page > 1 && <a className="dk-newbar" id="dk-newbar" href={firstPageHref} style={{ display: 'none' }} />}

        <div className="dk-list">
          {data.rows.length === 0 ? (
            <div className="dk-empty">Донатів за цим періодом ще немає.</div>
          ) : (
            data.rows.map((d) => {
              const muted = !d.city;
              return (
                <div className="row" key={d.externalId}>
                  <div className={`av${muted ? ' muted' : ''}`}>{initial(d.who)}</div>
                  <div className="nm">{d.who}</div>
                  <div className="sum">+{formatUah(d.amountUah)}</div>
                  <div className="meta">
                    <span className="time">{hhmm(d.at)}</span>
                    {d.newCity && <span className="ncty">🆕 нове</span>}
                  </div>
                  {d.message && <div className="msg">«{d.message}»</div>}
                  {/* Інлайн призначення/зміна міста — ті самі компоненти й дії, що на дашборді/в історії. */}
                  <div className="dk-assign">
                    {d.city ? (
                      <ReassignCityCell key={d.city} externalId={d.externalId} city={d.city} action={reassignCityAction} />
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
                    {d.city && d.points > 0 ? (
                      <span className="badge add">＋ {formatPoints(d.points)} {pluralBaliv(d.points)} місту</span>
                    ) : d.city ? (
                      <span className="badge pot">🫙 у скарбничку</span>
                    ) : (
                      <span className="badge none">місто не розпізнане</span>
                    )}
                  </div>
                  {collectionOptions.length > 0 && (
                    <details className="edit-details dk-coll">
                      <summary>🎯 {collectionOptions.find((o) => o.id === d.collectionId)?.name ?? 'поза збором'}</summary>
                      <form action={moveDonationToCollectionAction} className="inline-assign">
                        <input type="hidden" name="externalId" value={d.externalId} />
                        {/* key: пікер перемонтовується на серверне значення після збереження (як StreamPicker) */}
                        <select key={d.collectionId ?? 'none'} name="collectionId" defaultValue={d.collectionId ?? ''} className="fld">
                          <option value="">— поза збором —</option>
                          {collectionOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                        <button type="submit" className="btn-find">OK</button>
                      </form>
                    </details>
                  )}
                </div>
              );
            })
          )}
        </div>

        {data.pageCount > 1 && (
          <div className="pager">
            {pageWindow(data.page, data.pageCount).map((n, i) =>
              n === 'gap' ? (
                <span className="pg gap" key={`g${i}`}>…</span>
              ) : (
                <a className={`pg${n === data.page ? ' on' : ''}`} key={n} href={hrefFor(n)}>{n}</a>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
