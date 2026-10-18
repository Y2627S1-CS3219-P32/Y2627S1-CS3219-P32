import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrateDatabase } from "../dist/db/migrate.js";
import { pool } from "../dist/db/index.js";
import { reserveCredits, releaseCredits, transferCredits } from "../dist/services/credits.js";
import { initializeAccount, deactivateAccount } from "../dist/services/accounts.js";
import { getBalance as balance, getReservation as reservation, getCreditOperation as lookup } from "../dist/services/reads.js";
import { config } from "../dist/config.js";
const create = (userId, requestId = randomUUID()) =>
  initializeAccount({ requestId, userId });
const runOperation = ({ kind, ...input }) => {
  switch (kind) {
    case "RESERVE": return reserveCredits(input);
    case "RELEASE": return releaseCredits(input);
    case "TRANSFER": return transferCredits(input);
    default: throw new Error(`Unknown operation ${kind}`);
  }
};
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
test("Repeated and concurrent migrations preserve financial history and run once", async () => {
  const allocationId = randomUUID();
  await create(1, allocationId);
  const reserve = command("RESERVE");
  await runOperation(reserve);
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
  await Promise.all([migrateDatabase(), migrateDatabase()]);
  await migrateDatabase();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    await runOperation(reserve),
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
test("concurrent initialization and duplicate requests grant exactly once", async () => {
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
  await deactivateAccount({ requestId: randomUUID(), userId: 9 });
  await create(9);
  assert.equal(await count("credit_orders"), 0);
  const first = (
    await pool.query("SELECT deleted_at FROM credit_accounts WHERE user_id=9")
  ).rows[0].deleted_at;
  await deactivateAccount({ requestId: randomUUID(), userId: 9 });
  assert.deepEqual(
    (await pool.query("SELECT deleted_at FROM credit_accounts WHERE user_id=9"))
      .rows[0].deleted_at,
    first,
  );
  const inactive = command("RELEASE", randomUUID(), { requesterId: 9 });
  const rejection = await runOperation(inactive);
  assert.equal(rejection.code, "USER_INACTIVE");
  assert.equal(rejection.status, "REJECTED");
  assert.deepEqual(await runOperation(inactive), rejection);
  assert.deepEqual((await lookup(inactive.requestId)).result, rejection);
  assert.equal(await count("credit_transactions"), 0);
  assert.equal(await count("credit_outbox"), 1);
  await create(1);
  const reserve = command("RESERVE");
  await runOperation(reserve);
  await deactivateAccount({ requestId: randomUUID(), userId: 1 });
  await assert.rejects(balance(1), { code: "USER_INACTIVE" });
  assert.equal(
    (await runOperation(command("RELEASE", reserve.orderId))).reservationState,
    "RELEASED",
  );
});
test("missing accounts never provision; transfer before reserve remains retryable", async () => {
  await assert.rejects(balance(1), { code: "ACCOUNT_PENDING" });
  await assert.rejects(runOperation(command("RESERVE")), {
    code: "ACCOUNT_PENDING",
  });
  await assert.rejects(runOperation(command("TRANSFER")), {
    code: "RESERVATION_NOT_READY",
  });
  assert.equal(await count("credit_accounts"), 0);
  assert.equal(await count("credit_orders"), 0);
});
test("concurrent reservations cannot overspend and rejected request replays original JSON", async () => {
  await create(1);
  const a = command("RESERVE", randomUUID(), { amount: 700 }),
    b = command("RESERVE", randomUUID(), { amount: 700 });
  const results = await Promise.all([runOperation(a), runOperation(b)]);
  assert.equal(results.filter((x) => x.applied).length, 1);
  assert.equal(
    results.filter((x) => x.code === "INSUFFICIENT_CREDITS").length,
    1,
  );
  const loser = results[0].applied ? b : a,
    winner = results[0].applied ? a : b;
  const rejected = await runOperation(loser);
  await runOperation(command("RELEASE", winner.orderId, { amount: 700 }));
  assert.deepEqual(await runOperation(loser), rejected);
  await assert.rejects(runOperation({ ...loser, amount: 1 }), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  assert.equal((await balance(1)).reservedCredits, 0);
});
test("same-ID success replays historical result and fresh-ID repeats create no movements", async () => {
  await Promise.all([create(1), create(2)]);
  const reserve = command("RESERVE");
  const original = await runOperation(reserve);
  assert.equal(
    (await runOperation(command("RESERVE", reserve.orderId))).applied,
    false,
  );
  const transfer = command("TRANSFER", reserve.orderId);
  assert.equal((await runOperation(transfer)).applied, true);
  assert.equal(
    (await runOperation(command("TRANSFER", reserve.orderId))).applied,
    false,
  );
  assert.deepEqual(await runOperation(reserve), original);
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
  const result = await runOperation(release);
  assert.equal(result.reservationState, "CANCELLED");
  assert.equal(result.applied, false);
  await pool.query("DELETE FROM credit_outbox");
  assert.equal(
    (await reservation(release.orderId)).reservationState,
    "CANCELLED",
  );
  assert.equal(
    (await runOperation(command("RESERVE", release.orderId))).code,
    "RESERVATION_CANCELLED",
  );
  assert.equal(
    (await runOperation(command("TRANSFER", release.orderId))).code,
    "RESERVATION_CANCELLED",
  );
  assert.equal(
    (await runOperation(command("RELEASE", release.orderId))).applied,
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
    await runOperation(releaseFirst ? release : reserve);
    await runOperation(releaseFirst ? reserve : release);
    assert.equal(
      (await reservation(id)).reservationState,
      releaseFirst ? "CANCELLED" : "RELEASED",
    );
  }
  for (let i = 0; i < 12; i++) {
    const id = randomUUID();
    await runOperation(command("RESERVE", id, { amount: 10 }));
    const results = await Promise.all([
      runOperation(command("TRANSFER", id)),
      runOperation(command("RELEASE", id, { amount: 10 })),
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
  await runOperation(reserve);
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
      runOperation(transfer),
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
  assert.equal((await runOperation(transfer)).applied, true);
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
  const originalGrant = config.initialCredits;
  try {
    config.initialCredits = 9007199254740991n;
    await create(2);
  } finally {
    config.initialCredits = originalGrant;
  }
  const reserve = command("RESERVE");
  await runOperation(reserve);
  assert.equal(
    (await runOperation(command("TRANSFER", reserve.orderId))).code,
    "BALANCE_LIMIT_EXCEEDED",
  );
  assert.equal(
    (await runOperation(command("TRANSFER", reserve.orderId, { courierId: 1 })))
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
      runOperation(command("RESERVE", id)),
      runOperation(command("RELEASE", id)),
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
  await runOperation(reserve);
  assert.equal(
    (await runOperation(command("RESERVE", reserve.orderId, { requesterId: 2 })))
      .code,
    "RESERVATION_MISMATCH",
  );
  assert.equal(
    (await runOperation(command("RELEASE", reserve.orderId, { amount: 121 }))).code,
    "RESERVATION_MISMATCH",
  );
  assert.equal((await balance(1)).reservedCredits, 120);
});
test("concurrent identical command retries store one result", async () => {
  await create(1);
  const reserve = command("RESERVE");
  const results = await Promise.all(
    Array.from({ length: 12 }, () => runOperation(reserve)),
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
    reserveResult = runOperation(reserve);
    await waiting(1);
    releaseResult = runOperation(command("RELEASE", orderId.toUpperCase()));
    await waiting(2);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  const results = await Promise.all([reserveResult, releaseResult]);
  assert.equal(results[1].reservationState, "RELEASED");
  assert.equal((await balance(1)).reservedCredits, 0);
  assert.deepEqual(
    await runOperation({
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
  await runOperation(reserve);
  const transfer = command("TRANSFER", reserve.orderId);
  await assert.rejects(runOperation(transfer), { code: "ACCOUNT_PENDING" });
  await assert.rejects(lookup(transfer.requestId), {
    code: "OPERATION_NOT_FOUND",
  });
  await deactivateAccount({ requestId: randomUUID(), userId: 2 });
  const rejected = await runOperation(transfer);
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.code, "USER_INACTIVE");
  assert.equal(rejected.applied, false);
  assert.deepEqual(rejected.transactionIds, []);
  assert.deepEqual(rejected.deltas, {
    requesterTotal: 0,
    requesterReserved: 0,
    courierTotal: 0,
  });
  assert.deepEqual(await runOperation(transfer), rejected);
  assert.deepEqual(await balance(1), {
    totalCredits: 1000,
    reservedCredits: 120,
    availableCredits: 880,
  });
  assert.equal(await count("credit_transactions"), 2);
  assert.equal(await count("credit_outbox"), 3);
});

for (const [initial, kind, code, next, deltas] of [
  ["NONE", "RESERVE", "OK", "HELD", [0, 120, 0]],
  ["NONE", "RELEASE", "OK", "CANCELLED"],
  ["NONE", "TRANSFER", "RESERVATION_NOT_READY", "NONE"],
  ["HELD", "RESERVE", "OK", "HELD"],
  ["HELD", "RELEASE", "OK", "RELEASED", [0, -120, 0]],
  ["HELD", "TRANSFER", "OK", "TRANSFERRED", [-120, -120, 120]],
  ["CANCELLED", "RESERVE", "RESERVATION_CANCELLED", "CANCELLED"],
  ["CANCELLED", "RELEASE", "OK", "CANCELLED"],
  ["CANCELLED", "TRANSFER", "RESERVATION_CANCELLED", "CANCELLED"],
  ["RELEASED", "RESERVE", "RESERVATION_SETTLED", "RELEASED"],
  ["RELEASED", "RELEASE", "OK", "RELEASED"],
  ["RELEASED", "TRANSFER", "RESERVATION_SETTLED", "RELEASED"],
  ["TRANSFERRED", "RESERVE", "RESERVATION_SETTLED", "TRANSFERRED"],
  ["TRANSFERRED", "RELEASE", "RESERVATION_SETTLED", "TRANSFERRED"],
  ["TRANSFERRED", "TRANSFER", "OK", "TRANSFERRED"],
]) {
  test(`${kind} against ${initial} preserves its outcome and financial effects`, async () => {
    await Promise.all([create(1), create(2)]);
    const orderId = randomUUID();
    if (["HELD", "RELEASED", "TRANSFERRED"].includes(initial))
      await runOperation(command("RESERVE", orderId));
    if (["CANCELLED", "RELEASED"].includes(initial))
      await runOperation(command("RELEASE", orderId));
    if (initial === "TRANSFERRED")
      await runOperation(command("TRANSFER", orderId));
    const before = await Promise.all([balance(1), balance(2)]);
    const movements = await count("credit_transactions");
    const request = command(kind, orderId);
    if (code === "RESERVATION_NOT_READY") {
      await assert.rejects(runOperation(request), { code });
      await assert.rejects(lookup(request.requestId), {
        code: "OPERATION_NOT_FOUND",
      });
      await assert.rejects(reservation(orderId), {
        code: "RESERVATION_NOT_FOUND",
      });
    } else {
      const result = await runOperation(request);
      assert.equal(result.code, code);
      assert.equal(result.status, code === "OK" ? "SUCCEEDED" : "REJECTED");
      assert.equal(result.httpStatus, code === "OK" ? 200 : 409);
      assert.equal(result.reservationState, next);
      assert.equal(result.applied, Boolean(deltas));
      assert.equal(result.transactionIds.length, deltas ? 1 : 0);
      assert.deepEqual(result.deltas, {
        requesterTotal: deltas?.[0] ?? 0,
        requesterReserved: deltas?.[1] ?? 0,
        courierTotal: deltas?.[2] ?? 0,
      });
      assert.deepEqual((await lookup(request.requestId)).result, result);
      assert.deepEqual(await runOperation(request), result);
      assert.equal((await reservation(orderId)).reservationState, next);
      const { rows: entries } = await pool.query(
        "SELECT debit_user_id, credit_user_id, debit_bucket, credit_bucket, amount FROM credit_transactions WHERE credit_order_request_id=$1",
        [request.requestId],
      );
      const [debit, credit, recipient] = {
        RESERVE: ["AVAILABLE", "RESERVED", 1],
        RELEASE: ["RESERVED", "AVAILABLE", 1],
        TRANSFER: ["RESERVED", "AVAILABLE", 2],
      }[kind];
      assert.deepEqual(entries, deltas ? [{
        debit_user_id: 1,
        credit_user_id: recipient,
        debit_bucket: debit,
        credit_bucket: credit,
        amount: "120",
      }] : []);
      const { rows: events } = await pool.query(
        "SELECT payload FROM credit_outbox WHERE request_id=$1",
        [request.requestId],
      );
      assert.deepEqual(events[0].payload.data, result);
    }
    const [requester, courier] = await Promise.all([balance(1), balance(2)]);
    assert.equal(requester.totalCredits, before[0].totalCredits + (deltas?.[0] ?? 0));
    assert.equal(requester.reservedCredits, before[0].reservedCredits + (deltas?.[1] ?? 0));
    assert.equal(courier.totalCredits, before[1].totalCredits + (deltas?.[2] ?? 0));
    assert.equal(await count("credit_transactions"), movements + (deltas ? 1 : 0));
  });
}

test("account and participant guards precede settlement checks while historical replay survives deletion", async () => {
  await Promise.all([create(1), create(2)]);
  const cancelled = command("RELEASE");
  await runOperation(cancelled);
  const reserve = command("RESERVE");
  const original = await runOperation(reserve);
  await runOperation(command("TRANSFER", reserve.orderId));
  for (const orderId of [cancelled.orderId, reserve.orderId]) {
    const missingCourier = command("TRANSFER", orderId, { courierId: 3 });
    await assert.rejects(runOperation(missingCourier), { code: "ACCOUNT_PENDING" });
    await assert.rejects(lookup(missingCourier.requestId), {
      code: "OPERATION_NOT_FOUND",
    });
  }
  assert.equal(
    (await runOperation(command("TRANSFER", cancelled.orderId, { courierId: 1 }))).code,
    "SELF_TRANSFER",
  );
  await deactivateAccount({ requestId: randomUUID(), userId: 2 });
  const inactive = command("RESERVE", cancelled.orderId, { requesterId: 2 });
  const rejected = await runOperation(inactive);
  assert.equal(rejected.code, "USER_INACTIVE");
  assert.deepEqual((await lookup(inactive.requestId)).result, rejected);
  await deactivateAccount({ requestId: randomUUID(), userId: 1 });
  assert.deepEqual(await runOperation(reserve), original);
  assert.equal((await reservation(reserve.orderId)).reservationState, "TRANSFERRED");
});
