<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Sync-service setup, protocol and instance documentation. Author review: Pending.
Claude Code (Opus 5.5), 2026-10-17: relayed presence. Author review: Pending. -->
# Synchronization Service

Lets everyone in a group order edit its description together. Each group order has a Yjs
document; clients edit it over WebSockets using the standard y-websocket protocol, and the
requester places the order when the group is done. Express + `ws` + Yjs, Drizzle and
PostgreSQL, with Google Pub/Sub.

```sh
npm install
npm run db:migrate   # needs DATABASE_URL
npm run dev
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm test
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Sync PostgreSQL database (Compose: `postgres://sync:sync@localhost:5437/sync`) |
| `JWT_SECRET` | Same secret as user-service; JWTs are verified locally |
| `SYNC_TICKET_SECRET` | Signs WebSocket tickets; at least 32 bytes and the same on every instance |
| `TICKET_TTL_SECONDS` | Ticket lifetime; defaults to `30` |
| `ALLOWED_ORIGINS` | Browser origins allowed to connect; empty allows any |
| `PORT` | Defaults to `3000` (Compose publishes it on host port `3005`) |
| `PUBSUB_*`, `ORDER_EVENTS_TOPIC`, `SYNC_EVENTS_TOPIC`, `SYNC_UPDATES_TOPIC`, `ORDER_EVENTS_SUBSCRIPTION`, `RELAY_SUBSCRIPTION_PREFIX` | Pub/Sub settings |

## Lifecycle

1. order-service creates a group order (`SYNCHRONISING`) and publishes `order.group_started`.
   The sync service creates the document and seeds it with the starting description.
2. People join through the shareable link; `order.member_joined` adds them to
   `document_members`, which decides who may connect.
3. The requester calls `POST /documents/:orderId/place` (`Authorization: Bearer <JWT>`).
   The text must be 1–500 characters after trimming. The document is locked and
   `{ eventId, type: "group.placed", orderId, description, placedBy, occurredAt }` is
   published on `sync-events`; order-service stores the description, moves the order to
   `PENDING` and publishes `order.created`.
4. `order.cancelled` (or `order.created`) closes the document.

## Connecting

Like notification-service: the frontend's server exchanges the user's JWT at `POST /tickets`
for a single-use ticket, and the browser connects to
`wss://<service>/documents/<orderId>?ticket=<ticket>` with a y-websocket client (the text is
`doc.getText("description")`). Refusals: `401` bad ticket, `403` not in the group or
disallowed origin, `404` document not created yet (retry shortly), `409` already placed or
cancelled. Close codes: `4001` session expired, `4003` placed, `4004` cancelled, `1001`
instance shutting down.

## Storage and instances

Every client update is appended to `document_updates`; loading a document merges them (and
compacts more than 50 into one row). Yjs updates can be merged in any order and repeated
safely, so redeliveries and reordering are harmless.

Each instance keeps the documents its clients have open. It relays its clients' updates to
the other instances on `sync-updates` (and their presence: names, cursors and selections,
which are not stored, and expire 30 seconds after an instance stops refreshing them), and each instance has its own subscription there
(`sync-relay-<instance id>`, filter `attributes.origin != "<instance id>"`), deleted on
`SIGTERM` and expiring after a day otherwise. Order events are consumed once per event
through the shared `sync-order-events` subscription.

On Cloud Run the service needs `--ingress all`, `--no-cpu-throttling`, and clients that
reconnect (a WebSocket lasts at most 60 minutes).
