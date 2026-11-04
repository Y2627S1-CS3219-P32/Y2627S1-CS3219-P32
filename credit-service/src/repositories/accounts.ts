import { eq, sql } from 'drizzle-orm';
import { lock, type Database, type Transaction } from '../db/index.js';
import { creditAccounts } from '../db/schema.js';
import type { Outcome } from '../common/types.js';

export async function findAccount(db: Database | Transaction, id: number) {
  const [account] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.user_id, id));
  return account;
}

export async function lockAccount(tx: Transaction, id: number) {
  await lock(tx, 'account', id);
  const [account] = await tx
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.user_id, id))
    .for('update');
  return account;
}

export async function createAccount(
  tx: Transaction,
  id: number,
  initialCredits: bigint,
) {
  await tx.insert(creditAccounts).values({
    user_id: id,
    total_credits: initialCredits,
    reserved_credits: 0n,
  });
}

export async function markDeleted(tx: Transaction, id: number) {
  await tx
    .insert(creditAccounts)
    .values({
      user_id: id,
      total_credits: 0n,
      reserved_credits: 0n,
      deleted_at: sql`now()`,
    })
    .onConflictDoUpdate({
      target: creditAccounts.user_id,
      set: {
        deleted_at: sql`COALESCE(${creditAccounts.deleted_at}, EXCLUDED.deleted_at)`,
        updated_at: sql`CASE WHEN ${creditAccounts.deleted_at} IS NULL THEN now() ELSE ${creditAccounts.updated_at} END`,
      },
    });
}

export async function applyBalanceChanges(
  tx: Transaction,
  requesterId: number,
  creditUserId: number,
  { requesterTotal, requesterReserved, courierTotal }: Outcome['deltas'],
) {
  await tx
    .update(creditAccounts)
    .set({
      total_credits: sql`${creditAccounts.total_credits} + ${BigInt(requesterTotal)}`,
      reserved_credits: sql`${creditAccounts.reserved_credits} + ${BigInt(requesterReserved)}`,
      updated_at: sql`now()`,
    })
    .where(eq(creditAccounts.user_id, requesterId));
  if (courierTotal)
    await tx
      .update(creditAccounts)
      .set({
        total_credits: sql`${creditAccounts.total_credits} + ${BigInt(courierTotal)}`,
        updated_at: sql`now()`,
      })
      .where(eq(creditAccounts.user_id, creditUserId));
}
