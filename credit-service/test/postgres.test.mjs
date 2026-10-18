import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrateDatabase } from "../dist/db/migrate.js";
import { pool } from "../dist/db/index.js";
import { execute } from "../dist/credit/commands.js";
import { userEvent } from "../dist/credit/accounts.js";
import { balance, reservation, lookup } from "../dist/credit/queries.js";
const create = (id, eventId = randomUUID()) =>
  userEvent({
    type: "user.created",
    eventId,
    user: { id },
    version: 77,
  });
const command = (kind, orderId = randomUUID(), extra = {}) => ({
  kind,
  requestId: randomUUID(),
  correlationId: randomUUID(),
  orderId,
  ...(kind === "TRANSFER" ? { courierId: 2 } : { requesterId: 1, amount: 120 }),
  ...(kind === "RELEASE" ? { reason: "CANCELLED" } : {}),
  ...extra,
});
const count = async (table) =>
  Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
before(migrateDatabase);
beforeEach(async () => {
  await pool.query(
    "TRUNCATE credit_outbox,credit_transactions,credit_orders,credit_accounts CASCADE",
  );
});
after(async () => {
  await pool.end();
});
test("Drizzle adopts existing tables without changing financial history and migrates once", async () => {
  const allocationId = randomUUID();
  await create(1, allocationId);
  const reserve = command("RESERVE");
  await execute(reserve);
  const snapshot = async () =>
    Promise.all(
      [
        "credit_accounts",
        "credit_orders",
        "credit_transactions",
        "credit_outbox",
      ].map(
        async (table) =>
          (
            await pool.query(
              `SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS data FROM ${table} t`,
            )
          ).rows[0].data,
      ),
    );
  const before = await snapshot();
  const allocation = await lookup(allocationId);
  assert.equal(allocation.initial_grant, 1000);
  assert.equal(allocation.request_id, allocationId);
  assert.doesNotThrow(() => JSON.stringify(allocation));
  await pool.query("DELETE FROM drizzle.__drizzle_migrations");
  await Promise.all([migrateDatabase(), migrateDatabase()]);
  await migrateDatabase();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    await execute(reserve),
    await lookup(reserve.requestId).then((row) => row.result),
  );
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) FROM drizzle.__drizzle_migrations"))
        .rows[0].count,
    ),
    1,
  );
});
test("concurrent creation and duplicate source events grant exactly once", async () => {
  await userEvent({
    type: "user.updated",
    eventId: randomUUID(),
    user: { id: 1 },
  });
  const event = randomUUID();
  await Promise.all([
    create(1, event),
    create(1, event),
    ...Array.from({ length: 8 }, () => create(1)),
  ]);
  assert.deepEqual(await balance(1), {
    totalCredits: 1000,
    reservedCredits: 0,
    availableCredits: 1000,
  });
  for (const table of [
    "credit_accounts",
    "credit_orders",
    "credit_transactions",
    "credit_outbox",
  ])
    assert.equal(await count(table), 1);
});
test("deletion before creation is permanent; provisioned deletion retains history and allows release", async () => {
  await userEvent({
    type: "user.deleted",
    eventId: randomUUID(),
    userId: 9,
  });
  await create(9);
  assert.equal(await count("credit_orders"), 0);
  const first = (
    await pool.query("SELECT deleted_at FROM credit_accounts WHERE user_id=9")
  ).rows[0].deleted_at;
  await userEvent({
    type: "user.deleted",
    eventId: randomUUID(),
    userId: 9,
  });
  assert.deepEqual(
    (await pool.query("SELECT deleted_at FROM credit_accounts WHERE user_id=9"))
      .rows[0].deleted_at,
    first,
  );
  const inactive = command("RELEASE", randomUUID(), { requesterId: 9 });
  const rejection = await execute(inactive);
  assert.equal(rejection.code, "USER_INACTIVE");
  assert.equal(rejection.status, "REJECTED");
  assert.deepEqual(await execute(inactive), rejection);
  assert.deepEqual((await lookup(inactive.requestId)).result, rejection);
  assert.equal(await count("credit_transactions"), 0);
  assert.equal(await count("credit_outbox"), 1);
  await create(1);
  const reserve = command("RESERVE");
  await execute(reserve);
  await userEvent({
    type: "user.deleted",
    eventId: randomUUID(),
    userId: 1,
  });
  await assert.rejects(balance(1), { code: "USER_INACTIVE" });
  assert.equal(
    (await execute(command("RELEASE", reserve.orderId))).reservationState,
    "RELEASED",
  );
});
test("missing accounts never provision; transfer before reserve remains retryable", async () => {
  await assert.rejects(balance(1), { code: "ACCOUNT_PENDING" });
  await assert.rejects(execute(command("RESERVE")), {
    code: "ACCOUNT_PENDING",
  });
  await assert.rejects(execute(command("TRANSFER")), {
    code: "RESERVATION_NOT_READY",
  });
  assert.equal(await count("credit_accounts"), 0);
  assert.equal(await count("credit_orders"), 0);
});
test("concurrent reservations cannot overspend and rejected request replays original JSON", async () => {
  await create(1);
  const a = command("RESERVE", randomUUID(), { amount: 700 }),
    b = command("RESERVE", randomUUID(), { amount: 700 });
  const results = await Promise.all([execute(a), execute(b)]);
  assert.equal(results.filter((x) => x.applied).length, 1);
  assert.equal(
    results.filter((x) => x.code === "INSUFFICIENT_CREDITS").length,
    1,
  );
  const loser = results[0].applied ? b : a,
    winner = results[0].applied ? a : b;
  const rejected = await execute(loser);
  await execute(command("RELEASE", winner.orderId, { amount: 700 }));
  assert.deepEqual(await execute(loser), rejected);
  await assert.rejects(execute({ ...loser, amount: 1 }), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  assert.equal((await balance(1)).reservedCredits, 0);
});
test("same-ID success replays historical result and fresh-ID repeats create no movements", async () => {
  await Promise.all([create(1), create(2)]);
  const reserve = command("RESERVE");
  const original = await execute(reserve);
  assert.equal(
    (await execute(command("RESERVE", reserve.orderId))).applied,
    false,
  );
  const transfer = command("TRANSFER", reserve.orderId);
  assert.equal((await execute(transfer)).applied, true);
  assert.equal(
    (await execute(command("TRANSFER", reserve.orderId))).applied,
    false,
  );
  assert.deepEqual(await execute(reserve), original);
  assert.equal(
    (await reservation(reserve.orderId)).reservationState,
    "TRANSFERRED",
  );
  assert.deepEqual(await balance(1), {
    totalCredits: 880,
    reservedCredits: 0,
    availableCredits: 880,
  });
  assert.equal((await balance(2)).totalCredits, 1120);
  assert.equal(await count("credit_transactions"), 4);
});
test("cancellation without movement survives outbox archival and blocks delayed commands", async () => {
  await Promise.all([create(1), create(2)]);
  const release = command("RELEASE");
  const result = await execute(release);
  assert.equal(result.reservationState, "CANCELLED");
  assert.equal(result.applied, false);
  await pool.query("DELETE FROM credit_outbox");
  assert.equal(
    (await reservation(release.orderId)).reservationState,
    "CANCELLED",
  );
  assert.equal(
    (await execute(command("RESERVE", release.orderId))).code,
    "RESERVATION_CANCELLED",
  );
  assert.equal(
    (await execute(command("TRANSFER", release.orderId))).code,
    "RESERVATION_CANCELLED",
  );
  assert.equal(
    (await execute(command("RELEASE", release.orderId))).applied,
    false,
  );
  assert.equal(await count("credit_transactions"), 2);
});
test("both reserve/release arrival orders and concurrent transfer/release serialize", async () => {
  await Promise.all([create(1), create(2)]);
  for (const releaseFirst of [true, false]) {
    const id = randomUUID();
    const reserve = command("RESERVE", id),
      release = command("RELEASE", id);
    await execute(releaseFirst ? release : reserve);
    await execute(releaseFirst ? reserve : release);
    assert.equal(
      (await reservation(id)).reservationState,
      releaseFirst ? "CANCELLED" : "RELEASED",
    );
  }
  for (let i = 0; i < 12; i++) {
    const id = randomUUID();
    await execute(command("RESERVE", id, { amount: 10 }));
    const results = await Promise.all([
      execute(command("TRANSFER", id)),
      execute(command("RELEASE", id, { amount: 10 })),
    ]);
    assert.equal(results.filter((x) => x.applied).length, 1);
  }
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT sum(total_credits) AS supply FROM credit_accounts",
        )
      ).rows[0].supply,
    ),
    2000,
  );
  assert.equal((await balance(1)).reservedCredits, 0);
});
test("failure between debit and credit rolls back every financial write", async () => {
  await Promise.all([create(1), create(2)]);
  const reserve = command("RESERVE");
  await execute(reserve);
  const counts = await Promise.all(
    ["credit_orders", "credit_transactions", "credit_outbox"].map(count),
  );
  await pool.query(
    "CREATE FUNCTION credit_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id=2 THEN RAISE EXCEPTION 'injected courier failure'; END IF; RETURN NEW; END $$",
  );
  await pool.query(
    "CREATE TRIGGER credit_test_failure BEFORE UPDATE ON credit_accounts FOR EACH ROW EXECUTE FUNCTION credit_test_fail()",
  );
  const transfer = command("TRANSFER", reserve.orderId);
  try {
    await assert.rejects(
      execute(transfer),
      (error) => error.cause?.message === "injected courier failure",
    );
  } finally {
    await pool.query("DROP TRIGGER credit_test_failure ON credit_accounts");
    await pool.query("DROP FUNCTION credit_test_fail()");
  }
  assert.deepEqual(
    await Promise.all(
      ["credit_orders", "credit_transactions", "credit_outbox"].map(count),
    ),
    counts,
  );
  assert.equal((await balance(1)).reservedCredits, 120);
  assert.equal((await balance(2)).totalCredits, 1000);
  assert.equal((await execute(transfer)).applied, true);
});
test("provisioning failure rolls back account, allocation, movement and outbox", async () => {
  await pool.query(
    "CREATE FUNCTION credit_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected outbox failure'; END $$",
  );
  await pool.query(
    "CREATE TRIGGER credit_test_failure BEFORE INSERT ON credit_outbox FOR EACH ROW EXECUTE FUNCTION credit_test_fail()",
  );
  try {
    await assert.rejects(
      create(1),
      (error) => error.cause?.message === "injected outbox failure",
    );
  } finally {
    await pool.query("DROP TRIGGER credit_test_failure ON credit_outbox");
    await pool.query("DROP FUNCTION credit_test_fail()");
  }
  for (const table of [
    "credit_accounts",
    "credit_orders",
    "credit_transactions",
    "credit_outbox",
  ])
    assert.equal(await count(table), 0);
});
test("recipient overflow and self transfer reject atomically with exact safe JSON balances", async () => {
  await create(1);
  await userEvent(
    {
      type: "user.created",
      eventId: randomUUID(),
      user: { id: 2 },
    },
    9007199254740991n,
  );
  const reserve = command("RESERVE");
  await execute(reserve);
  assert.equal(
    (await execute(command("TRANSFER", reserve.orderId))).code,
    "BALANCE_LIMIT_EXCEEDED",
  );
  assert.equal(
    (await execute(command("TRANSFER", reserve.orderId, { courierId: 1 })))
      .code,
    "SELF_TRANSFER",
  );
  assert.equal((await balance(2)).totalCredits, Number.MAX_SAFE_INTEGER);
  assert.equal((await balance(1)).reservedCredits, 120);
});

test("simultaneous reserve and release settle once and history agrees with reserved balances", async () => {
  await create(1);
  for (let i = 0; i < 20; i++) {
    const id = randomUUID();
    await Promise.all([
      execute(command("RESERVE", id)),
      execute(command("RELEASE", id)),
    ]);
    assert.ok(
      ["RELEASED", "CANCELLED"].includes(
        (await reservation(id)).reservationState,
      ),
    );
  }
  assert.equal((await balance(1)).reservedCredits, 0);
  const rows = await pool.query(
    "SELECT order_id FROM credit_orders WHERE status='SUCCEEDED' GROUP BY order_id HAVING bool_or(kind='TRANSFER') AND bool_or(kind='RELEASE')",
  );
  assert.equal(rows.rowCount, 0);
  const held = await pool.query(
    "SELECT COALESCE(sum(t.amount),0) AS amount FROM credit_transactions t JOIN credit_orders o ON o.request_id=t.credit_order_request_id WHERE o.kind='RESERVE' AND NOT EXISTS(SELECT 1 FROM credit_orders s WHERE s.order_id=o.order_id AND s.status='SUCCEEDED' AND s.kind IN ('RELEASE','TRANSFER'))",
  );
  assert.equal(Number(held.rows[0].amount), 0);
});
test("mismatched reservation participants and amounts reject without changing hold", async () => {
  await Promise.all([create(1), create(2)]);
  const reserve = command("RESERVE");
  await execute(reserve);
  assert.equal(
    (await execute(command("RESERVE", reserve.orderId, { requesterId: 2 })))
      .code,
    "RESERVATION_MISMATCH",
  );
  assert.equal(
    (await execute(command("RELEASE", reserve.orderId, { amount: 121 }))).code,
    "RESERVATION_MISMATCH",
  );
  assert.equal((await balance(1)).reservedCredits, 120);
});
test("concurrent identical command retries store one result and reject malformed creation envelopes", async () => {
  await assert.rejects(
    userEvent({
      type: "user.created",
      eventId: randomUUID(),
      userId: 1,
    }),
    { code: "INVALID_EVENT" },
  );
  await assert.rejects(userEvent({ type: "user.updated" }), {
    code: "INVALID_EVENT",
  });
  await create(1);
  const reserve = command("RESERVE");
  const results = await Promise.all(
    Array.from({ length: 12 }, () => execute(reserve)),
  );
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(await count("credit_orders"), 2);
  assert.equal(await count("credit_transactions"), 2);
  assert.equal(await count("credit_outbox"), 2);
});

test("mixed-case UUIDs serialize one errand and replay one request", async () => {
  await create(1);
  const orderId = randomUUID();
  const reserve = command("RESERVE", orderId);
  const blocker = await pool.connect();
  const waiting = async (count) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const {
        rows: [row],
      } = await pool.query(
        "SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())",
      );
      if (row.waiting >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Commands did not reach serialization locks");
  };
  let reserveResult, releaseResult;
  await blocker.query("BEGIN");
  await blocker.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('account:1',0))",
  );
  try {
    reserveResult = execute(reserve);
    await waiting(1);
    releaseResult = execute(command("RELEASE", orderId.toUpperCase()));
    await waiting(2);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  const results = await Promise.all([reserveResult, releaseResult]);
  assert.equal(results[1].reservationState, "RELEASED");
  assert.equal((await balance(1)).reservedCredits, 0);
  assert.deepEqual(
    await execute({
      ...reserve,
      requestId: reserve.requestId.toUpperCase(),
      orderId: orderId.toUpperCase(),
    }),
    results[0],
  );
});

test("missing transfer recipient retries; deleted recipient rejects durably without moving credit", async () => {
  await create(1);
  const reserve = command("RESERVE");
  await execute(reserve);
  const transfer = command("TRANSFER", reserve.orderId);
  await assert.rejects(execute(transfer), { code: "ACCOUNT_PENDING" });
  await assert.rejects(lookup(transfer.requestId), {
    code: "OPERATION_NOT_FOUND",
  });
  await userEvent({ type: "user.deleted", eventId: randomUUID(), userId: 2 });
  const rejected = await execute(transfer);
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.code, "USER_INACTIVE");
  assert.equal(rejected.applied, false);
  assert.deepEqual(rejected.transactionIds, []);
  assert.deepEqual(rejected.deltas, {
    requesterTotal: 0,
    requesterReserved: 0,
    courierTotal: 0,
  });
  assert.deepEqual(await execute(transfer), rejected);
  assert.deepEqual(await balance(1), {
    totalCredits: 1000,
    reservedCredits: 120,
    availableCredits: 880,
  });
  assert.equal(await count("credit_transactions"), 2);
  assert.equal(await count("credit_outbox"), 3);
});
