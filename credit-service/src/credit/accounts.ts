import { RESERVATION_STATE } from "./constants.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, lock, type Transaction } from "../db/index.js";
import {
  creditAccounts,
  creditOrders,
  creditTransactions,
} from "../db/schema.js";
import {
  CreditError,
  MAX,
  money,
  type Account,
  type Outcome,
} from "./types.js";
import { saveOrder } from "./orders.js";
import { enqueueOutcome } from "../events/outbox.js";

export function validateInitialCredits(initialCredits: bigint) {
  if (initialCredits <= 0n || initialCredits > MAX)
    throw new Error("INITIAL_CREDITS is outside safe integer bounds");
}

export async function lockAccounts(
  client: Transaction,
  ids: number[],
  allowDeleted: boolean,
): Promise<
  { active: true; accounts: Map<number, Account> } | { active: false }
> {
  const accounts = new Map<number, Account>();
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    await lock(client, "account", id);
    const [account] = await client
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.user_id, id))
      .for("update");
    if (!account) throw new CreditError(503, "ACCOUNT_PENDING");
    if (account.deleted_at) {
      const allocated =
        allowDeleted &&
        (
          await client
            .select({ user_id: creditOrders.user_id })
            .from(creditOrders)
            .where(
              and(
                eq(creditOrders.user_id, id),
                eq(creditOrders.kind, "ALLOCATE"),
                eq(creditOrders.status, "SUCCEEDED"),
              ),
            )
        ).length;
      if (!allocated) return { active: false };
    }
    accounts.set(id, account);
  }
  return { active: true, accounts };
}

export async function userEvent(event: unknown, initialCredits = 1000n) {
  validateInitialCredits(initialCredits);
  if (
    typeof event !== "object" ||
    !event ||
    !("type" in event) ||
    typeof event.type !== "string"
  )
    throw new CreditError(400, "INVALID_EVENT");
  if (!["user.created", "user.deleted", "user.updated"].includes(event.type))
    throw new CreditError(400, "INVALID_EVENT");
  if (
    !("eventId" in event) ||
    typeof event.eventId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      event.eventId,
    )
  )
    throw new CreditError(400, "INVALID_EVENT");
  const id =
    event.type !== "user.deleted"
      ? "user" in event &&
        typeof event.user === "object" &&
        event.user &&
        "id" in event.user
        ? event.user.id
        : undefined
      : "userId" in event
        ? event.userId
        : undefined;
  if (
    typeof id !== "number" ||
    !Number.isInteger(id) ||
    id <= 0 ||
    id > 2147483647
  )
    throw new CreditError(400, "INVALID_EVENT");
  if (event.type === "user.updated") return;
  const requestId = event.eventId.toLowerCase();
  await db.transaction(async (client) => {
    await lock(client, "request", requestId);
    await lock(client, "account", id);
    if (event.type === "user.deleted") {
      await client
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
      return;
    }
    if (
      (
        await client
          .select({ user_id: creditAccounts.user_id })
          .from(creditAccounts)
          .where(eq(creditAccounts.user_id, id))
      ).length
    )
      return;
    if (
      (
        await client
          .select({ request_id: creditOrders.request_id })
          .from(creditOrders)
          .where(eq(creditOrders.request_id, requestId))
      ).length
    )
      throw new CreditError(409, "IDEMPOTENCY_CONFLICT");
    await client.insert(creditAccounts).values({
      user_id: id,
      total_credits: initialCredits,
      reserved_credits: 0n,
    });
    const transactionId = randomUUID(),
      amount = money(initialCredits);
    const result: Outcome = {
      requestId,
      status: "SUCCEEDED",
      httpStatus: 200,
      code: "OK",
      reservationState: RESERVATION_STATE.NONE,
      applied: true,
      transactionIds: [transactionId],
      requesterId: id,
      amount,
      deltas: {
        requesterTotal: amount,
        requesterReserved: 0,
        courierTotal: 0,
      },
    };
    await saveOrder(client, {
      requestId,
      kind: "ALLOCATE",
      payload: { userId: id },
      userId: id,
      correlationId: requestId,
      result,
      grant: initialCredits,
    });
    await client.insert(creditTransactions).values({
      transaction_id: transactionId,
      credit_order_request_id: requestId,
      credit_user_id: id,
      debit_bucket: "ISSUANCE",
      credit_bucket: "AVAILABLE",
      amount: initialCredits,
    });
    await enqueueOutcome(client, "ALLOCATE", requestId, result);
  });
}
