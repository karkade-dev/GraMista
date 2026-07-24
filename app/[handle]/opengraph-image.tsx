import { ImageResponse } from 'next/og';
import { prisma } from '@/lib/db';
import { getPublicPageCached } from '@/lib/publicPage';
import { leaderboard } from '@/lib/leaderboard';
import { mapPoints } from '@/lib/map';
import { validateHandle } from '@/lib/handle';
import { ogFonts } from '@/app/og/reportImage';
import { mapBackground } from '@/app/og/mapBackground';
import { formatUah, formatPoints } from '@/lib/format';

// Прев'ю-картка посилання /<handle> для Telegram/Discord/Twitter (next/og, як картинки-звітів).
// Усі цифри тут — за весь час, а не за активний збір: свіжий порожній збір давав
// «зібрано 0 ₴» без топ-3 поруч з OG-описом, який завжди all-time (розсинхрон у месенджерах).
// ⚠ Satori: КОЖЕН <div> із >1 дитиною мусить мати display:flex (пастка з HANDOFF).
export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const MEDALS = ['🥇', '🥈', '🥉'];

export default async function OgImage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await params;
  const v = validateHandle(decodeURIComponent(raw));
  const data = v.ok ? await getPublicPageCached(prisma, v.handle) : null;
  const [top3, cities] = data
    ? await Promise.all([leaderboard(prisma, data.userId, { limit: 3 }), mapPoints(prisma, data.userId)])
    : [[], []];

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
          backgroundImage: mapBackground(cities),
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          color: '#F3E9DF',
          fontFamily: 'Onest',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 56, fontWeight: 700, lineClamp: 2 }}>{data?.profile.name ?? 'GraMista'}</div>
          <div style={{ fontSize: 30, color: '#CDBCAB', marginTop: 8 }}>битва міст України — донать і виводь своє місто в топ</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {top3.map((c, i) => (
            <div key={c.settlementId} style={{ display: 'flex', fontSize: 36 }}>
              <div style={{ width: 64, display: 'flex' }}>{MEDALS[i]}</div>
              <div style={{ flex: 1, display: 'flex' }}>{c.name}</div>
              <div style={{ color: '#E2A878', display: 'flex' }}>{formatPoints(c.points)} б</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 34, color: '#E0B66B', display: 'flex' }}>
            {data ? `зібрано ${formatUah(data.totalAllTimeUah)}` : ''}
          </div>
          <div style={{ fontSize: 26, color: '#9A8979', display: 'flex' }}>GraMista</div>
        </div>
      </div>
    ),
    { ...size, fonts: ogFonts() },
  );
}
