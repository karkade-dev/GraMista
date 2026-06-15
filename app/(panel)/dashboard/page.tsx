import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { monoSilentDays } from '@/lib/monoHook';
import { getState, dashboardTiles, biggestRecentId } from '@/lib/dashboard';
import { leaderboard } from '@/lib/leaderboard';
import { getActiveCollection, listCollectionOptions } from '@/lib/collections';
import { parseRange, windowFor, createdAtWhere, type Range } from '@/lib/period';
import { formatUah, formatPoints, pluralBaliv, pluralMist, initial, oneLineComment } from '@/lib/format';
import { AllCities } from '@/app/AllCities';
import { CopyButton } from '@/app/CopyButton';
import { MapUkraine } from '@/app/MapUkraine';
import { OvertakeWatcher } from '@/app/OvertakeWatcher';
import { ReassignCityCell } from '@/app/ReassignCityCell';
import { CityAutocomplete } from '@/app/CityAutocomplete';
import { assignCityAction, reassignCityAction } from '@/app/(panel)/admin/actions';
import { moveDonationToCollectionAction } from '@/app/(panel)/collections/actions';

// Живі дані — рендеримо на кожен запит (без статичної генерації на білді).
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Дашборд' };

// «Стрім» — скоуп за активним стрімом; «Збір» — за активним збором (рамка змагання); решта — час.
type DashPeriod = Range | 'stream' | 'collection';

const PERIODS: { value: DashPeriod; label: string }[] = [
  { value: 'collection', label: 'Збір' },
  { value: 'stream', label: 'Стрім' },
  { value: 'week', label: 'Тиждень' },
  { value: 'month', label: 'Місяць' },
  { value: 'all', label: 'Весь час' },
];

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; sort?: string }>;
}) {
  const U = await requireUserId();
  const { period: periodParam, sort: sortParam } = await searchParams;
  const sort: 'asc' | 'desc' = sortParam === 'asc' ? 'asc' : 'desc';
  const asc = sort === 'asc';

  // Кнопку «Стрім» показуємо лише коли є активний стрім; «Збір» — лише коли є активний збір.
  const active = await prisma.stream.findFirst({
    where: { userId: U, endedAt: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  const activeCol = await getActiveCollection(prisma, U);
  // Без параметра дефолт — збір (якщо є), інакше весь час. Збір/стрім — лише за наявності.
  const period: DashPeriod =
    periodParam === 'collection' && activeCol ? 'collection'
    : periodParam === 'stream' && active ? 'stream'
    : periodParam ? parseRange(periodParam)
    : activeCol ? 'collection' : 'all';
  const periods = PERIODS.filter(
    (p) => (p.value !== 'stream' || active) && (p.value !== 'collection' || activeCol),
  );

  // URL дашборду зі збереженням обох станів (період + напрямок сортування).
  const hrefFor = (p: DashPeriod, s: 'asc' | 'desc') => `/dashboard?period=${p}` + (s === 'asc' ? '&sort=asc' : '');

  const window = period === 'stream' || period === 'collection' ? {} : windowFor(period);
  const streamId = period === 'stream' ? active!.id : undefined;
  const collectionId = period === 'collection' ? activeCol!.id : undefined;
  const createdAt = createdAtWhere(window);
  const donWhere = streamId
    ? { userId: U, streamId }
    : collectionId
      ? { userId: U, collectionId }
      : { userId: U, ...(createdAt ? { createdAt } : {}) };

  const lbFilter = streamId
    ? { streamIds: [streamId], limit: 500, asc }
    : collectionId
      ? { collectionId, limit: 500, asc }
      : { ...window, limit: 500, asc };

  const [state, cities, donationCount, tiles, collectionOptions, profile, monoSource] = await Promise.all([
    getState(prisma, U, window, { streamId, collectionId, audience: 'admin' }),
    leaderboard(prisma, U, lbFilter),
    prisma.donation.count({ where: donWhere }),
    dashboardTiles(prisma, U),
    listCollectionOptions(prisma, U),
    prisma.user.findUnique({ where: { id: U }, select: { handle: true } }),
    prisma.donationSource.findFirst({
      where: { userId: U, type: 'monobank', status: 'active' },
      select: { lastEventAt: true, createdAt: true },
    }),
  ]);

  // Вебхук monobank може бути вимкнений банком без жодного API-сигналу (zero token
  // storage) — довга тиша це єдина ознака, тож м'яко підказуємо перепідключитись.
  const silentDays = monoSource ? monoSilentDays(monoSource, new Date()) : null;

  // Повна адреса публічної сторінки — стрімер копіює її для глядачів (тому абсолютна, не /slug).
  const base = process.env.APP_BASE_URL ?? '';
  const publicUrl = profile?.handle ? `${base}/${profile.handle}` : null;

  const top10 = cities.slice(0, 10);
  // Максимум балів — для ширини смужок; беремо з усіх міст, щоб смужки лишались
  // осмисленими і при сортуванні «менші зверху».
  const maxPts = cities.reduce((m, c) => Math.max(m, c.points), 1);

  // Окремий топ «Світ / Діаспора» — лише в режимі 'separate' (getState віддає закордонні
  // міста окремим списком). У режимах 'off'/'shared' секції немає — топ єдиний, як було.
  const abroadTop = state.abroadMode === 'separate' ? (state.leaderboardAbroad ?? []) : [];
  const abroadMaxPts = abroadTop.reduce((m, c) => Math.max(m, c.points), 1);

  // Виділяємо найбільший донат у стрічці (лише коли є що порівнювати — від 2 донатів).
  const biggestId = state.recent.length >= 2 ? biggestRecentId(state.recent) : null;

  return (
    <>
      {/* Сповіщення про обгін у топі (лише спадання). Збір/стрім у ключі — щоб перемикання
          скоупу (зокрема realtime-зміна активного збору) скидало базову лінію, не плодячи хибних тостів. */}
      <OvertakeWatcher
        order={asc ? [] : top10.map((c) => ({ id: c.settlementId, name: c.name }))}
        viewKey={`${period}:${sort}:${collectionId ?? streamId ?? ''}`}
      />

      {silentDays !== null && (
        <div className="banner-warn" role="status">
          🔕 Від банки monobank не було подій уже {silentDays} дн. Якщо донати при цьому не
          доходять — можливо, банк вимкнув сповіщення після збою.{' '}
          <Link href="/settings">Перепідключи банку в Налаштуваннях</Link> (вставити токен
          заново, ~30 секунд).
        </div>
      )}

      {/* Публічна сторінка стрімера — на видноті, щоб легко скинути глядачам. */}
      <div className="publink">
        <span className="publink-lbl">🔗 Публічна сторінка</span>
        {publicUrl ? (
          <>
            <a className="publink-url" href={publicUrl} target="_blank" rel="noreferrer">
              {publicUrl.replace(/^https?:\/\//, '')}
            </a>
            <CopyButton text={publicUrl} label="Копіювати" />
            <a className="publink-open" href={publicUrl} target="_blank" rel="noreferrer">
              Відкрити ↗
            </a>
          </>
        ) : (
          <Link className="publink-url" href="/settings">
            Вкажіть публічний слаг у Налаштуваннях — і тут з’явиться адреса вашої сторінки →
          </Link>
        )}
      </div>

      {/* Міні-плитки: сьогодні зібрано · лідер дня · активних міст · за стрім */}
      <div className="tiles">
        <div className="tile">
          <span className="tile-val accent">{formatUah(tiles.todayRaisedUah)}</span>
          <span className="tile-lbl">сьогодні зібрано</span>
        </div>
        <div className="tile">
          <span className="tile-val">{tiles.todayLeader ? tiles.todayLeader.name : '—'}</span>
          <span className="tile-lbl">
            {tiles.todayLeader ? `лідер дня · ${formatPoints(tiles.todayLeader.points)} ${pluralBaliv(tiles.todayLeader.points)}` : 'лідер дня'}
          </span>
        </div>
        <div className="tile">
          <span className="tile-val">{tiles.activeCities}</span>
          <span className="tile-lbl">активних {pluralMist(tiles.activeCities)}</span>
        </div>
        <div className="tile">
          <span className="tile-val">{tiles.activeStream ? formatUah(tiles.activeStream.sumUah) : '—'}</span>
          <span className="tile-lbl">
            {tiles.activeStream ? `за стрім · ${tiles.activeStream.donations} донат.` : 'стрім не активний'}
          </span>
        </div>
      </div>

    <div className="main">
      {/* ЛІВА: період + ТОП-10 */}
      <div className="column">
        <div className="segmented">
          {periods.map((p) => (
            <Link
              key={p.value}
              href={hrefFor(p.value, sort)}
              className={period === p.value ? 'active' : undefined}
            >
              {p.label}
            </Link>
          ))}
        </div>

        <section className="card fill">
          <div className="card-head">
            <div className="card-title">
              <span className="ic">🏆</span> ТОП-10 міст
            </div>
            <div className="head-tools">
              <Link
                href={hrefFor(period, asc ? 'desc' : 'asc')}
                className="sort-toggle"
                title={asc ? 'Зараз: менші зверху — натисни, щоб більші' : 'Зараз: більші зверху — натисни, щоб менші'}
              >
                {asc ? '↑ менші' : '↓ більші'}
              </Link>
              <span className="card-hint">1 бал = 100 ₴</span>
            </div>
          </div>
          <div className="top-list scroll">
            {top10.length === 0 ? (
              <div className="empty">Поки порожньо — щойно прийдуть донати з містами, тут з'явиться топ.</div>
            ) : (
              top10.map((c, i) => {
                const rank = i + 1;
                const medal = rank <= 3 ? ` medal r${rank}` : '';
                return (
                  <Link className={`row${medal}`} key={c.settlementId} href={`/city/${c.settlementId}`}>
                    <div className="rank">{rank}</div>
                    <div className="city">{c.name}</div>
                    <div className="pts">
                      {formatPoints(c.points)} <em>{pluralBaliv(c.points)}</em>
                    </div>
                    <div className="bar">
                      <i style={{ width: `${Math.max(4, (c.points / maxPts) * 100)}%` }} />
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </section>

        {abroadTop.length > 0 && (
          <section className="card fill">
            <div className="card-head">
              <div className="card-title">
                <span className="ic">🌍</span> Світ / Діаспора
              </div>
              <span className="card-hint">1 бал = 100 ₴</span>
            </div>
            <div className="top-list scroll">
              {abroadTop.slice(0, 10).map((c, i) => {
                const rank = i + 1;
                const medal = rank <= 3 ? ` medal r${rank}` : '';
                return (
                  <Link className={`row${medal}`} key={c.settlementId} href={`/city/${c.settlementId}`}>
                    <div className="rank">{rank}</div>
                    <div className="city">{c.name}</div>
                    <div className="pts">
                      {formatPoints(c.points)} <em>{pluralBaliv(c.points)}</em>
                    </div>
                    <div className="bar">
                      <i style={{ width: `${Math.max(4, (c.points / abroadMaxPts) * 100)}%` }} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* ЦЕНТР: мапа + усі міста */}
      <div className="column">
        <section className="card map-card">
          <MapUkraine points={state.map} initialLabels="all" world={state.abroadWorldMap} />
          <div className="map-foot">
            <span className="legend">
              <span className="lg big">
                <i /> більше балів
              </span>
              <span className="lg">
                <i /> менше балів
              </span>
            </span>
            <span>
              {state.map.length} {pluralMist(state.map.length)} на мапі
            </span>
          </div>
        </section>

        <AllCities cities={cities} />
      </div>

      {/* ПРАВА: стрічка донатів */}
      <div className="column">
        <section className="card feed-card">
          <div className="card-head">
            <div className="card-title">
              <span className="ic">💛</span> Останні донати
            </div>
            <div className="card-hint">
              <b style={{ color: 'var(--ink)' }}>{donationCount}</b> донатів
            </div>
          </div>

          <div className="feed scroll">
            {state.recent.length === 0 ? (
              <div className="empty">Донатів ще немає.</div>
            ) : (
              state.recent.map((d) => {
                const muted = d.city == null || d.points === 0;
                const badge =
                  d.points > 0 ? (
                    <span className="badge add">
                      ＋ {formatPoints(d.points)} {pluralBaliv(d.points)} місту
                    </span>
                  ) : d.city ? (
                    <span className="badge pot">🫙 у скарбничку міста</span>
                  ) : (
                    <span className="badge none">місто не розпізнане</span>
                  );
                const isBiggest = d.externalId === biggestId;
                return (
                  <div className={`donate${isBiggest ? ' biggest' : ''}${d.newCity ? ' opener' : ''}`} key={d.externalId}>
                    <div className={`avatar${muted ? ' muted' : ''}`}>{initial(d.who)}</div>
                    <div className="d-body">
                      <div className="d-top">
                        <span className="d-name">
                          {isBiggest && (
                            <span className="d-flame" title="Найбільший донат у стрічці">🔥</span>
                          )}
                          {d.who}
                        </span>
                        <span className="d-sum">+{formatUah(d.amountUah)}</span>
                      </div>
                      {d.message && <div className="d-comment">«{oneLineComment(d.message)}»</div>}
                      <div className="d-meta">
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
                      </div>
                      {collectionOptions.length > 0 && (
                        <details className="edit-details">
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
                      {d.abroad && <span className="badge abroad">🌍 закордон</span>}
                      {d.newCity && <span className="badge newcity">🆕 нове місто на мапі</span>}
                      {badge}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="feed-more">
            <Link href="/donations" className="btn-more">↓ вся історія →</Link>
          </div>
        </section>
      </div>
    </div>
    </>
  );
}
