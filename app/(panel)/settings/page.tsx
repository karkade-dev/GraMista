import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { ensureOverlayKey, ensureDockKey } from '@/lib/publicUser';
import { saveProfileAction, disconnectMonoAction, regenerateOverlayAction, regenerateDockAction } from './actions';
import { toCommentMode, wordListsForUi } from '@/lib/censor';
import { MonoConnect } from './MonoConnect';
import { CommentSettings } from './CommentSettings';
import { TwoFactorSettings } from './TwoFactor';
import { Hint } from '@/app/Hint';
import { CopyButton } from '@/app/CopyButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Налаштування' };

export default async function SettingsPage() {
  const U = await requireUserId();
  const user = await prisma.user.findUnique({
    where: { id: U },
    select: { handle: true, monobankJarUrl: true, twitchUrl: true, youtubeUrl: true, telegramUrl: true, publicShowStreams: true, showOnGlobalMap: true, abroadCities: true, abroadWorldMap: true, abroadTopMode: true, abroadHideAggressor: true, twoFactorEnabled: true, commentMode: true, bannedWordsAdded: true, bannedWordsAllowed: true, showCommentPublic: true },
  });
  const mode = toCommentMode(user?.commentMode);
  const wordLists = wordListsForUi(user?.bannedWordsAdded ?? '', user?.bannedWordsAllowed ?? '');
  const overlayKey = await ensureOverlayKey(prisma, U);
  const dockKey = await ensureDockKey(prisma, U);
  const source = await prisma.donationSource.findFirst({
    where: { userId: U, type: 'monobank' },
    select: { status: true, title: true, lastEventAt: true },
  });
  const connected = source?.status === 'active';

  // Повна адреса публічної сторінки (для копіювання) і хост без протоколу (для показу).
  const base = process.env.APP_BASE_URL ?? '';
  const host = base.replace(/^https?:\/\//, '') || 'gramista';

  return (
    <main className="settings scroll">
      <h1>Налаштування</h1>

      <section>
        <h2>Банка monobank (джерело донатів)</h2>
        <MonoConnect connected={connected} title={source?.title ?? null} />
        {connected && source?.lastEventAt && (
          <small>Остання подія від банку: {source.lastEventAt.toLocaleString('uk-UA')}</small>
        )}
        {user?.monobankJarUrl && (
          <div className="set-line">
            <span className="lbl-row">
              Посилання на банку
              <Hint>
                Береться автоматично з підключеної банки monobank — окремо вписувати не треба.
                Щоб змінити, підключіть іншу банку вище. Глядачі бачать на публічній сторінці
                кнопку «Задонатити» і QR-код, що ведуть сюди.
              </Hint>
            </span>
            <p className="pub-link">
              <a href={user.monobankJarUrl} target="_blank" rel="noreferrer">{user.monobankJarUrl}</a>
              <CopyButton text={user.monobankJarUrl} label="Копіювати" />
            </p>
          </div>
        )}
        {connected && (
          <form action={disconnectMonoAction}>
            <button type="submit" className="btn-danger">Відключити</button>
            <small>
              Нові події перестануть прийматись одразу; сам monobank вимкне сповіщення
              протягом ~10 хвилин після наступного руху на рахунку. Щоб розірвати звʼязок
              миттєво — перегенеруй токен на api.monobank.ua.
            </small>
          </form>
        )}
      </section>

      <section>
        <h2>Профіль і посилання</h2>
        <form action={saveProfileAction}>
          <label>
            <span className="lbl-row">
              Публічний слаг
              <Hint>
                Ваша адреса в GraMista: {host}/&lt;слаг&gt;. Це сторінка з живою мапою і топом
                міст, яку ви даєте глядачам. 3–30 символів: латинські літери, цифри, _ або -.
              </Hint>
            </span>
            <input name="handle" defaultValue={user?.handle ?? ''} placeholder="orest" />
          </label>
          <label>
            <span className="lbl-row">
              Twitch
              <Hint>Кнопка «Twitch» у шапці публічної сторінки — щоб глядачі перейшли на ваш канал.</Hint>
            </span>
            <input name="twitchUrl" defaultValue={user?.twitchUrl ?? ''} placeholder="https://twitch.tv/..." />
          </label>
          <label>
            <span className="lbl-row">
              YouTube
              <Hint>Кнопка «YouTube» у шапці публічної сторінки — щоб глядачі перейшли на ваш канал.</Hint>
            </span>
            <input name="youtubeUrl" defaultValue={user?.youtubeUrl ?? ''} placeholder="https://youtube.com/@..." />
          </label>
          <label>
            <span className="lbl-row">
              Telegram
              <Hint>Кнопка «Telegram» у шапці публічної сторінки — посилання на ваш канал або групу.</Hint>
            </span>
            <input name="telegramUrl" defaultValue={user?.telegramUrl ?? ''} placeholder="https://t.me/..." />
          </label>
          <div className="set-line">
            <label className="set-row">
              <input type="checkbox" name="publicShowStreams" defaultChecked={user?.publicShowStreams ?? true} />
              Показувати минулі стріми на публічній сторінці
            </label>
            <Hint>
              Глядачі бачитимуть перелік завершених стрімів і скільки зібрано на кожному. Вимкнете —
              блок зникне з публічної сторінки.
            </Hint>
          </div>
          <div className="set-line">
            <label className="set-row">
              <input type="checkbox" name="showOnGlobalMap" defaultChecked={user?.showOnGlobalMap ?? true} />
              Долучати мій збір до загальної мапи України
            </label>
            <Hint>
              Мапа України — спільна жива мапа всіх стрімерів GraMista: донати учасників (у гривнях)
              світяться на одній мапі країни, а ви з’являєтесь у списку учасників. Вимкнете — ваші
              донати буде видно лише на вашій сторінці; на бали й топ міст це не впливає.
            </Hint>
            <a href="/ukraine" target="_blank" rel="noreferrer">Мапа України ↗</a>
          </div>
          <div className="set-line">
            <label className="set-row">
              <input type="checkbox" name="abroadCities" defaultChecked={user?.abroadCities ?? false} />
              Розпізнавати міста закордоном
            </label>
            <Hint>
              Донат із коментарем «Варшава», «Прага», «Берлін» (українською) отримає бали й потрапить
              у топ і стрічку. Вимкнено — лишається нерозпізнаним, як зараз. Назви — лише кирилицею.
            </Hint>
          </div>
          <div className="set-line">
            <label className="set-row">
              <input type="checkbox" name="abroadWorldMap" defaultChecked={user?.abroadWorldMap ?? false} />
              Показувати закордон на мапі
            </label>
            <Hint>
              Додає легкий шар кордонів світу; іноземні міста світяться крапками. Вимкнено — мапа
              лишається суто українською, закордон видно лише у списку топу.
            </Hint>
          </div>
          <div className="set-group">
            <span className="lbl-row">Топ закордонних міст</span>
            <label className="set-row">
              <input type="radio" name="abroadTopMode" value="separate" defaultChecked={(user?.abroadTopMode ?? 'separate') !== 'shared'} />
              Окремий список «Світ / Діаспора»
            </label>
            <label className="set-row">
              <input type="radio" name="abroadTopMode" value="shared" defaultChecked={user?.abroadTopMode === 'shared'} />
              Спільний з містами України
            </label>
          </div>
          <div className="set-line">
            <label className="set-row">
              <input type="checkbox" name="abroadHideAggressor" defaultChecked={user?.abroadHideAggressor ?? false} />
              Не зараховувати міста рф/рб
            </label>
            <Hint>За замовчуванням зараховуються. Увімкни, щоб ігнорувати назви міст країн-агресорів.</Hint>
          </div>
          <button type="submit">Зберегти</button>
        </form>
        {user?.handle && (
          <p className="pub-link">
            Публічна сторінка:{' '}
            <a href={`/${user.handle}`} target="_blank" rel="noreferrer">
              {host}/{user.handle}
            </a>
            <CopyButton text={`${base}/${user.handle}`} label="Копіювати" />
          </p>
        )}
      </section>

      <section>
        <h2>Коментарі донатів і цензура</h2>
        <p>
          Текст коментаря з банки можна показувати глядачам на публічній сторінці й в оверлеях.
          Заборонені слова ховаються автоматично. Показ в оверлеях вмикається окремо на вкладці
          «Оверлеї» (галочка «Коментар» у налаштуваннях силки).
        </p>
        <CommentSettings mode={mode} showPublic={user?.showCommentPublic ?? true} lists={wordLists} />
      </section>

      <section>
        <h2>Безпека</h2>
        <TwoFactorSettings enabled={user?.twoFactorEnabled ?? false} />
      </section>

      <section>
        <h2>Силки оверлеїв</h2>
        <p>Токен оверлеїв: <code>{overlayKey}</code></p>
        <form action={regenerateOverlayAction}>
          <button type="submit">Оновити силки оверлеїв (старі перестануть працювати)</button>
        </form>
        <p style={{ marginTop: 16 }}>Силка донат-доку (приватна, з іменами): <code>{dockKey}</code></p>
        <form action={regenerateDockAction}>
          <button type="submit">Оновити силку доку (стара перестане працювати)</button>
        </form>
      </section>
    </main>
  );
}
