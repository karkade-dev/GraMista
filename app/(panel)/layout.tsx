import { Suspense, type ReactNode } from 'react';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { getHeader } from '@/lib/dashboard';
import { formatUah } from '@/lib/format';
import { LiveTimer } from '@/app/LiveTimer';
import { LiveRefresh } from '@/app/LiveRefresh';
import { NewCityWatcher } from '@/app/NewCityWatcher';
import { HeaderStats } from '@/app/HeaderStats';
import { TabNav } from '@/app/TabNav';
import { Hint } from '@/app/Hint';
import { isServiceAdmin } from '@/lib/serviceAdmin';
import { startStreamAction, stopStreamAction, setCityBattleAction } from '@/app/actions';

// Спільна оболонка панелі: шапка (завжди, §17) + навігація вкладок. Живі дані → на кожен запит.
export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: ReactNode }) {
  // Гард усієї групи (panel): нема сесії → редірект на /login. Заразом дає userId для шапки.
  const U = await requireUserId();
  const header = await getHeader(prisma, U);
  const active = header.activeStream;
  const admin = await isServiceAdmin(U);

  return (
    <div className="app">
      <LiveRefresh />
      <NewCityWatcher />
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">🏙️</div>
          <div>
            <div className="brand-name">
              Gra<span>Mista</span>
            </div>
            <div className="brand-sub">панель оператора · OBS</div>
          </div>
        </div>

        <div className="status">
          {active ? (
            <>
              <span className="live">
                <span className="dot" /> у ефірі
              </span>
              <span className="sep" />
              <span className="stat">{active.name}</span>
              <span className="sep" />
            </>
          ) : (
            <>
              <span className="live off">
                <span className="dot off" /> не в ефірі
              </span>
              <span className="sep" />
            </>
          )}
          <Suspense
            fallback={
              <>
                <span className="stat">
                  <b className="accent">{formatUah(header.totalRaisedUah)}</b>
                </span>
                <span className="sep" />
                <span className="stat">
                  <b>{header.donationCount}</b> донатів <span className="stat-period">за весь час</span>
                </span>
              </>
            }
          >
            <HeaderStats totals={header.periodTotals} />
          </Suspense>
          {header.activeCollection && (
            <>
              <span className="sep" />
              <span className="hdr-coll" title={`Активний збір: ${header.activeCollection.name}`}>
                <span className="hc-name">🎯 {header.activeCollection.name}</span>
                {header.activeCollection.goalUah != null ? (
                  <>
                    <span className="hc-bar">
                      <i style={{ width: `${header.activeCollection.percent}%` }} />
                    </span>
                    <span className="hc-val">
                      <b>{formatUah(header.activeCollection.raisedUah)}</b> / {formatUah(header.activeCollection.goalUah)}
                    </span>
                    <span className="hc-pct">{Math.round(header.activeCollection.percent)}%</span>
                  </>
                ) : (
                  <span className="hc-val">
                    <b>{formatUah(header.activeCollection.raisedUah)}</b>
                  </span>
                )}
              </span>
            </>
          )}
        </div>

        {/* На телефоні згортається під кнопку «Керування»; на десктопі — завжди розкрите інлайн (CSS). */}
        <details className="top-actions">
          <summary>
            <span className="ta-btn">⚙ Керування ▾</span>
          </summary>
          <div className="ta-inner">
            <span className="toggle-row">
              <form action={setCityBattleAction}>
                <input type="hidden" name="on" value={header.cityBattle ? 'false' : 'true'} />
                <button
                  type="submit"
                  className={`btn-toggle${header.cityBattle ? ' on' : ''}`}
                  title="Перемкнути участь донатів у грі (гроші збираються завжди)"
                >
                  ⚔️ Битва міст: <b>{header.cityBattle ? 'увімк' : 'вимк'}</b>
                </button>
              </form>
              <Hint>
                {'Битва міст — це гра в міста: глядачі донатять і пишуть місто, місто збирає бали, є топ і мапа. ' +
                  'Увімк — нові донати дають містам бали (топ і мапа працюють). ' +
                  'Вимк — нові донати приймаються як звичайно, але в гру не йдуть: без балів, і глядачі їх не бачать. Видно лише тобі. ' +
                  'Окремий донат можна вручну вивести з гри або повернути — кнопкою на самому донаті.'}
              </Hint>
            </span>

            {active ? (
              <>
                <div className="timer">
                  ⏱ <b><LiveTimer startedAt={active.startedAt.getTime()} initialMs={active.durationMs} /></b>
                </div>
                <form action={stopStreamAction}>
                  <button type="submit" className="btn-stop">
                    ⏹ Завершити
                  </button>
                </form>
              </>
            ) : (
              <form action={startStreamAction} className="start-form">
                <input
                  type="text"
                  name="name"
                  placeholder="Назва стріму…"
                  className="name-input"
                  maxLength={120}
                />
                <button type="submit" className="btn-start">
                  ▶ Почати стрім
                </button>
              </form>
            )}
          </div>
        </details>
      </header>

      <TabNav isAdmin={admin} />

      {children}
    </div>
  );
}
