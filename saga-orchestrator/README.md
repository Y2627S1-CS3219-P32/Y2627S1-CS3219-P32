<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
Scope: Saga orchestrator documentation. Author review: Pending. -->
# Saga Orchestrator

Runs the order/credit saga: it listens to order events and credit results, and sends commands
to credit-service and order-service. No public API. Express, Drizzle and PostgreSQL, with Google
Pub/Sub.

```sh
npm install
npm run db:migrate   # needs DATABASE_URL
npm run dev
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm test
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Saga PostgreSQL database (Compose: `postgres://saga:saga@localhost:5439/sagas`) |
| `RESERVE_TIMEOUT_SECONDS` | How long to wait for credit's answer to a reservation before aborting; defaults to `60` |
| `INTERNAL_SHARED_SECRET` | Local development only: authenticates internal routes |
| `INTERNAL_AUDIENCE`, `INTERNAL_INVOKER_EMAILS` | Cloud: Google OIDC audience and allowed service accounts for internal routes |
| `PUBSUB_*`, `ORDER_EVENTS_TOPIC`, `ORDER_COMMANDS_TOPIC`, `CREDIT_EVENTS_TOPIC`, `CREDIT_COMMANDS_TOPIC` | Pub/Sub settings |

## The saga

| When | Saga state | Sends |
| --- | --- | --- |
| `order.created` | `RESERVING` | `credit.reserve` (requester, reward) |
| credit reserved | `OPEN` | `OpenOrder` |
| credit rejected the reservation | `REJECTED` | `RejectOrder` |
| no answer within `RESERVE_TIMEOUT_SECONDS` | `ABORTED` | `AbortOrder` and `credit.release` |
| `order.cancelled` or `order.expired` (while reserving or open) | `RELEASING` | `credit.release` |
| credit released | `RELEASED` | — |
| `order.completed` | `TRANSFERRING` | `credit.transfer` (courier) |
| credit transferred | `SETTLED` | `SettleOrder` |
| credit rejected a release or transfer | `FAILED` | — (logged with credit's code) |

Credit results are matched to a step by `requestId`, not by event name, so repeated results
(`credit.order_succeeded`) are handled the same way. Results for a step the saga has moved
past are ignored: after an abort or a cancellation, the release already sent returns any
credits a late reservation held. Credit records a release that arrives before its reservation
as cancelled and refuses the reservation, so the two can arrive in either order.

Commands and the saga step are written in one transaction (`outbox`) and published by a relay
in order per order id. Every event id is recorded (`processed_messages`), so redelivered events
change nothing. Credit commands keep their `requestId` and `correlationId` across retries, as
credit-service requires.

## Messages

- Consumes `order-events` (`order.created`, `order.cancelled`, `order.expired`,
  `order.completed`) and `credit-events`, as Pub/Sub pushes to
  `/internal/pubsub/order-events` and `/internal/pubsub/credit-events`.
- Publishes `credit.reserve`, `credit.release` and `credit.transfer` on `credit-commands` (see
  `credit-service/README.md`) and `{ commandId, type, orderId }` on `order-commands` (`OpenOrder`,
  `RejectOrder`, `AbortOrder`, `SettleOrder`), with the order id as ordering key.

Internal routes (Google OIDC token from an allowed service account in Cloud, or the shared
secret in `x-internal-secret` or `?token=` locally):

| Path | Caller |
| --- | --- |
| `POST /internal/pubsub/order-events`, `/credit-events` | Pub/Sub push |
| `POST /internal/sagas/abort-overdue` | Cloud Scheduler, every minute (locally `saga-ticker`) |
| `POST /internal/outbox/publish` | Cloud Scheduler, every minute (locally `saga-ticker`) |
