import { randomUUID } from "node:crypto";
import type pg from "pg";
import { transaction, lock } from "../db/index.js";
import { CreditError, MAX, money, type Account, type Outcome } from "./types.js";
import { saveOrder } from "./orders.js";
import { enqueueOutcome } from "../events/outbox.js";

export function validateInitialCredits(initialCredits: bigint) {
  if (initialCredits <= 0n || initialCredits > MAX)
    throw new Error("INITIAL_CREDITS is outside safe integer bounds");
}

export async function lockAccounts(
  client: pg.PoolClient,
  ids: number[],
  allowDeleted: boolean,
) {
  const accounts = new Map<number, Account>();
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    await lock(client, "account", id);
    const {
      rows: [account],
    } = await client.query<Account>(
      "SELECT * FROM credit_accounts WHERE user_id=$1 FOR UPDATE",
      [id],
    );
    if (!account) throw new CreditError(503, "ACCOUNT_PENDING");
    if (account.deleted_at) {
      const allocated =
        allowDeleted &&
        (
          await client.query(
            "SELECT 1 FROM credit_orders WHERE user_id=$1 AND kind='ALLOCATE' AND status='SUCCEEDED'",
            [id],
          )
        ).rowCount;
      if (!allocated) throw new CreditError(403, "USER_INACTIVE");
    }
    accounts.set(id, account);
  }
  return accounts;
}

export async function userEvent(
  event: unknown,
  initialCredits = 1000n,
) {
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
  await transaction(async (client) => {
    await lock(client, "request", requestId);
    await lock(client, "account", id);
    if (event.type === "user.deleted") {
      await client.query(
        "INSERT INTO credit_accounts(user_id,total_credits,reserved_credits,deleted_at) VALUES($1,0,0,now()) ON CONFLICT(user_id) DO UPDATE SET deleted_at=COALESCE(credit_accounts.deleted_at,EXCLUDED.deleted_at),updated_at=CASE WHEN credit_accounts.deleted_at IS NULL THEN now() ELSE credit_accounts.updated_at END",
        [id],
      );
      return;
    }
    if (
      (
        await client.query("SELECT 1 FROM credit_accounts WHERE user_id=$1", [
          id,
        ])
      ).rowCount
    )
      return;
    if (
      (
        await client.query(
          "SELECT 1 FROM credit_orders WHERE request_id=$1",
          [requestId],
        )
      ).rowCount
    )
      throw new CreditError(409, "IDEMPOTENCY_CONFLICT");
    await client.query(
      "INSERT INTO credit_accounts(user_id,total_credits,reserved_credits) VALUES($1,$2,0)",
      [id, initialCredits.toString()],
    );
    const transactionId = randomUUID(),
      amount = money(initialCredits);
    const result: Outcome = {
      requestId,
      status: "SUCCEEDED",
      httpStatus: 200,
      code: "OK",
      reservationState: "NONE",
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
    await client.query(
      "INSERT INTO credit_transactions(transaction_id,credit_order_request_id,credit_user_id,debit_bucket,credit_bucket,amount) VALUES($1,$2,$3,'ISSUANCE','AVAILABLE',$4)",
      [transactionId, requestId, id, initialCredits.toString()],
    );
    await enqueueOutcome(client, "ALLOCATE", requestId, result);
  });
}
