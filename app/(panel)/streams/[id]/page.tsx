import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { getStream, streamReportText } from '@/lib/streams';
import { listCollectionOptions } from '@/lib/collections';
import { formatUah, formatPoints, formatDateTime, formatDuration, pluralBaliv } from '@/lib/format';
import { ConfirmSubmit } from '@/app/ConfirmSubmit';
import { CopyButton } from '@/app/CopyButton';
import { ReportExport } from './ReportExport';
import { updateStreamAction, deleteStreamAction } from '../actions';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const U = await requireUserId();
    const s = await prisma.stream.findFirst({ where: { id, userId: U }, select: { name: true } });
    return { title: s?.name ? `Стрім · ${s.name}` : 'Стрім' };
  } catch {
    return { title: 'Стрім' };
  }
}

// Date → значення для <input type="datetime-local"> у локальному часі (не UTC).
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function StreamDetail({ params }: { params: Promise<{ id: string }> }) {
  const U = await requireUserId();
  const { id } = await params;
  const [data, collOptions, meta] = await Promise.all([
    getStream(prisma, U, id),
    listCollectionOptions(prisma, U),
    prisma.stream.findFirst({ where: { id, userId: U }, select: { collectionId: true } }),
  ]);
  if (!data) notFound();
  const { summary: s, cities } = data;
  const maxPts = cities[0]?.points ?? 1;
  const currentCollectionId = meta?.collectionId ?? '';
  const report = streamReportText(s);

  return (
    <div className="tab">
      <section className="card donations-card">
        <div className="card-head">
          <div className="card-title">
            <Link href="/streams" className="back-link">
              ← Стріми
            </Link>
            <span className="ic">🎬</span> {s.name}
            {!s.endedAt && <span className="live-tag">● у ефірі</span>}
            {s.url && (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="stream-link" title={s.url}>
                ↗ дивитись
              </a>
            )}
          </div>
          <div className="card-hint">
            {formatDateTime(s.startedAt.getTime())}
            {s.endedAt ? ` – ${formatDateTime(s.endedAt.getTime())}` : ''}
          </div>
        </div>

        <div className="stream-summary">
          <div className="sumbox">
            <span className="sb-val accent">{formatUah(s.sumUah)}</span>
            <span className="sb-lbl">зібрано</span>
          </div>
          <div className="sumbox">
            <span className="sb-val">{s.donations}</span>
            <span className="sb-lbl">донатів</span>
          </div>
          <div className="sumbox">
            <span className="sb-val">
              {formatPoints(s.points)} <em>{pluralBaliv(s.points)}</em>
            </span>
            <span className="sb-lbl">балів містам</span>
          </div>
          <div className="sumbox">
            <span className="sb-val">{formatDuration(s.durationMs)}</span>
            <span className="sb-lbl">тривалість</span>
          </div>
        </div>

        <div className="stream-grid">
          {/* Топ міст стріму */}
          <div className="stream-col">
            <div className="col-title">🏆 Топ міст стріму</div>
            <div className="top-list scroll stream-top">
              {cities.length === 0 ? (
                <div className="empty">У цьому стрімі міста не отримали балів.</div>
              ) : (
                cities.map((c, i) => {
                  const rank = i + 1;
                  const medal = rank <= 3 ? ` medal r${rank}` : '';
                  return (
                    <div className={`row${medal}`} key={c.settlementId}>
                      <div className="rank">{rank}</div>
                      <div className="city">{c.name}</div>
                      <div className="pts">
                        {formatPoints(c.points)} <em>{pluralBaliv(c.points)}</em>
                      </div>
                      <div className="bar">
                        <i style={{ width: `${Math.max(4, (c.points / maxPts) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Редагування */}
          <div className="stream-col stream-side">
            <div className="col-title">✏️ Редагувати</div>
            <form action={updateStreamAction} className="edit-form">
              <input type="hidden" name="id" value={s.id} />
              <label className="ef-row">
                <span>Назва</span>
                <input type="text" name="name" defaultValue={s.name} className="fld" maxLength={120} />
              </label>
              <label className="ef-row">
                <span>Посилання</span>
                <input
                  type="text"
                  name="url"
                  defaultValue={s.url ?? ''}
                  className="fld"
                  placeholder="https://twitch.tv/… (порожнє — прибрати)"
                  maxLength={500}
                />
              </label>
              <label className="ef-row">
                <span>Початок</span>
                <input
                  type="datetime-local"
                  name="startedAt"
                  defaultValue={toLocalInput(s.startedAt)}
                  className="fld"
                />
              </label>
              <label className="ef-row">
                <span>Кінець</span>
                <input
                  type="datetime-local"
                  name="endedAt"
                  defaultValue={s.endedAt ? toLocalInput(s.endedAt) : ''}
                  className="fld"
                />
              </label>
              <label className="ef-row">
                <span>Збір</span>
                <select name="collectionId" defaultValue={currentCollectionId} className="fld">
                  <option value="">— без збору —</option>
                  {collOptions.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                      {c.status === 'completed' ? ' (завершено)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ef-row">
                <span>Нотатки</span>
                <textarea
                  name="notes"
                  defaultValue={s.notes ?? ''}
                  className="fld"
                  rows={3}
                  placeholder="приватні нотатки про стрім…"
                  maxLength={2000}
                />
              </label>
              <button type="submit" className="btn-find">
                Зберегти зміни
              </button>
            </form>

            {/* Звіт-пост для публікації */}
            <div className="report-box">
              <div className="col-title">📋 Звіт-пост</div>
              <pre className="report-text">{report}</pre>
              <div className="report-actions">
                <CopyButton text={report} label="Копіювати звіт" />
              </div>
              <ReportExport basePath={`/streams/${s.id}/report-image`} />
            </div>

            <form action={deleteStreamAction} className="delete-form">
              <input type="hidden" name="id" value={s.id} />
              <ConfirmSubmit
                className="btn-danger"
                message={`Видалити стрім «${s.name}»? Донати й бали залишаться, але відв'яжуться від стріму.`}
              >
                🗑 Видалити стрім
              </ConfirmSubmit>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
