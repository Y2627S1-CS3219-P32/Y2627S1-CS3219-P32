<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-10-18.
Scope: Apply the agreed four-table model and remove lifecycle, reservation, and event version fields; retain the existing JSON result pending the student’s decision.
Author review: Pending. -->
# Credit Service Technical Design

Draft for D3, updated 18 October 2026. Companion: [Product requirements](credit-service-prd.md).

Credit executes commands atomically and publishes outbox outcomes after commit. This design covers Credit’s database, read API, user-event and command consumers, publisher, tests, and container setup. The orchestrator and changes to other services are deferred; the command publisher CLI can exercise Credit independently.

## Architecture

```mermaid
flowchart LR
    I[Future saga or test publisher] -->|Reserve, transfer, release| Q[Pub/Sub credit-commands topic]
    Q --> C2[Credit command consumer]
    C2 --> H[Credit transaction handlers]
    B1[Pub/Sub user-events topic] --> C[Credit user-event consumer]
    C -->|Provision account and track deletion| H
    U[Authenticated user] -->|Read own balance| A
    A[Credit read API] --> D
    H --> D[(Credit PostgreSQL database)]
    D -->|Committed outbox rows| P[Credit publisher worker]
    P --> B[Pub/Sub credit-events topic]
```

The durable `credit-service-commands` subscription delivers explicit commands from `credit-commands`. Credit owns the contract. The future saga chooses when to publish. Credit does not map Order lifecycle events into actions. Outcomes are SUCCEEDED or REJECTED. Technical failures roll back for Pub/Sub retry. No persisted PENDING CreditOrder or separate database command queue is needed.

User IDs are positive INTEGER values supplied by User Service; do not generate new user IDs in Credit. Errand order IDs remain UUIDs. Public JSON uses `orderId` for the errand and `requestId` for the CreditOrder. These are external references, not cross-service foreign keys. Retain history through profile changes; never reuse user IDs. Follow the team runtime/framework.

## Database and schema

Use PostgreSQL for atomic two-account transfers, row locking, and constraints. Credit has four tables: credit_accounts, credit_orders, credit_transactions, and credit_outbox. Account balances and deletion state are mutable; finalized CreditOrders, ledger transactions, and outbox payloads are immutable. Only the outbox publication timestamp changes.

### Database ERD

```mermaid
erDiagram
    credit_accounts ||--o{ credit_orders : owns
    credit_orders ||--o{ credit_transactions : records
    credit_accounts o|--o{ credit_transactions : debit_source
    credit_accounts ||--o{ credit_transactions : credit_destination
    credit_orders ||--|| credit_outbox : emits_outcome
```

### Credit accounts

One row per User Service user ID holds current balances and lifecycle state. user_id alone is the primary key; there is no separate account_id. AVAILABLE and RESERVED are logical buckets, not separate physical account rows. Derive available_credits = total_credits - reserved_credits.

| Column | Type and constraint | Meaning |
|---|---|---|
| `user_id` | INTEGER primary key, check > 0 | Existing User Service identity |
| `total_credits` | BIGINT, not null, check >= 0 | All credits owned, including reserved credits |
| `reserved_credits` | BIGINT, not null, check >= 0 and <= total | Credits held for unsettled errands |
| `deleted_at` | Nullable TIMESTAMPTZ | Permanent deletion tombstone |
| `created_at`, `updated_at` | TIMESTAMPTZ, not null | Local account record timestamps |

A deletion received before creation inserts a zero-total, zero-reserved account with deleted_at set and no allocation. It is an inactive tombstone, not a provisioned active account. A later creation cannot activate or grant to it. Deletion of a provisioned account preserves its balances and all history. A missing row means ACCOUNT_PENDING; a deleted row means USER_INACTIVE. Active account creation and allocation always commit together.

No user lifecycle counter is stored. This depends on User Service never reusing IDs and Credit never clearing deleted_at or supporting undelete. Repeated deletion preserves the original local deletion timestamp. Profile updates are ignored and cannot reactivate accounts. Store no names, emails, roles, or password hashes.

Use JSON numbers for all monetary fields in commands, responses, and events. Reserve/release command amounts are whole integers from 1 to 2,147,483,647, matching Order’s creditReward limit. Balances and positive INITIAL_CREDITS stay within Number.MAX_SAFE_INTEGER (9,007,199,254,740,991).

Keep PostgreSQL BIGINT storage with upper-bound checks on balances, initial grants, and movement amounts. Read BIGINT exactly as strings or bigint internally, validate bounds, and only then convert to JSON numbers. Before transfer, check amount <= MAX_SAFE_INTEGER - courier.total_credits under account locks. Failure records a definitive 409 BALANCE_LIMIT_EXCEEDED rejection without moving credits.

### Credit orders

One immutable row per finalized command, not one mutable row per errand. Command callers reuse request_id on retry. ALLOCATE uses the source user.created eventId as request_id and correlation_id.

| Column | Type and constraint | Meaning |
|---|---|---|
| `request_id` | UUID primary key | Stable command ID, or source creation eventId |
| `kind` | Text enum: ALLOCATE, RESERVE, TRANSFER, RELEASE | Requested action |
| `initial_grant` | Nullable BIGINT, check > 0 and <= MAX_SAFE_INTEGER when present | Actual grant issued; required only for ALLOCATE |
| `request_payload` | JSONB, not null | Original validated business fields for audit |
| `order_id` | Nullable UUID | External errand ID; required except for ALLOCATE |
| `user_id` | INTEGER, not null, local account foreign key | Grant recipient or errand requester |
| `status` | Text enum: SUCCEEDED, REJECTED | Final command outcome, distinct from derived errand state |
| `result` | JSONB, not null | Existing saved result: historical httpStatus metadata and outcome code, applied flag, deltas, linked transaction IDs, and state at execution |
| `correlation_id` | UUID, not null | Caller workflow or source event correlation |
| `created_at` | TIMESTAMPTZ, not null | Local finalization timestamp |

Keep the existing JSON result representation. Replacing it with structured outcome fields remains undecided and is not part of this revision. Replays return the saved result; they do not rerun a rejected or successful command against current balances. A saved reservationState is a historical snapshot, not mutable current state.

Index (order_id, kind, status) for per-errand history. Enforce one successful ALLOCATE per user. Add a unique constraint/index for each balance-changing (order_id, kind), filtered to SUCCEEDED with result.applied=true. Matching fresh-ID repeats remain successful no-ops with applied=false; they create no movement. Every writer also takes the common per-order lock so TRANSFER and RELEASE cannot both settle an errand. Cancellation has applied=false because it changes no balance, but its successful RELEASE record still blocks later reservation.

The original reserve is found by order_id through a successful RESERVE with result.applied=true. There is no original-request column or separate current-state record.

### Credit transactions

One immutable successful movement linked to its CreditOrder. Rejections, repeats, and cancellation before reserve have no movement. No pending/failed movement rows or execution-status column.

| Column | Type and constraint | Meaning |
|---|---|---|
| `transaction_id` | UUID primary key | Committed movement identity |
| `credit_order_request_id` | UUID, not null, foreign key to credit_orders | Parent command |
| `debit_user_id` | Nullable INTEGER, local account foreign key | Source user; null only for issuance |
| `credit_user_id` | INTEGER, not null, local account foreign key | Destination user |
| `debit_bucket`, `credit_bucket` | Text enum: AVAILABLE, RESERVED, ISSUANCE | Source and destination buckets |
| `amount` | BIGINT, not null, check > 0 | Whole credits moved |
| `created_at` | TIMESTAMPTZ, not null | Movement timestamp |

| Kind | Source | Destination |
|---|---|---|
| ALLOCATE | Logical system ISSUANCE | New user AVAILABLE |
| RESERVE | Requester AVAILABLE | Same requester RESERVED |
| RELEASE | Requester RESERVED | Same requester AVAILABLE |
| TRANSFER | Requester RESERVED | Courier AVAILABLE |

Only allocation increases supply. RELEASE does not reverse a completed TRANSFER. Current balance-changing actions each produce one movement. Linkages and request fields must agree with the ledger users and amount.

### Credit outbox

One outcome per finalized CreditOrder, committed with its effects and published afterward. Only published_at changes. Read event type from payload.type. Log publication errors with event/request IDs; no event_type, attempts, or last_error columns are stored.

| Column | Type and constraint | Meaning |
|---|---|---|
| `event_id` | UUID primary key | Stable logical event identity across deliveries |
| `request_id` | UUID, not null, unique, foreign key to credit_orders | One outcome per finalized command |
| `payload` | JSONB, not null | Complete immutable envelope |
| `created_at` | TIMESTAMPTZ, not null | Time persisted |
| `published_at` | Nullable TIMESTAMPTZ | Broker publication acknowledged |

Index unpublished rows. Retain CreditOrders and movements for the errand/retry lifetime: they are both the command history and the source of current credit state. Never discard the successful RELEASE record that prevents a late reserve. Published outbox rows may be archived after the recovery window; command eligibility checks do not depend on their retention.

## Derived errand state

There is no reservation table and no stored reservation counter. Each operation queries the saved records needed for its own decisions: applied reserve/transfer outcomes and successful releases, including cancellation without movement. The following states describe committed financial evidence and outcome snapshots; there is no reservation read model or state lookup API. Only SUCCEEDED commands affect that evidence; rejected attempts are ignored.

| Committed evidence for the errand | Derived state |
|---|---|
| No reserve movement and no successful RELEASE | NONE |
| Reserve movement, no successful RELEASE or transfer movement | HELD |
| Reserve movement and a successful RELEASE | RELEASED |
| Successful RELEASE without any reserve movement | CANCELLED |
| Transfer movement | TRANSFERRED |

Find reserve/transfer evidence in successful saved outcomes with result.applied=true. This excludes fresh-ID no-ops without relying on timestamps or replaying balance changes. A successful RELEASE counts even without a movement, so cancellation remains visible. A transfer and a successful release for the same errand violate the state rules and must not be treated as a normal history.

For HELD, recover requester and amount from the applied reserve outcome. For TRANSFERRED, recover the paid courier from the applied transfer outcome. For CANCELLED, recover requester and amount from the successful RELEASE outcome. Matching repeats must agree with those facts. Saved command results retain their own historical snapshots; operation-specific lookups recover the participants and amount needed for subsequent commands.

| Current derived state | New RESERVE | New RELEASE | New TRANSFER |
|---|---|---|---|
| NONE | Reserve if eligible | Record CANCELLED without movement | Retryable RESERVATION_NOT_READY |
| HELD | Matching request is a no-op | Release the held amount | Pay the courier |
| RELEASED | Reject; cannot reopen | Matching request is a no-op | Reject |
| CANCELLED | Reject RESERVATION_CANCELLED | Matching request is a no-op | Reject RESERVATION_CANCELLED |
| TRANSFERRED | Reject; cannot reopen | Reject | Matching courier is a no-op |

This table applies after request replay and participant checks. A successful reserve followed by release derives RELEASED. A successful release before reserve derives CANCELLED, and the later reserve is rejected. Both arrival orders serialize on the same order_id, even when no history exists.

## Execution and idempotency

### Shared command transaction

1. Authenticate Pub/Sub delivery and validate the command envelope. No command or balance read provisions an account.
2. Begin transaction and take a transaction-scoped request_id lock. Return the saved result when request_id and order_id match, regardless of other payload changes. A different order_id returns IDEMPOTENCY_CONFLICT without another command or event. Preserve the original payload for audit.
3. Take a transaction-scoped order_id lock even if no CreditOrder exists yet. The individual operation then queries the committed records needed for its decisions. All command handlers share this locking scheme.
4. Resolve participants from the saved operations and input, then lock user/account keys in sorted user-ID order, including missing accounts. The user-event consumer uses the same per-user lock. Global lock order is request → errand → account.
5. Require active accounts for new reserve/transfer. Deleted participants produce a durable USER_INACTIVE rejection and outbox outcome. Missing accounts return retryable 503 ACCOUNT_PENDING without finalizing a command. RELEASE permits a deleted account only if an allocation exists, allowing existing obligations to close. A deleted pre-provisioning tombstone produces a durable USER_INACTIVE rejection; an absent requester returns ACCOUNT_PENDING. Same-ID replays were already handled in step 2.
6. Validate state, requester, courier, amount, available balance, and recipient limits. Apply any movement and insert the finalized CreditOrder, ledger entry, and outbox outcome in the same transaction. Definitive business rejection records REJECTED without a movement; successful repeats and cancellation record SUCCEEDED without a movement.
7. Commit before acknowledging delivery or publishing an outcome. Technical failure rolls back all command writes; retry with the same requestId.

Compare canonical kind, orderId, correlationId, requester, amount, courier, and reason as applicable. Preserve the complete command envelope across retries. Transfer compares the supplied correlationId, orderId, and courierId and derives requester and amount internally. Per-request locking protects identical retries; per-errand history protects retries with fresh IDs; account locking prevents overspending across different errands. SQL uniqueness constraints back up the single-grant and single-movement rules.

### Shared movement logic

Business-specific reserve/release/transfer handlers share an internal movement operation. It updates buckets and inserts ledger evidence using the existing transaction, never commits independently, and is not a public generic-transfer API.

| Movement | Requester total | Requester reserved | Courier total |
|---|---:|---:|---:|
| Reserve A | Unchanged | +A | Unchanged |
| Release held A | Unchanged | -A | Unchanged |
| Cancel before reserve | Unchanged | Unchanged | Unchanged |
| Transfer A | -A | -A | +A |

Reserved credits equal the sum of actual reserve amounts whose derived state is HELD. Balances remain nonnegative and reserved <= total. Terminal states never reopen. Do not recompute current balances by executing historical commands; accounts hold current balances while history explains their movements.

### Provisioning and permanent deletion

Credit owns a durable credit-service-user-events subscription to user-events, separate from other services’ subscriptions. Authenticate Pub/Sub push delivery and validate eventId, type, and positive user ID from user.id for creation or userId for deletion. The existing upstream envelope may include version; ignore it in Credit. Do not store or emit version fields, and do not change the User Service contract.

```mermaid
sequenceDiagram
    participant B as Pub/Sub user-events
    participant C as Credit user-event consumer
    participant D as Credit PostgreSQL
    B->>C: user.created(eventId E1, user.id U1)
    C->>D: BEGIN, lock request E1 then account key U1
    alt Existing active account or deleted tombstone
        C->>D: Leave grant and account unchanged
    else No account
        C->>D: Insert active account with configured grant
        C->>D: Insert ALLOCATE E1 with initial_grant, ledger movement, outbox
    end
    C->>D: COMMIT
    C-->>B: Acknowledge after commit
```

Account creation, ALLOCATE with the actual initial_grant, issuance movement, and outbox event commit atomically. Repeated creation, including different eventIds for one user, creates no additional grant, CreditOrder, or event. Configuration changes affect new accounts only. Allocation outcome eventId is distinct from the source requestId.

For user.deleted, take the same account-key lock. Set deleted_at if not already set. If no row exists, insert a zero-balance deleted account without an ALLOCATE order or movement. Never clear deleted_at. Creation after deletion is always ignored, regardless of delivery order or upstream counters. If creation committed first, deletion retains its grant and financial history; it does not reverse issued credits. user.updated is acknowledged without changing Credit data.

These rules replace lifecycle counters because account creation is one-time and deletion is irreversible. They do not support undelete or ID reuse. Concurrent creation/deletion serialize by user ID. Duplicate deletion changes nothing. Acknowledge after commit; transient processing/database failure returns an error for Pub/Sub retry.

Create the subscription before registration traffic. Credit provisions accounts through user.created events and never clears deletion tombstones. No public arbitrary-user allocation endpoint is provided.

### Release before reserve

With no successful reserve or release history and a provisioned requester, RELEASE stores a successful CreditOrder containing the validated requester/amount and result.reservationState=CANCELLED. It also stores an outbox event. It creates no reservation row or ledger movement and changes no balance. result.applied=false describes the absence of a financial movement, not the absence of a cancellation guard.

```mermaid
sequenceDiagram
    participant S as Command publisher
    participant B as Pub/Sub credit-commands
    participant C as Credit Service
    participant D as Credit PostgreSQL
    S->>B: credit.release R2, O1, requester U1, amount 120
    B->>C: Push RELEASE
    C->>D: BEGIN, request lock R2, errand lock O1, account lock U1
    D-->>C: No reserve/release evidence; account provisioned
    C->>D: Save successful RELEASE with CANCELLED result and outbox, no movement
    C->>D: COMMIT
    C-->>B: 204 after commit
    Note over C,S: Outbox publishes successful cancellation to credit-events
    S->>B: Delayed credit.reserve R1, O1, requester U1, amount 120
    B->>C: Push RESERVE
    C->>D: BEGIN, request lock R1, errand lock O1
    D-->>C: Successful RELEASE, no reserve movement: CANCELLED
    C->>D: Validate participant and save REJECTED R1 plus outbox, COMMIT
    C-->>B: 204 after rejection commits
    Note over C,S: Outbox publishes RESERVATION_CANCELLED to credit-events
```

If reserve acquires the errand lock first, its committed movement establishes HELD and release then frees it. If release acquires the lock first, its successful history blocks reserve. A matching fresh-ID release in RELEASED/CANCELLED saves a no-op result without another movement. Original commands remain immutable. Credit does not independently expire holds; callers request release for cancellation or expiry.

## Command contract and access control

Credit defines three flat command envelopes on `credit-commands`. Each carries UUID `requestId`, `correlationId`, and `orderId`. Topic publisher IAM authorizes the future saga and trusted test publishers. The saga owns lifecycle and assignment decisions. Credit validates identities, reservation state, amount, and self-transfer.

| Type | Additional fields |
|---|---|
| `credit.reserve` | `requesterId`, `amount` |
| `credit.release` | `requesterId`, `amount`, `reason` |
| `credit.transfer` | `courierId`. Derive requester and amount from committed reserve history. |

User IDs and amounts are positive integers at most 2147483647. Release reason must contain a non-whitespace character and be at most 200 characters. Idempotency compares requestId and orderId only; other validated fields do not affect replay. A broker message ID is not a command identity.

```json
{
  "type": "credit.reserve",
  "requestId": "6f1c3fc6-183c-4c56-99f9-d6df888ee944",
  "correlationId": "a7a461f2-e5fa-4a30-9699-f834737f38e5",
  "orderId": "4c29bc32-b0ef-4ab4-91dd-0bd579bb9ac8",
  "requesterId": 1,
  "amount": 120
}
```

`npm run command:publish -- command.json` validates and publishes an envelope with `orderId` as its ordering key. The CLI reports broker acceptance only. Business completion arrives through `credit-events`, correlated by `requestId`. The future saga can use this contract without implementing order lifecycle logic inside Credit.

Pub/Sub pushes use Google OIDC with the configured audience and dedicated `PUBSUB_PUSH_SERVICE_ACCOUNT`. Local emulator delivery accepts `INTERNAL_SHARED_SECRET` through the push URL token parameter. User JWTs do not authorize ingestion. Production deployment grants command-topic publish access only to authorized producers.

Balance reads verify HS256 bearer JWTs locally with `JWT_SECRET`, including the JWT header, expiry, and positive integer string `sub`. Derive the owner from `sub`. Deleted accounts receive 401. Missing provisioning receives retryable 503 ACCOUNT_PENDING. JWT validation never creates an account. Deletion takes effect when its event commits locally.

| Method and route | Caller | Payload or result |
|---|---|---|
| `POST /internal/pubsub/user-events` | Authenticated Pub/Sub push | Standard wrapper containing the existing user-event envelope |
| `POST /internal/pubsub/credit-commands` | Authenticated Pub/Sub push | Standard wrapper containing base64 command JSON |
| `GET /api/v1/credits/me` | Account owner | `totalCredits`, `reservedCredits`, `availableCredits` |
| `GET /health/live`, `GET /health/ready` | Deployment checks | Process health and database readiness |

Direct HTTP reserve, release, and transfer routes are removed. The command push endpoint returns 204 after the final result and outbox commit, including REJECTED outcomes. The saved `Outcome.httpStatus` remains historical metadata and does not set the push response code. Same-ID redelivery acknowledges the saved result without creating a new event.

`ACCOUNT_PENDING`, `RESERVATION_NOT_READY`, and unexpected dependency failures return 503 without a final command. Pub/Sub retries these deliveries. Invalid envelopes return 400, authentication failures return 401 or 403, and conflicting request IDs return 409. These non-2xx deliveries require repair or dead-letter handling. They must not be acknowledged as successful business outcomes. Cloud deployment configures dead-letter forwarding, Pub/Sub service-agent IAM, and monitoring before production traffic.

Result JSON retains requestId, status, transactionIds, code, orderId, reservationState, and applied deltas. Snapshots reflect execution time. Query current balances separately.

## Events and delivery

Publish to the Google Pub/Sub `credit-events` topic. Follow Order’s shared field mapping: `eventId`, `type`, `orderId`, and `occurredAt`. Publish `type` and, for reservation actions, `orderId` as string message attributes for subscription filters. Allocation has no errand: omit `orderId` from the envelope and attributes. Credit-specific fields (`requestId`, `correlationId`, and `data`) carry the credit result; do not fabricate an Order snapshot or Order event sequence.

| Outcome | `type` |
|---|---|
| Initial allocation | `credit.account_allocated` |
| Reservation applied | `credit.reserved` |
| Reservation rejected | `credit.reservation_rejected` |
| Transfer applied | `credit.transferred` |
| Release applied | `credit.released` |
| Other definitive rejection | `credit.order_rejected` |
| Successful no-op | `credit.order_succeeded` |

Fresh-ID no-ops set `applied=false`, zero deltas, and current state. Cancellation before reserve uses credit.order_succeeded with applied=false and reservationState=CANCELLED. Same-ID replays create no new event. Event snapshots can arrive late. Consumers correlate each outcome by requestId and deduplicate by eventId; delivery order does not establish current reservation state. Credit does not provide an operation or reservation lookup API.

```json
{
  "eventId": "77d6e2ca-ef0e-4385-8a17-cdb4a6b15c18",
  "type": "credit.reserved",
  "occurredAt": "2026-10-12T09:00:00Z",
  "requestId": "6f1c3fc6-183c-4c56-99f9-d6df888ee944",
  "correlationId": "a7a461f2-e5fa-4a30-9699-f834737f38e5",
  "orderId": "4c29bc32-b0ef-4ab4-91dd-0bd579bb9ac8",
  "data": {
    "requesterId": 1,
    "amount": 120,
    "status": "SUCCEEDED",
    "reservationState": "HELD",
    "transactionIds": ["5324a610-a832-4b47-83dc-a0645ce447a8"],
    "applied": true
  }
}
```

Include courier for transfer, reason code for rejection; omit tokens/names/addresses/delivery details. Deduplicate by eventId, correlate by requestId, guard settlement using locked per-errand history. Task-only deduplication suppresses distinct actions.

### Outbox delivery and recovery

Start one publisher. Read committed unpublished outbox rows and publish their stored envelopes to Pub/Sub. Use `orderId` as the ordering key for reservation actions and the integer user ID encoded as a string for allocation. Enable message ordering, as Order’s publisher does. After publication is acknowledged, mark the row published. A crash between acknowledgement and marking may repeat delivery with the same `eventId`.

On publication failure, retain the row and retry; resume a failed Pub/Sub ordering key before retrying. Do not publish later outcomes for the same key ahead of the failed outcome. A broker outage does not roll back committed credit effects or make the API unready.

Consumers must deduplicate by `eventId`. Consumers of credit outcomes and saga advancement are outside this implementation; the user-event and command consumers belong to Credit. Callers observe command completion through credit-events and correlate by requestId. Recovery of missing outcomes depends on retained Pub/Sub deliveries and outbox publication; no separate lookup or reconciliation API is provided. Missing account creation and reserve dependencies still require delivery of the corresponding upstream events or commands.

| Failure | Credit behavior |
|---|---|
| Commit succeeds; push acknowledgment is lost | Same-ID redelivery reuses the committed result and original outbox event. |
| Broker unavailable after commit | Retain the outbox row and retry publication. |
| Publisher crashes after publication | Republish the stored envelope with the same eventId. |
| Transfer races release | The shared errand lock and committed command history permit only one terminal settlement. |
| TRANSFER arrives before RESERVE | Return retryable RESERVATION_NOT_READY. |
| RELEASE arrives before RESERVE | Atomically save successful RELEASE history with CANCELLED result and outbox outcome; reject a later reserve without moving credits. |

Release cannot reverse a completed transfer; refunds are outside current scope.

## Deployment and verification

Follow Order’s Node.js 22, TypeScript ESM, Express, Drizzle, and pg conventions and multi-stage image. The API hosts authenticated user-event and command push endpoints; the publisher uses the same image with a distinct startup command. Add Credit’s isolated PostgreSQL database, migration job, and named volume to Compose; reuse the existing Pub/Sub emulator. Only Credit writes its schema. Use the existing `@google-cloud/pubsub` client and emulator configuration; no Redis service is needed.

Supply `DATABASE_URL`, `INITIAL_CREDITS`, `PORT`, `JWT_SECRET`, `INTERNAL_AUDIENCE`, `PUBSUB_PUSH_SERVICE_ACCOUNT`, and the local-only `INTERNAL_SHARED_SECRET` through environment/secrets. Use `PUBSUB_PROJECT_ID`, `PUBSUB_EMULATOR_HOST` locally, `PUBSUB_PUSH_BASE_URL`, `USER_EVENTS_TOPIC` (default `user-events`), `USER_EVENTS_SUBSCRIPTION` (default `credit-service-user-events`), `CREDIT_COMMANDS_TOPIC` (default `credit-commands`), `CREDIT_COMMANDS_SUBSCRIPTION` (default `credit-service-commands`), and `CREDIT_EVENTS_TOPIC` (default `credit-events`). Commit placeholders only. Migrate and create both durable subscriptions before registration or command traffic; demo users are provisioned through user events. Keep both subscriptions across restarts. Provisioning configures retention and retries for new subscriptions and refreshes push configuration on existing ones. Configure Cloud dead-letter forwarding, Pub/Sub service-agent IAM, and monitoring, and repair failed events before retention expires. Local emulator delivery is for development; it is not the recovery store for existing users. Volumes survive restart/recreation; deleting volumes deletes data.

Health checks plus bounded runtime retries handle startup/outages. API readiness needs the database. The outbox retains committed events during broker outages. Publisher health needs both. Graceful shutdown commits or rolls back current work; unpublished rows survive.

Build schema/atomic handlers, then command consumer, balance API, publisher, and Compose. Use real PostgreSQL integration tests:

1. Concurrent/redelivered creation, including different eventIds for one user, commits one account, ALLOCATE, movement, and outbox outcome. Profile updates arriving first never suppress allocation.
2. Creation then deletion retains balances/history and blocks new use. Deletion then creation retains a zero-balance tombstone and never allocates. Repeated deletion preserves deleted_at. No counters, undelete, or ID reuse are used.
3. Two concurrent 700-credit reserves against 1,000 permit one movement. Same-ID success/rejection replays the saved result even after balances/state change; changed payload replays the original result without overwriting its audit record; a changed order ID conflicts.
4. Fresh-ID reserve/transfer/release repeats create no duplicate movements. Operation-specific lookups ignore rejected commands and distinguish successful no-ops from applied reserve/transfer outcomes.
5. Test behavior for no prior operation, held credits, release, cancellation, and completed transfer. CANCELLED survives solely through successful RELEASE history with no movement. It remains effective after published outbox rows are archived.
6. Test both serialized outcomes of concurrent reserve/release and transfer/release. There is no separate row to lock for reservation state: every handler must take the errand-key lock before reading history.
7. Failure between debit and credit rolls back balances, CreditOrder, movement, and outbox. Provisioning failure rolls back the account, allocation, issuance movement, and event together.
8. Transfer-before-reserve is retryable. Transfer/reserve after cancellation is definitive rejection. Deleted allocated accounts can have existing holds released; tombstone-only accounts produce durable USER_INACTIVE rejections without a movement.
9. Assert ledger/balance agreement, nonnegative balances, HELD sums, and supply conservation. Histories may not contain both transfer and successful release for one errand.
10. Broker outage/restart eventually publishes; publish-before-mark crash repeats the same eventId. Payloads contain no schemaVersion or reservationVersion; existing upstream user events with extra version metadata remain accepted.
11. Before provisioning, balance/reserve/transfer return ACCOUNT_PENDING without creating an account or finalized command. Retrying after the creation event works. Backfill/live traffic cannot regrant or reactivate deleted accounts.
12. Reject forged event pushes, unauthorized reads and command pushes, self-transfer, invalid amounts, and conflicting participants.
13. Verify amount boundaries and exact JSON-number balance output; recipient overflow rejects atomically. Container restart preserves data. A publisher drives all operations through Pub/Sub without an orchestrator.

D3 evidence includes balances, command outcomes, order/ledger rows, duplicate command, and interrupted dependency. Log request/transaction/event/task/correlation IDs, outcome, and retry reason, never credentials. Inspect unpublished event age and logged worker errors; no separate dashboard.

## Remaining decisions

| Question | What remains open |
|---|---|
| Can a rejected pending errand try again after its balance changes? | Same requestId replays rejection. A new request is a new attempt, but errand eligibility is the order owner's policy. |
| What are the reversal limits? | Core RELEASE releases the full hold. Partial release or reversing a completed transfer would need additional policy; neither is assumed. |
| What remains for initial allocation? | Confirm the grant amount and establish the subscription before registration traffic. Authenticated user.created delivery is the provisioning source; Credit owns retries through its durable subscription. |
| What remains to confirm in the Credit contract? | Command publisher and push identity permissions, and whether to replace the existing JSON result with structured outcome fields. Keep result until that decision is made. Whole-credit JSON numbers and safe-integer balance bounds are selected. Integer user IDs, UUID errand/request IDs, Pub/Sub, and Order-style event field mapping are selected. |

CANCELLED is derived from a successful RELEASE with no reserve movement; no reservation record is needed. Other services and their recovery workflows are outside this implementation.
