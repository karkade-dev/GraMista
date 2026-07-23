import { Prisma, type PrismaClient } from '@prisma/client';
import { recomputeDonorCityChain } from './scoring';

// Журнал дій оператора в Адмінці (§17.5): аудит + відкат ОБОРОТНИХ дій.
// Записи створюються ВСЕРЕДИНІ транзакції самої дії (recordAdminAction) — атомарно з ефектом.
// Відкат (undoAdminAction) виконує зворотну операцію й позначає запис undoneAt.
// Скидання балів (resetCity/resetAll) логуються, але незворотні (undoable=false) — знищують дані.

type Tx = Prisma.TransactionClient;

export type AdminActionType =
  | 'assignCity'
  | 'reassignCity'
  | 'assignCityBulk'
  | 'adjustPoints'
  | 'addAlias'
  | 'resetCity'
  | 'resetAll'
  // Вивести/повернути окремий донат у гру (поштучно, оборотно).
  | 'setDonationGame'
  // Дії адміна СЕРВІСУ (не плутати з Адмінкою стрімера). Тривіально оборотні тим самим
  // екраном — undoable=false.
  | 'setFeaturedCollection'
  | 'setParticipantVisibility'; // сховати/показати стрімера на /ukraine (модерація)

/** Запис у журнал (у межах транзакції дії). payload — дані для відкату, специфічні для типу. */
export async function recordAdminAction(
  tx: Tx,
  userId: string,
  a: { type: AdminActionType; summary: string; payload: Record<string, unknown>; undoable: boolean },
): Promise<void> {
  await tx.adminAction.create({
    data: {
      userId,
      type: a.type,
      summary: a.summary,
      payload: a.payload as Prisma.InputJsonValue,
      undoable: a.undoable,
    },
  });
}

export interface AdminActionRow {
  id: string;
  type: AdminActionType;
  summary: string;
  /** Чи підтримує відкат у принципі (false для скидань). */
  undoable: boolean;
  /** Чи вже відкочено. */
  undone: boolean;
  at: number;
}

/** Журнал дій (новіші — спершу) для відображення в Адмінці. */
export async function listAdminActions(
  db: PrismaClient,
  userId: string,
  limit = 50,
): Promise<AdminActionRow[]> {
  const rows = await db.adminAction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type as AdminActionType,
    summary: r.summary,
    undoable: r.undoable,
    undone: r.undoneAt !== null,
    at: r.createdAt.getTime(),
  }));
}

export type UndoResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'already_undone' | 'not_undoable' | 'stale' };

/**
 * Відкат дії з журналу. Перевіряє, що поточний стан ще відповідає дії (інакше 'stale' —
 * стан змінився пізнішими діями, безпечно не чіпаємо). Усе атомарно; позначає undoneAt.
 */
export async function undoAdminAction(
  db: PrismaClient,
  userId: string,
  id: string,
): Promise<UndoResult> {
  return db.$transaction(async (tx) => {
    const a = await tx.adminAction.findUnique({ where: { id } });
    if (!a || a.userId !== userId) return { ok: false, reason: 'not_found' };
    if (a.undoneAt) return { ok: false, reason: 'already_undone' };
    if (!a.undoable) return { ok: false, reason: 'not_undoable' };

    const p = (a.payload ?? {}) as Record<string, string | string[]>;
    let done = false;
    switch (a.type as AdminActionType) {
      case 'assignCity':
        done = await undoAssign(tx, userId, p.externalId as string, p.settlementId as string);
        break;
      case 'reassignCity':
        done = await undoReassign(tx, userId, p.externalId as string, p.fromSettlementId as string, p.toSettlementId as string);
        break;
      case 'assignCityBulk':
        done = await undoBulk(tx, userId, p.externalIds as string[], p.settlementId as string);
        break;
      case 'adjustPoints':
        done = await undoAdjust(tx, userId, p.pointEventId as string);
        break;
      case 'addAlias':
        done = await undoAlias(tx, p.aliasId as string);
        break;
      case 'setDonationGame':
        done = await undoSetGame(tx, userId, p.externalId as string, p.from as string, p.to as string, p.settlementId as string | null);
        break;
      default:
        return { ok: false, reason: 'not_undoable' };
    }
    if (!done) return { ok: false, reason: 'stale' };
    await tx.adminAction.update({ where: { id }, data: { undoneAt: new Date() } });
    return { ok: true };
  });
}

// — Зворотні операції (повертають false, якщо стан змінився й відкат недоречний) —

/** Відкат призначення міста: донат → знову нерозпізнаний, перерахунок пари (донатер, місто). */
async function undoAssign(tx: Tx, userId: string, externalId: string, settlementId: string): Promise<boolean> {
  const d = await tx.donation.findUnique({ where: { userId_externalId: { userId, externalId } } });
  if (!d || d.status !== 'recognized' || d.settlementId !== settlementId) return false;
  await tx.donation.update({
    where: { id: d.id },
    data: { status: 'unrecognized', settlementId: null, pointsAwarded: new Prisma.Decimal(0) },
  });
  await recomputeDonorCityChain(tx, userId, d.donorName, settlementId, d.collectionId);
  return true;
}

/** Відкат зміни міста: повернути донат у попереднє місто, перерахувати обидві пари. */
async function undoReassign(tx: Tx, userId: string, externalId: string, from: string, to: string): Promise<boolean> {
  const d = await tx.donation.findUnique({ where: { userId_externalId: { userId, externalId } } });
  if (!d || d.status !== 'recognized' || d.settlementId !== to) return false;
  await tx.donation.update({ where: { id: d.id }, data: { settlementId: from } });
  await recomputeDonorCityChain(tx, userId, d.donorName, to, d.collectionId);
  await recomputeDonorCityChain(tx, userId, d.donorName, from, d.collectionId);
  return true;
}

/** Відкат масового призначення: повернути в нерозпізнані ті, що ще recognized→місто, перерахувати. */
async function undoBulk(tx: Tx, userId: string, externalIds: string[], settlementId: string): Promise<boolean> {
  // Ланцюг перерахунку — per-збір, тож збираємо пари «донатер → збір» (а не лише імена).
  const donors = new Map<string, string | null>();
  let reverted = 0;
  for (const externalId of externalIds) {
    const d = await tx.donation.findUnique({ where: { userId_externalId: { userId, externalId } } });
    if (!d || d.status !== 'recognized' || d.settlementId !== settlementId) continue;
    await tx.donation.update({
      where: { id: d.id },
      data: { status: 'unrecognized', settlementId: null, pointsAwarded: new Prisma.Decimal(0) },
    });
    donors.set(d.donorName, d.collectionId);
    reverted++;
  }
  for (const [donor, collectionId] of donors) {
    await recomputeDonorCityChain(tx, userId, donor, settlementId, collectionId);
  }
  return reverted > 0;
}

/** Відкат ручного коригування балів: прибрати створену admin-подію (ідемпотентно). */
async function undoAdjust(tx: Tx, userId: string, pointEventId: string): Promise<boolean> {
  // Якщо подію вже видалено (напр. скиданням) — ефект і так знятий; відкат успішний.
  await tx.pointEvent.deleteMany({ where: { id: pointEventId, userId } });
  return true;
}

/** Відкат додавання синоніма: прибрати створений аліас (ідемпотентно). */
async function undoAlias(tx: Tx, aliasId: string): Promise<boolean> {
  await tx.settlementAlias.deleteMany({ where: { id: aliasId } });
  return true;
}

/** Відкат виведення/повернення донату в гру: повернути попередню позначку + перерахунок пари (якщо є місто). */
async function undoSetGame(tx: Tx, userId: string, externalId: string, from: string, to: string, settlementId: string | null): Promise<boolean> {
  const d = await tx.donation.findUnique({ where: { userId_externalId: { userId, externalId } } });
  const toBool = to === 'true';
  const fromBool = from === 'true';
  if (!d || d.settlementId !== settlementId || d.outOfGame !== toBool) return false; // стан змінився пізніше
  await tx.donation.update({
    where: { id: d.id },
    data: { outOfGame: fromBool, ...(fromBool ? { pointsAwarded: new Prisma.Decimal(0) } : {}) },
  });
  if (settlementId) await recomputeDonorCityChain(tx, userId, d.donorName, settlementId, d.collectionId);
  return true;
}
