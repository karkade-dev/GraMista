import './landing.css';
import { prisma } from '@/lib/db';
import { getGlobalMap } from '@/lib/globalMap';
import { pluralMist, formatUah } from '@/lib/format';
import { getUserId } from '@/lib/session';
import { signupsClosed } from '@/lib/signups';
import { HeroMap } from '@/app/HeroMap';
import { CountUp } from '@/app/CountUp';
import { SignOutButton } from '@/app/SignOutButton';

// Публічний лендінг на / (поза групою (panel) — без операторської шапки й без auth).
// Перенос затвердженого макета docs/design-mockups/landing.html. Жива мапа в hero —
// справжні «запалені» міста глобальної мапи (HeroMap), решта картки — декоративна.
const GITHUB_URL = 'https://github.com/OrestBorukva/GraMista';

// Рендеримо на запит (а не на білді): hero-мапа тягне живі дані з БД, а БД на етапі
// docker-білда недоступна. Агрегати кешовані (getGlobalMap TTL 15с), тож це дешево.
export const dynamic = 'force-dynamic';

export const metadata = {
  // absolute — щоб кореневий шаблон «%s · GraMista» не дублював бренд у заголовку лендингу.
  title: { absolute: 'GraMista — гейміфікація донатів через змагання міст України' },
  description:
    'Глядач донатить і пише місто в коментарі — місто отримує бали й піднімається в топі. Жива мапа, стрічка донатів та оверлеї прямо в OBS.',
};

export default async function LandingPage() {
  const [g, userId] = await Promise.all([getGlobalMap(prisma), getUserId()]);
  const signedIn = userId !== null;
  const closed = signupsClosed();
  return (
    <div className="landing">
      {/* ===== NAV ===== */}
      <header className="nav">
        <div className="wrap nav-inner">
          <div className="brand">
            <div className="brand-mark">🏙️</div>
            <div className="brand-name">
              Gra<span>Mista</span>
            </div>
          </div>
          <nav className="nav-links">
            <a href="#how">Як працює</a>
            <a href="#features">Можливості</a>
            <a href="#streamers">Для стрімерів</a>
          </nav>
          <div className="nav-cta">
            {signedIn ? (
              <>
                <SignOutButton className="nav-logout">Вийти</SignOutButton>
                <a href="/dashboard" className="btn btn-primary btn-sm">Дашборд</a>
              </>
            ) : (
              <>
                <a href="/login" className="nav-login">Вхід</a>
                <a href="/register" className="btn btn-primary btn-sm">{closed ? 'Закрита бета' : 'Спробувати'}</a>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ===== HERO ===== */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">🏆 Змагання міст України у твоєму стрімі</span>
            <h1>
              Перетвори донати на <em>змагання міст</em> України
            </h1>
            <p className="lead">
              Глядач донатить і пише місто в коментарі — місто отримує бали й піднімається в топі.
              Жива мапа, стрічка донатів та оверлеї прямо в OBS.
            </p>
            <div className="hero-cta">
              <a href="/register" className="btn btn-primary">
                {closed ? '🔒 Закрита бета — як приєднатись' : 'Підключити банку'}
              </a>
              <a href="#how" className="btn btn-secondary">Як це працює</a>
            </div>
            <div className="trust">
              <span className="dot" /> Працює з банкою monobank
            </div>
          </div>

          {/* live illustration (декоративна) */}
          <div className="show-card">
            <div className="show-head">
              <div className="show-title">🏆 Топ міст України</div>
              <div className="show-tag">наживо</div>
            </div>

            {g.top.length === 0 ? (
              <div className="top-row top-row-empty">Перші міста ось-ось засвітяться 🔥</div>
            ) : (
              g.top.slice(0, 5).map((c, i) => (
                <div className="top-row" key={c.settlementId}>
                  <div className={`medal ${['m1', 'm2', 'm3'][i] ?? 'm-plain'}`}>{i + 1}</div>
                  <div>
                    <div className="city-name">{c.name}</div>
                  </div>
                  <div className="pts">{formatUah(c.sumUah)}</div>
                </div>
              ))
            )}

            <div className="mini-map">
              <HeroMap points={g.litCities} />
              <span className="map-label">
                Мапа України · світиться {g.litCount} {pluralMist(g.litCount)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== RAISED BAND (соц-доказ) ===== */}
      {g.totalUah > 0 && (
        <section className="raised-band-sec">
          <div className="wrap">
            <div className="raised-band">
              <span className="raised-emoji">💛</span>
              <span className="raised-text">
                Через GraMista вже зібрано <b><CountUp id="landing-total" value={g.totalUah} /></b>
              </span>
            </div>
          </div>
        </section>
      )}

      {/* ===== GLOBAL MAP BANNER ===== */}
      <section className="ukr-banner-sec">
        <div className="wrap">
          <a href="/ukraine" className="ukr-banner">
            <span className="ukr-banner-emoji">🗺️</span>
            <span className="ukr-banner-text">
              <b>Жива мапа донатів усієї України</b>
              <span>Донати всіх стрімерів зливаються в одну мапу — запалимо кожне місто разом</span>
            </span>
            <span className="ukr-banner-arr">Подивитись →</span>
          </a>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section id="how">
        <div className="wrap">
          <div className="sec-head">
            <div className="sec-kicker">Як це працює</div>
            <h2>Три прості кроки до змагання</h2>
            <p>Глядачі самі вирішують, яке місто переможе — а ти лише ведеш стрім.</p>
          </div>
          <div className="steps">
            <div className="step">
              <div className="step-no num">1</div>
              <div className="step-icon">💬</div>
              <h3>Донат із містом</h3>
              <p>Глядач донатить на твою банку monobank і пише в коментарі своє місто України.</p>
            </div>
            <div className="step">
              <div className="step-no num">2</div>
              <div className="step-icon">💰</div>
              <h3>Місто отримує бали</h3>
              <p>1 бал = 100 ₴. Дрібні донати збираються у «скарбничку» міста, поки не складуться у наступний бал.</p>
            </div>
            <div className="step">
              <div className="step-no num">3</div>
              <div className="step-icon">🗺️</div>
              <h3>Топ, мапа й OBS</h3>
              <p>Топ міст, інтерактивна мапа України та готові оверлеї оновлюються наживо прямо у твоєму OBS.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section
        id="features"
        style={{ background: 'linear-gradient(180deg, transparent, rgba(33,27,22,.5), transparent)' }}
      >
        <div className="wrap">
          <div className="sec-head">
            <div className="sec-kicker">Можливості</div>
            <h2>Усе для змагання в одному місці</h2>
            <p>Від балів і мапи до оверлеїв та зборів із ціллю — нічого не треба збирати самотужки.</p>
          </div>
          <div className="feat-grid">
            <div className="feat">
              <div className="feat-icon">🏆</div>
              <h3>Топ за період</h3>
              <p>Рейтинг міст за тиждень, місяць або весь час — обери, як вести змагання.</p>
            </div>
            <div className="feat">
              <div className="feat-icon">🗺️</div>
              <h3>Інтерактивна мапа України</h3>
              <p>Міста світяться на мапі за активністю — видно, де найгарячіше прямо зараз.</p>
            </div>
            <div className="feat">
              <div className="feat-icon">📺</div>
              <h3>OBS-оверлеї</h3>
              <p>Готові оверлеї топу, стрічки донатів і мапи — додаєш у сцену й працюєш.</p>
            </div>
            <div className="feat">
              <div className="feat-icon">💰</div>
              <h3>Скарбнички міст</h3>
              <p>Дрібні донати не зникають: вони накопичуються в скарбничці міста до повного балу.</p>
            </div>
            <div className="feat">
              <div className="feat-icon">⚙️</div>
              <h3>Адмінка балів</h3>
              <p>Контролюй нарахування, виправляй помилки та керуй змаганням зі зручної панелі.</p>
            </div>
            <div className="feat">
              <div className="feat-icon">🎯</div>
              <h3>Кілька стрімів і збори</h3>
              <p>Веди окремі змагання й запускай кампанії зі спільною ціллю та прогресом.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== STREAMERS CTA ===== */}
      <section id="streamers" className="streamers">
        <div className="wrap">
          <div className="streamers-card">
            <div className="inner">
              <h2>Заведи власне змагання міст</h2>
              <p>
                Підключи свою банку monobank — і за кілька хвилин у тебе вже працює топ
                міст, мапа та оверлеї. Кожен стрімер веде своє змагання.
                {closed && ' Зараз це закрита програма — приєднання за особистою домовленістю зі мною.'}
              </p>
              <a href="/register" className="btn btn-primary">
                {closed ? 'Як приєднатись' : 'Підключити свою банку'}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer>
        <div className="wrap">
          <div className="foot-grid">
            <div className="brand">
              <div className="brand-mark">🏙️</div>
              <div className="brand-name">
                Gra<span>Mista</span>
              </div>
            </div>
            <nav className="foot-links">
              <a href="#how">Як працює</a>
              <a href="#features">Можливості</a>
              {signedIn ? <a href="/dashboard">Дашборд</a> : <a href="/login">Вхід</a>}
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </nav>
          </div>

          <div className="foot-oss">
            <p>Відкритий код · безкоштовно для некомерційного використання · можна хостити самому</p>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm foot-oss-btn">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Подивитись код на GitHub
            </a>
          </div>

          <div className="foot-made">
            <p>Зроблено з 💛 для українських стрімерів</p>
            <p>
              Автор — Орест Боруква · є запитання?{' '}
              <a href="https://t.me/OrestBorykva" target="_blank" rel="noopener noreferrer">
                Telegram
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
