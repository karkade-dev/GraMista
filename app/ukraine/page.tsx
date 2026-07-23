import QRCode from 'qrcode';
import { prisma } from '@/lib/db';
import { getGlobalMap } from '@/lib/globalMap';
import { formatUah, pluralMist, initial } from '@/lib/format';
import { CountUp } from '@/app/CountUp';
import { GlobalMapView } from './GlobalMapView';
import { GlobalTop } from './GlobalTop';
import { GlobalCityCard } from './GlobalCityCard';
import { GlobalLive } from './GlobalLive';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: { absolute: 'Мапа донатів України — GraMista' },
  description: 'Донати всіх стрімерів на одній живій мапі. Запалимо кожне місто України разом.',
};

export default async function UkrainePage() {
  // Три вікна топу рендеримо одразу (кеш окремий на вікно) — острівець лише перемикає видиме.
  const [data, month, week] = await Promise.all([
    getGlobalMap(prisma),
    getGlobalMap(prisma, { window: 'month' }),
    getGlobalMap(prisma, { window: 'week' }),
  ]);

  const jar = data.featured?.streamer.monobankJarUrl ?? null;
  const qrSvg = jar
    ? await QRCode.toString(jar, { type: 'svg', margin: 0, color: { dark: '#241505', light: '#F3E9DF' } })
    : null;
  const litPct = data.settlementsTotal > 0 ? Math.min(100, (data.litCount / data.settlementsTotal) * 100) : 0;

  return (
    <div className="ukr-root">
      <GlobalLive />
      <div className="ukr-map">
        <GlobalMapView points={data.litCities} />
      </div>

      <a className="ukr-panel ukr-hdr" href="/" aria-label="GraMista — на головну">
        <div className="ukr-brand-mark">🗺️</div>
        <div>
          <div className="ukr-brand-name">Gra<span>Mista</span></div>
          <div className="ukr-brand-sub">жива мапа донатів України</div>
        </div>
      </a>

      <section className="ukr-panel ukr-hero" aria-label="Разом зібрано">
        <div className="lbl">Разом зібрано</div>
        <div className="uah"><CountUp id="ukr-total" value={data.totalUah} /></div>
        <div className="cities">
          <b>{data.litCount.toLocaleString('uk-UA')}</b> {pluralMist(data.litCount)} засвітилося з{' '}
          <b>{data.settlementsTotal.toLocaleString('uk-UA')}</b>
        </div>
        <div className="ukr-litbar"><i style={{ width: `${litPct}%` }} /></div>
      </section>

      <a className="ukr-panel ukr-cta" href="/register">
        Ти стрімер? <b>Підключи свій збір</b> <span className="arr">→</span>
      </a>

      <section className="ukr-panel ukr-top" aria-label="Топ міст">
        <div className="ukr-ptitle">Топ міст</div>
        <GlobalTop all={data.top} month={month.top} week={week.top} />
      </section>

      <div className="ukr-right">
        <section className="ukr-panel ukr-feed" aria-label="Останні донати">
          <div className="ukr-ptitle">Останні донати</div>
          <div className="ukr-feedlist">
            {data.feed.length === 0 ? (
              <div className="ukr-empty">Донати з’являться тут наживо.</div>
            ) : (
              data.feed.map((f) => (
                <div className="ukr-frow" key={f.externalId}>
                  <span className="who">{f.who}</span>
                  <span className="cty">{f.city}</span>
                  <span className="amt">{formatUah(f.amountUah)}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="ukr-panel ukr-livenow" aria-label="Зараз наживо">
          <div className="ukr-ptitle">Зараз наживо</div>
          {data.liveNow.length === 0 ? (
            <div className="ukr-empty">Зараз ніхто не в ефірі.</div>
          ) : (
            data.liveNow.map((l, i) => (
              <div className="ukr-lrow" key={i}>
                <span className="ld" />
                <span className="ln">
                  <span className="ls">{l.streamer.name}</span>
                  <span className="lt">{l.streamName}</span>
                </span>
                <a href={l.url ?? `/${l.streamer.handle}`} target="_blank" rel="noreferrer">дивитись</a>
              </div>
            ))
          )}
        </section>

        <div className="ukr-brandfoot"><a href="/">GraMista</a> — безкоштовний відкритий інструмент<br />для благодійних зборів</div>
      </div>

      <section className="ukr-panel ukr-parts" aria-label="Учасники">
        <div className="ukr-ptitle">Учасники {data.participants.length > 0 && <span>{data.participants.length}</span>}</div>
        {data.participants.length === 0 ? (
          <div className="ukr-empty">Долучайся першим — підключи свій збір.</div>
        ) : (
          <div className="ukr-partrow">
            {data.participants.slice(0, 12).map((p) => (
              <a className="ukr-chip" key={p.handle} href={`/${p.handle}`} target="_blank" rel="noreferrer">
                <span className="cava">{initial(p.name)}</span>
                <span className="cn">{p.name}</span>
                <span className="cu">{formatUah(p.totalUah)}</span>
              </a>
            ))}
            {data.participants.length > 12 && (
              <span className="ukr-chip ukr-chip-more">+{data.participants.length - 12} ще</span>
            )}
          </div>
        )}
      </section>

      {data.featured && (
        <section className="ukr-panel ukr-focus" aria-label="Збір у фокусі">
          <div className="ukr-fbadge">Збір у фокусі</div>
          <div className="goal">
            <div className="gname">{data.featured.name}</div>
            <div className="gby">
              збирає <a href={`/${data.featured.streamer.handle}`} target="_blank" rel="noreferrer">{data.featured.streamer.name}</a>
            </div>
            <div className="gnum">
              <span>зібрано</span>
              <b>
                {formatUah(data.featured.raisedUah)}
                {data.featured.goalUah != null && <> / {formatUah(data.featured.goalUah)}</>}
              </b>
            </div>
            {data.featured.goalUah != null && (
              <div className="ukr-bar"><i style={{ width: `${data.featured.percent}%` }} /></div>
            )}
          </div>
          {jar && <a className="ukr-btn-don" href={jar} target="_blank" rel="noreferrer">⚡ Підтримати</a>}
          {qrSvg && <div className="ukr-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />}
          <div className="ukr-fhint">напиши <b>своє місто</b> в коментарі — воно <b>засвітиться на мапі</b></div>
        </section>
      )}

      <GlobalCityCard />
    </div>
  );
}
