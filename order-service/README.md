<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Order-service setup, endpoint, event and command documentation. Author review: Pending.
Claude Code (Opus 5.5), 2026-10-17: title, order details, history and edit endpoints. Author review: Pending. -->
# Order Service

Errand requests (FR10–FR13). Express, Drizzle and PostgreSQL, with Google Pub/Sub for
events and saga commands.

```sh
npm install
npm run db:migrate   # needs DATABASE_URL
npm run dev
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Order PostgreSQL database (Compose: `postgres://order:order@localhost:5435/orders`) |
| `JWT_SECRET` | Same secret as user-service; tokens are verified locally |
| `PORT` | Defaults to `3000` (Compose publishes it on host port `3002`) |
| `ORDER_OPEN_TTL_SECONDS` | How long an order stays `OPEN` before it expires; defaults to `7200` |
| `INTERNAL_SHARED_SECRET` | Local development only: authenticates internal routes |
| `INTERNAL_AUDIENCE`, `INTERNAL_INVOKER_EMAILS` | Cloud: accepted audience and service accounts for Google OIDC tokens on internal routes |
| `PUBSUB_EMULATOR_HOST`, `PUBSUB_PROJECT_ID`, `PUBSUB_PUSH_BASE_URL` | Local emulator; topics and push subscriptions are created at startup |

Tests need a PostgreSQL connection that can create a disposable database:

```sh
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm test
```

## Data

- `users`: local copy from `user-events` (id, display name, role). Deleted users are kept
  with `deleted_at` set. Events older than the stored `version` are skipped.
- `supplier_versions`: append-only copy from `supplier-events`, one row per event version
  (everything except `imageUrl`). The latest version is the current supplier; deletions add a
  tombstone row. Orders point at the exact version they were created with.
- `orders`: the request, with `current_state` cached from the latest event.
- `order_events`: append-only log of every state change. It is also the transactional outbox:
  rows with `published_at` null are published to `order-events`, ordered by order id.

## Endpoints

All `/orders` routes need `Authorization: Bearer <user-service token>`. A token for a user
the local copy has not received yet gets `503` with `Retry-After`; a deleted user gets `401`.
Errors are `{ "error": "message" }`.

| Method | Path | Who | From | To |
| --- | --- | --- | --- | --- |
| `POST` | `/orders` | anyone | — | `PENDING` |
| `GET` | `/orders` | anyone | | |
| `GET` | `/orders/me` | anyone (own requests) | | |
| `GET` | `/orders/:orderId` | anyone | | |
| `GET` | `/orders/:orderId/events` | anyone (history, oldest first) | | |
| `PATCH` | `/orders/:orderId` | requester | `OPEN` | `OPEN` (`order.edited`) |
| `POST` | `/orders/:orderId/accept` | anyone except the requester | `OPEN` | `ACCEPTED` |
| `POST` | `/orders/:orderId/cancel` | requester | `OPEN` | `CANCELLED` |
| `POST` | `/orders/:orderId/pickup` | assigned courier | `ACCEPTED` | `PICKED_UP` |
| `POST` | `/orders/:orderId/deliver` | assigned courier | `PICKED_UP` | `DELIVERED` |
| `POST` | `/orders/:orderId/confirm` | requester | `DELIVERED` | `COMPLETE` |

Actions return the updated order, `404` for an unknown order, `403` for the wrong user, and
`409` for the wrong state. An `OPEN` order past its expiry time cannot be accepted.

`POST /orders` body: `{ "supplierId", "title", "description", "deliveryLocation", "creditReward" }`
(title up to 100 characters, description up to 500). The supplier must exist and be active;
`creditReward` must be a positive whole number. `PATCH` accepts only `title`, `description` and
`deliveryLocation`; the supplier and reward are fixed.

Orders are returned with `requester` and `courier` as `{ id, displayName }`, and the supplier
version they were created with. History entries are `{ id, sequence, type, state, actor, createdAt }`
with `actor` null for system changes.

`GET /orders` and `GET /orders/me` query parameters:

| Parameter | Behavior |
| --- | --- |
| `state` | One state or a comma-separated list, e.g. `ACCEPTED,PICKED_UP,DELIVERED` |
| `supplierId` | Orders for this supplier (any version) |
| `sort` | `createdAt`, `-createdAt` (default), `reward`, `-reward` |
| `limit` | 1–100, default 20 |
| `cursor` | `nextCursor` from the previous page; must use the same `sort` |

Responses are `{ "items": [...], "nextCursor": string | null }`.

## Events and commands

Every event on `order-events`:

```json
{ "eventId", "type", "orderId", "sequence", "state", "actorId", "commandId", "occurredAt", "order": { ... } }
```

`order` is the full order after the change. Delivery is at least once, so consumers dedupe by
`eventId`. Types: `order.created`, `order.opened`, `order.rejected`, `order.aborted`,
`order.edited`, `order.accepted`, `order.cancelled`, `order.expired`, `order.picked_up`, `order.delivered`,
`order.completed`, `order.settled`.

Saga commands on `order-commands`: `{ "commandId": uuid, "type", "orderId": uuid }`.

| Command | From | To |
| --- | --- | --- |
| `OpenOrder` | `PENDING` | `OPEN` (expiry clock starts) |
| `RejectOrder` | `PENDING` | `REJECTED` |
| `AbortOrder` | `PENDING` | `ABORTED` |
| `SettleOrder` | `COMPLETE` | `SETTLED` |

A repeated `commandId`, a command for an order in another state, or an unknown order is
acknowledged without changes.

## Internal routes

Authenticated by a Google OIDC token from an allowed service account (Cloud) or the shared
secret in `x-internal-secret` or `?token=` (local).

| Path | Caller |
| --- | --- |
| `POST /internal/pubsub/user-events`, `/supplier-events`, `/order-commands` | Pub/Sub push |
| `POST /internal/orders/expire-overdue` | Cloud Scheduler, every minute (locally `order-ticker`) |
| `POST /internal/outbox/publish` | Cloud Scheduler, every minute (locally `order-ticker`) |

Malformed push messages are logged and acknowledged; processing errors return `500` so
Pub/Sub redelivers.
