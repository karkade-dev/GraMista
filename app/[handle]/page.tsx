import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { prisma } from '@/lib/db';
import { getPublicPageCached } from '@/lib/publicPage';
import { validateHandle } from '@/lib/handle';
import { biggestRecentId } from '@/lib/dashboard';
import { formatUah, formatPoints, pluralBaliv, formatDate } from '@/lib/format';
import { LiveTimer } from '@/app/LiveTimer';
import { CountUp } from '@/app/CountUp';
import { HowTo } from './HowTo';
import { FeedList } from './FeedList';
import { TopCities } from './TopCities';
import { CitySeek } from './CitySeek';
import { RaceModal } from './RaceModal';
import { PublicLive } from './PublicLive';
import { PublicMap } from './PublicMap';
import { CityCardHost } from './CityCardHost';
import { GoalCelebration } from './GoalCelebration';
import { StreamsPanel } from './StreamsPanel';
import { CollectionsPanel } from './CollectionsPanel';
import { ShareButton } from './ShareButton';

export const dynamic = 'force-dynamic';

// React cache: generateMetadata і сторінка ділять ОДИН виклик композитора на запит.
// Під ним — TTL-кеш між запитами (lib/publicPage), SSE-роут скидає його на кожен донат.
const loadPage = cache(async (handle: string) => getPublicPageCached(prisma, handle));

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle: raw } = await params;
  const v = validateHandle(decodeURIComponent(raw));
  if (!v.ok) return { title: { absolute: 'GraMista' } };
  const data = await loadPage(v.handle);
  if (!data) return { title: { absolute: 'GraMista' } };
  const title = `${data.profile.name} — битва міст на GraMista`;
  const description = `Зібрано ${Math.round(data.totalAllTimeUah).toLocaleString('uk-UA')} ₴ · міст у грі: ${data.fullLeaderboard.length}. Донать і виводь своє місто в топ!`;
  return { title: { absolute: title }, description, openGraph: { title, description } };
}

export default async function PublicPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await params;
  const v = validateHandle(decodeURIComponent(raw));
  if (!v.ok) notFound();
  const data = await loadPage(v.handle);
  if (!data) notFound();
  const { profile, state, fullLeaderboard, fullAbroad, totalAllTimeUah, battle, tiles, activeCollection, pastCollections, streams } = data;

  const jar = profile.monobankJarUrl;
  const qrSvg = jar
    ? await QRCode.toString(jar, { type: 'svg', margin: 0, color: { dark: '#241505', light: '#F3E9DF' } })
    : null;
  const live = state.activeStream; // getState віддає лише відкритий стрім (endedAt IS NULL)

  return (
    <div className="pub-root">
      <PublicLive
        handle={profile.handle}
        order={fullLeaderboard.map((r) => ({ id: r.settlementId, name: r.name }))}
        scopeKey={activeCollection?.id ?? ''}
      />
      <div className="pub-map">
        <PublicMap points={state.map} world={state.abroadWorldMap} />
      </div>

      <header className="pub-panel pub-hdr">
        <div className="pub-ava">{(profile.name.trim()[0] ?? '?').toUpperCase()}</div>
        <div>
          <div className="pub-hname">{profile.name}</div>
          {live ? (
            <div className="pub-hsub">
              <span className="pub-live-dot" /> у ефірі{' '}
              <b><LiveTimer startedAt={live.startedAt.getTime()} initialMs={live.durationMs} /></b>
            </div>
          ) : (
            <div className="pub-hsub">битва міст України</div>
          )}
        </div>
        <div className="pub-hbtns">
          {profile.twitchUrl && (
            <a className={'pub-hbtn' + (live ? ' watch' : '')} href={profile.twitchUrl} target="_blank" rel="noreferrer">
              🟣 {live ? 'Дивитись на Twitch' : 'Twitch'}
            </a>
          )}
          {profile.youtubeUrl && (
            <a className="pub-hbtn" href={profile.youtubeUrl} target="_blank" rel="noreferrer">▶ YouTube</a>
          )}
          {streams.filter((s) => s.endedAt).length > 0 && (
            <StreamsPanel
              rows={streams
                .filter((s) => s.endedAt)
                .map((s) => ({ id: s.id, name: s.name, date: formatDate(s.startedAt.getTime()), sumUah: formatUah(s.sumUah), url: s.url }))}
            />
          )}
          {pastCollections.length > 0 && (
            <CollectionsPanel
              handle={profile.handle}
              rows={pastCollections.map((c) => ({
                id: c.id,
                name: c.name,
                date: c.endAt ? formatDate(c.endAt.getTime()) : '',
                sumUah: formatUah(c.raisedUah),
              }))}
            />
          )}
          <ShareButton title={`${profile.name} — битва міст на GraMista`} />
        </div>
      </header>

      <HowTo />

      {battle && (
        <div className="pub-panel pub-battle" key={`${battle.challenger.settlementId}:${battle.diff}`}>
          🥊 <b>{battle.challenger.name}</b>: ще <b>{formatPoints(battle.diff)} {pluralBaliv(battle.diff)}</b> до 1-го місця ({battle.leader.name})
        </div>
      )}

      <section className="pub-panel pub-top" aria-label="Топ міст">
        <div className="pub-ptitle">
          Топ міст <span>{fullLeaderboard.length} міст</span>
        </div>
        <TopCities rows={fullLeaderboard} abroadRows={fullAbroad} />
        <CitySeek handle={profile.handle} />
        <RaceModal handle={profile.handle} />
      </section>

      <section className="pub-panel pub-feed" aria-label="Останні донати">
        <div className="pub-ptitle">Останні донати</div>
        <FeedList rows={state.recent} biggestId={biggestRecentId(state.recent)} showComments={profile.showCommentPublic} />
      </section>

      <section className="pub-panel pub-tiles" aria-label="Сьогодні">
        <div className="pub-tile">
          <div className="l">Сьогодні зібрано</div>
          <div className="v">{formatUah(tiles.todayRaisedUah)}</div>
        </div>
        <div className="pub-tile">
          <div className="l">Лідер дня</div>
          <div className="v">{tiles.todayLeader ? tiles.todayLeader.name : '—'}</div>
        </div>
        <div className="pub-tile">
          <div className="l">Найбільший донат</div>
          <div className="v">{tiles.biggestTodayUah > 0 ? formatUah(tiles.biggestTodayUah) : '—'}</div>
        </div>
      </section>

      <section className="pub-panel pub-foot" aria-label="Донат">
        {activeCollection && activeCollection.goalUah != null && (
          <div className="pub-goal">
            <GoalCelebration percent={activeCollection.displayedPercent} />
            <div className="pub-goal-top">
              <span>{activeCollection.displayedPercent >= 100 ? `🎉 ${activeCollection.name} — ЗАКРИТО!` : activeCollection.name}</span>
              <b>{formatUah(activeCollection.displayedUah)} / {formatUah(activeCollection.goalUah)}</b>
            </div>
            <div className="pub-bar"><i style={{ width: `${activeCollection.displayedPercent}%` }} /></div>
          </div>
        )}
        <div className="pub-raised">
          <div className="lbl">Зібрано загалом</div>
          <div className="val"><CountUp id="pub-raised" value={totalAllTimeUah} /></div>
        </div>
        {jar && (
          <>
            <a className="pub-don" href={jar} target="_blank" rel="noreferrer">⚡ Задонатити</a>
            {qrSvg && <div className="pub-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />}
          </>
        )}
      </section>

      <CityCardHost handle={profile.handle} jarUrl={jar} />

      <div className="pub-brand"><a href="/">зроблено на GraMista</a></div>
    </div>
  );
}
