<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-10-18.
Scope: Apply the agreed four-table model and remove lifecycle, reservation, and event version fields; retain the existing JSON result pending the student’s decision.
Author review: Pending. -->
# Credit Service Product Requirements

Draft for D3, updated 18 October 2026. Implementation owner: credit-service developer. Companion: [Technical design](credit-service-tech-design.md).

The Credit Service manages FoC credits so students can request errands, earn credits by delivering them, and recover reserved credits when an errand fails. Its balances must remain correct under concurrent requests, retries, and service failures. Build and verify Credit independently through its authenticated API and Pub/Sub outcomes. Orchestrator implementation and changes to other services are deferred.

## Scope and decisions

The team has selected saga orchestration: the orchestrator decides which credit operation to request and how the order proceeds. The current implementation covers only the Credit Service, its database, APIs, user-event consumer, result events, publisher worker, tests, and container setup. Order lifecycle logic, the saga orchestrator, and its event consumer belong to other team members.

Credit executes each received command in one database transaction and publishes its outcome after commit. The saga advances by consuming credit events. Whether its caller waits for the HTTP response does not change credit execution. There is no persisted PENDING CreditOrder or background command-execution queue in the agreed design.

The selected four tables are credit_accounts, credit_orders, credit_transactions, and credit_outbox. Accounts hold balances and permanent deletion state. Current per-errand credit state is derived from immutable CreditOrders and movements. Outbox events commit with the credit result and are published afterward with retries.

| Decision | Status |
|---|---|
| Saga orchestration for order and credit coordination | Team decision from discussion |
| Accounts, CreditOrders, and successful ledger movements | Agreed; finalized credit orders and transactions are immutable |
| PostgreSQL with atomic local transactions | Proposed implementation choice |
| Initial allocation of 1,000 whole credits | Proposed default from the PDF annotation; team must confirm |
| Atomic command execution followed by credit events; saga progresses from events | Agreed |
| Provision accounts from authenticated user.created events only | Selected; no lazy or request-triggered account creation |
| One total/reserved balance row per user | Agreed; deleted-user history is retained |
| Four-table model | Account lifecycle is merged into accounts; errand state is derived from CreditOrders/movements; transactional outbox retained |
| Version removal | No lifecycle, reservation, or event version fields; permanent deletion, unique identities, request locks, and per-errand locks protect correctness |
| Saved command result | Keep the existing JSON result; structured outcome replacement remains undecided |
| Account storage and movement logic | One account row per user, two logical buckets; shared internal movement logic with business-specific handlers |
| Google Pub/Sub for credit events | Selected to match existing services; reuse the local emulator |
| User IDs and errand references | Positive integer user IDs; UUID errand IDs exposed as orderId |
| Shared event field mapping | Follow Order: eventId, type, orderId, occurredAt; type/orderId Pub/Sub attributes |
| Credit amounts | Whole-credit JSON numbers; command reward limit matches Order; balances stay within JavaScript’s safe integer range |
| Operation lookup | Explicitly authorized internal callers; no per-originating-service ownership rule |
| Credit receives commands from the orchestrator rather than independently reacting to order lifecycle events | Proposed contract consistent with orchestration |

Credit’s asynchronous responsibilities are consuming user lifecycle events and reliably publishing outbox outcomes to Pub/Sub. Credit-outcome consumers and saga progression are deferred team integrations; Credit-only verification does not claim to demonstrate the complete team workflow.

## Credit domain model

A CreditOrder is one requested credit action, distinct from an errand order. Its finalized request and result are immutable. It handles request idempotency, business intent, lifecycle/status, task/reservation references, the aggregate execution result, and the actual initial grant amount for ALLOCATE. The original reserve is found by errand ID through a successful CreditOrder and its movement, rather than a separate original-request field. Command callers supply a stable request ID and reuse it on retries. Event-driven ALLOCATE uses the source user.created eventId as its request ID.

A CreditTransaction is one concrete movement between account buckets, linked to its CreditOrder. It records debit/source, credit/destination, amount and immutable ledger evidence. Only successful committed movements enter the ledger. CreditOrder records SUCCEEDED or REJECTED; a technical database failure rolls back. No persisted pending status or transaction execution-status column is needed. One successful balance-changing action currently produces one movement; a rejection or no-op produces none.

| Action | Movement |
|---|---|
| ALLOCATE | System issuance to new user available |
| RESERVE | Requester available to requester reserved |
| RELEASE | Requester reserved to requester available |
| TRANSFER | Requester reserved to courier available |

No reservation table is stored. For each orderId, successful commands and actual movements derive NONE, HELD, TRANSFERRED, RELEASED, or CANCELLED. A successful RELEASE without a reserve movement is CANCELLED. Rejections do not change state, and matching repeats create no additional movement. Settlement adds immutable commands rather than rewriting the original command or ledger. See the [database ERD](credit-service-tech-design.md#database-erd).

RELEASE unreserves an existing hold or records a successful cancellation command if no hold exists. That successful RELEASE history blocks delayed reserve/transfer requests without moving credits. An ordinary release compensates RESERVE. It does not reverse TRANSFER. Any future transfer reversal needs its own policy and a new linked credit order/transaction rather than editing historical evidence.

A definitive rejection is fixed for that request ID. A later deliberate attempt uses a new request ID; allowing it for the same pending errand is a separate product decision. A transient database failure does not create a completed rejection or a ledger movement.

## Users and responsibilities

| Participant | Need and responsibility |
|---|---|
| Requester | See total, reserved, and available credits; reserve the reward when placing an errand |
| Courier | Receive the reserved reward once delivery is confirmed |
| User Service | Publish its existing user.created, user.updated, and user.deleted events |
| Order Service and orchestrator | Validate order ownership, lifecycle, reward, and courier assignment; request credit actions; resolve incomplete sagas |
| Credit Service | Consume user lifecycle events, provision once, retain deletion state, enforce balance rules, and expose durable results |

User IDs follow User Service’s positive integer IDs; Credit does not generate replacement identities. One student can be both requester and courier. Maintain one balance row per user with total and reserved fields; derive available = total - reserved. Available and reserved are logical buckets, not separate account rows. Shared internal movement logic implements reserve, release, and transfer after each handler checks its business rules. One account row per user ID also stores deleted_at; no separate account ID or user table is needed. Immutable request results and ledger evidence explain per-errand state. The existing result JSON remains until its format is decided. Monetary API and event fields are JSON numbers. Reserve/release amounts are integers from 1 to 2,147,483,647; balances cannot exceed 9,007,199,254,740,991. A transfer that would exceed the recipient balance limit rejects atomically without moving credits.

## Functional requirements and acceptance

| ID | Requirement | Acceptance criterion |
|---|---|---|
| C1 | Grant the configured initial allocation once per valid user | Authenticated user.created delivery creates the account, allocation order, issuance movement, and outcome atomically. Duplicate/concurrent creation events grant once per user ID and create no extra financial evidence. Changing configuration does not regrant existing users; requests never initialise accounts. |
| C2 | Expose the authenticated user's balance | Return total, reserved, and available credits where available = total - reserved. An unrelated user cannot query that account. |
| C3 | Reserve a positive whole-credit reward for an order | With 1,000 available credits, reserving 120 leaves total 1,000, reserved 120, available 880. The reservation belongs to the requester and order. |
| C4 | Reject insufficient available credits | A request exceeding available credits makes no reservation movement and records a definitive rejection. Concurrent reservations cannot spend the same available credits. |
| C5 | Transfer an existing reservation to the assigned courier | Transfer specifies orderId and courierId, not an amount; Credit reads the requester and amount from the successful reserve movement and command history. Completing the 120-credit reservation changes requester total to 880 and reserved to 0, and increases courier total by 120 in one transaction. |
| C6 | Release credits on cancellation or expiry | Releasing a HELD 120-credit reservation restores requester available credits to 1,000 without increasing total. Before reserve, persist a successful RELEASE whose derived state is CANCELLED without moving credits; a later reserve/transfer rejects. Matching repeats never move credits twice. |
| C7 | Handle repeated requests safely | Same request ID and payload return the existing CreditOrder result. Changed fields with the same ID conflict. Per-errand locking and derived command history prevent duplicate financial effects even with fresh request IDs; matching repeats may succeed as no-ops. |
| C8 | Resolve uncertain credit outcomes | After a lost response, the orchestrator can query or retry the operation and recover its committed result. Events eventually expose committed outcomes after a broker outage. |
| C9 | Publish credit results reliably | Every committed result is saved in the transactional outbox with its business effects and published to the credit event queue after commit. A publisher restart may repeat delivery; the consumer recognizes the stable event ID. |
| C10 | Protect the closed economy | No purchase, withdrawal, cash exchange, arbitrary balance-edit, or general peer-to-peer transfer endpoint. Transfer uses the amount in the reservation. |
| C11 | Recover delayed initial allocation | Successful registration remains valid while Credit is unavailable. Credit’s durable subscription retries uncommitted creation events; meanwhile reads and commands needing an absent account return retryable ACCOUNT_PENDING. Existing users receive a one-time trusted backfill through the same provisioning handler. |
| C12 | Preserve movement evidence | Each balance-changing credit order links to its committed transaction. Rejections and successful no-ops have no movement; compensation creates new evidence rather than rewriting history. |
| C13 | Handle user deletion safely | Store deletion on the account, inserting a zero-balance tombstone if creation has not arrived; delayed creation cannot allocate to it. Retain balances and ledger history, deny deleted-user balance access and new reserve/transfer, and allow existing holds to be released. |

The Credit Service verifies that an internal caller is authorized. The order owner verifies that an order may be completed or cancelled and that the courier is assigned to it. Credit must still reject self-transfer, mismatched requester or amount, and contradictory reservation transitions.

## Credit behavior at caller boundaries

### Registration and account provisioning

User Service acknowledges registration after Pub/Sub accepts `user.created`; its worker projects the user into PostgreSQL afterward. Credit independently consumes the same event through its own durable subscription, so no synchronous User-to-Credit call is needed.

Credit provisions the account and initial grant in one transaction and acknowledges the event after commit. If processing fails, Pub/Sub retries. Duplicate creation events never issue additional credits. No balance read, reserve, transfer, JWT, or supplied user ID creates an account. Pending reads and commands return 503 ACCOUNT_PENDING and may retry once the creation event has been processed.

Credit stores permanent deletion state on the account without version counters. A deletion arriving first creates a zero-balance deleted account; later creation cannot allocate or reactivate it. Deletion after creation preserves the grant and financial history. Profile updates do not provision or regrant. This assumes user IDs are never reused and undelete is unsupported. For existing users, establish the subscription before live traffic/backfill, then replay retained creation events or import a trusted current-user export through the same Credit-owned handler.

The suggested 1,000-credit default permits ten 100-credit example errands before any earnings. This is a product assumption, not a prescribed reward price. The team must agree on reward sizing and the allocation together.

### Placing an errand

An authorized caller supplies `requestId`, `correlationId`, `orderId`, integer `requesterId`, and a positive whole-credit `amount`. For an active provisioned requester, Credit reserves that amount or records a definitive rejection without a reservation movement. Missing provisioning returns retryable ACCOUNT_PENDING without a finalized CreditOrder. A later release can compensate a successful reservation. Whether an errand is eligible for another attempt belongs to its caller.

### Completing an errand

An authorized caller requests transfer after requester-confirmed completion (`order.completed` in the existing Order contract). Credit receives `orderId` and integer `courierId`, derives the requester and amount from the actual reserve movement and its command, and transfers atomically only when both participants are active and provisioned. A missing account returns retryable ACCOUNT_PENDING; a deleted participant returns 403 USER_INACTIVE without a finalized CreditOrder. It does not consume Order events or decide completion. Payment is confirmed only after transfer commits; retries must never pay twice.

### Cancelling or expiring an errand

An authorized caller requests release with the errand reference and matching requester/amount. Credit releases a HELD reservation atomically, or records a successful RELEASE command that derives CANCELLED when no reserve movement exists. Both cases require a provisioned requester account; pending provisioning returns ACCOUNT_PENDING without promising successful cancellation. Existing holds can be released for inactive users.

CANCELLED is derived from the successful RELEASE history; it has no separate state row, changes no balance, and creates no ledger movement. It records a successful RELEASE result and outbox outcome atomically, preventing a delayed RESERVE or TRANSFER. Matching repeats against CANCELLED or RELEASED succeed without another movement. A release after TRANSFERRED rejects. Credit does not decide cancellation or expiry; held credits become available only after release commits.

## Correctness and operational requirements

- Balances remain nonnegative and reserved credits never exceed total credits.
- Balance changes, the immutable CreditOrder result, and successful ledger movement commit atomically. The outbox event record joins that transaction. Broker publication happens after commit.
- Actual reserve movements for errands whose derived state is HELD sum to each account’s reserved balance. Per-errand locks and immutable history prevent duplicate settlement or a reserve after successful release.
- Reserve and release preserve the system's total credit supply. Transfer preserves it across both accounts. Only initial allocation increases supply.
- A timeout is an unknown result until retry or lookup resolves it; it is not proof that an operation failed.
- Credit data survives service and container restarts. Workers retry temporary failures, and terminal failures remain visible for recovery.
- Logs identify operation, order, correlation ID, outcome, and retry reason without credentials or tokens.

Latency and scale targets should follow the team's demo environment. D3 correctness evidence takes priority over invented production throughput targets.

## Credit verification and delivery

| Stage | Credit-owned output | Dependency and evidence |
|---|---|---|
| 1. Credit core | Schema, provisioning, balance query, reserve, transfer, release, operation lookup | Real database tests for retries, races, rollback, and conservation |
| 2. Credit transport | Authenticated command APIs, user-event consumer, sample payloads, result events | Existing user-events consumed through Credit’s subscription; outage, duplicate-delivery, and pending-account demos |
| 3. Local deployment | Credit image, database migration, persistent storage, configuration, worker startup | Reproducible Compose startup and restart without data loss |
| Deferred integration | Credit command/result contract available for other owners | No orchestrator or other-service changes in this implementation |

For D3, show allocation, successful reservation, insufficient balance, transfer, release, duplicate requests, concurrent overspending protection, and recovery after a temporary failure. Show actual before-and-after balances and credit orders and ledger transactions. Explain database choice, caller permissions, compensation, and container isolation.

A credit-only test client can validate the contract before Order Service is ready. It cannot substitute for the milestone's evidence of real team integration. D3 also covers the team's chosen nice-to-have features and responsibility allocation; no credit-related nice-to-have is selected here.

## Decisions needed before integration

1. Confirm the remaining wire details for the agreed orderId-based transfer lookup. Requester and amount are read from the successful reserve history, not supplied by the transfer caller.
2. Confirm internal command-caller and Pub/Sub delivery permissions. User lifecycle events supply requester/courier identity state. Pub/Sub and the Order-style event mapping are selected; see the TD for Credit event types.
3. Confirm the initial allocation and reward units, and obtain the existing-user backfill source. Credit owns user-event retry handling; lazy initialisation is removed.
4. External order states and stalled-saga recovery belong to other owners and are deferred; Credit supplies durable outcomes and lookup.
5. Decide whether a rejected pending errand can make a new reserve attempt after its balance changes.
6. Full release and CANCELLED-before-reserve handling are selected. Partial release and reversal of completed transfers remain outside scope; original reserve evidence is derived from command/movement history when present.
7. Confirm outbox retention/retry settings and the initial-issuance representation. The transactional outbox itself is agreed.
8. Decide whether to replace the existing result JSON with structured outcome fields. This revision retains result and does not re-execute historical commands on retry.

Request deduplication, atomic balance movements, immutable ledger evidence, and successful-reservation protection can be built first. Leave policy-dependent behavior open until these decisions are discussed.

## References and source boundaries

- [D3 instructions](CS3219-Instructions-MilestoneD3.pdf), Part 2 for Credit Service, Part 3 for asynchronous workflows, and Part 4 for containerization.
- [Project description](CS3219-ProjectDescription.pdf), M5 through M7 and closed-economy boundaries; [existing requirements](requirements.md), F4 and N2 through N4.
- The attached discussion diagram depicts the orchestrator calling Credit and consuming credit outcomes to approve, cancel, or continue orders. Its frontend-to-credit arrow is not adopted for mutations because lifecycle authorization belongs to the order workflow.
- Red annotations in the D3 PDF suggest lazy provisioning, 1,000 credits, Redis Streams, and direct Order-to-Credit communication. The current design supersedes lazy provisioning with user.created provisioning and Redis with Pub/Sub. These are design notes rather than milestone mandates. The direct-consumer suggestion predates the orchestrator design described in the request.
