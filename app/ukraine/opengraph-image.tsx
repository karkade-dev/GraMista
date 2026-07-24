import { ImageResponse } from 'next/og';
import { prisma } from '@/lib/db';
import { getGlobalMap } from '@/lib/globalMap';
import { ogFonts } from '@/app/og/reportImage';
import { mapBackground } from '@/app/og/mapBackground';
import { formatUah } from '@/lib/format';

// Прев'ю-картка посилання /ukraine для Telegram/Discord/Twitter (next/og, як картинки-звітів).
// ⚠ Satori: КОЖЕН <div> із >1 дитиною мусить мати display:flex (пастка з HANDOFF).
export const runtime = 'nodejs';
// Рендеримо на запит (а не на білді): картинка тягне живі агрегати з БД, а БД на етапі
// docker-білда недоступна (інакше build падає на статичній генерації цього роуту).
export const dynamic = 'force-dynamic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const MEDALS = ['🥇', '🥈', '🥉'];

export default async function OgImage() {
  const data = await getGlobalMap(prisma);
  const top3 = data.top.slice(0, 3);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 64,
          backgroundColor: '#1B1714',
          backgroundImage: mapBackground(data.litCities),
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          color: '#F3E9DF',
          fontFamily: 'Onest',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 56, fontWeight: 700, display: 'flex' }}>🗺️ Мапа донатів України</div>
          <div style={{ fontSize: 30, color: '#CDBCAB', marginTop: 8, display: 'flex' }}>
            донати всіх стрімерів на одній живій мапі — запалимо кожне місто
          </div>
        </div>
        <div style={{ display: 'flex', gap: 48, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 30, color: '#9A8979', display: 'flex' }}>Разом зібрано</div>
            <div style={{ fontSize: 64, fontWeight: 700, color: '#E0B66B', display: 'flex' }}>{formatUah(data.totalUah)}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 10 }}>
            <div style={{ fontSize: 44, fontWeight: 700, display: 'flex' }}>
              {data.litCount.toLocaleString('uk-UA')} міст
            </div>
            <div style={{ fontSize: 26, color: '#9A8979', display: 'flex' }}>
              засвітилося з {data.settlementsTotal.toLocaleString('uk-UA')}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {top3.map((c, i) => (
            <div key={c.settlementId} style={{ display: 'flex', fontSize: 34 }}>
              <div style={{ width: 60, display: 'flex' }}>{MEDALS[i]}</div>
              <div style={{ flex: 1, display: 'flex' }}>{c.name}</div>
              <div style={{ color: '#E2A878', display: 'flex' }}>{formatUah(c.sumUah)}</div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 26, color: '#9A8979' }}>GraMista</div>
        </div>
      </div>
    ),
    { ...size, fonts: ogFonts() },
  );
}
