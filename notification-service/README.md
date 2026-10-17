<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Notification-service setup and protocol documentation. Author review: Pending.
Claude Code (Opus 5.5), 2026-10-17: stored notifications and their endpoints. Author review: Pending.
Claude Code (Opus 5.5), 2026-10-17: group order recipients. Author review: Pending. -->
# Notification Service

Pushes order events to the browsers of the people involved (the requester and the courier)
over WebSockets, and keeps a history of each user's notifications. Express + `ws`, Drizzle and
PostgreSQL, with Google Pub/Sub.

```sh
npm install
npm run db:migrate   # needs DATABASE_URL
npm run dev
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm test
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Notification PostgreSQL database (Compose: `postgres://notification:notification@localhost:5436/notifications`) |
| `JWT_SECRET` | Same secret as user-service; JWTs are verified locally |
| `NOTIFICATION_TICKET_SECRET` | Signs WebSocket tickets; at least 32 bytes and the same on every instance |
| `TICKET_TTL_SECONDS` | Ticket lifetime; defaults to `30` |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed to connect (e.g. the frontend URL); empty allows any |
| `PORT` | Defaults to `3000` (Compose publishes it on host port `3003`) |
| `PUBSUB_PROJECT_ID`, `PUBSUB_EMULATOR_HOST`, `ORDER_EVENTS_TOPIC`, `SUBSCRIPTION_PREFIX`, `STORE_SUBSCRIPTION` | Pub/Sub settings |

## Connecting

The browser cannot read the JWT (it is in an httpOnly cookie), so it connects with a ticket:

1. The frontend's server calls `POST /tickets` with `Authorization: Bearer <JWT>` and gets
   `{ "ticket", "expiresIn": 30 }`. The ticket is signed and can be used once.
2. The browser opens `wss://<service>/ws?ticket=<ticket>`. A missing, expired, forged or
   reused ticket gets `401`; a disallowed `Origin` gets `403`.
3. The server sends `{ "type": "ready" }`, then `{ "type": "order.event", "event": { ... } }`
   for each event about the user's orders (the event as published on `order-events`, for
   refreshing pages), and `{ "type": "notification", "notification": { ... } }` for the
   events the user should be told about (for toasts).

The socket closes with code `4001` when the user's JWT expires, and with `1001` when the
instance shuts down; the client then fetches a new ticket and reconnects. Clients should
re-fetch their data after connecting, since events sent while offline are not replayed.

## Who is notified

- The requester, and for group orders every member: `order.member_joined`, `order.created`,
  `order.cancelled`, `order.opened`, `order.rejected`, `order.aborted`, `order.accepted`,
  `order.picked_up`, `order.delivered`, `order.expired`. (The requester causes creation,
  placing and cancelling, so for normal orders those notify nobody.)
- The courier: `order.completed`, `order.settled`.
- Nobody is notified about their own action (`actorId`).

Each notification's id is derived from `(source, eventId, userId)`, so the live push and the
stored row have the same id.

## Stored notifications

`notifications` has one row per user per event, unique on `(source, event_id, user_id)`;
`source` is `order` (later also `credit`). All routes need `Authorization: Bearer <JWT>`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/notifications?limit=&cursor=` | Newest first, `{ items, nextCursor }`; `limit` 1–50, default 20 |
| `GET` | `/notifications/unread-count` | `{ count }` |
| `POST` | `/notifications/read` | `{ "ids": [...] }` marks those (up to 100); `{}` marks all; returns `{ updated }` |

Items are `{ id, source, type, orderId, payload: { title, creditReward }, createdAt, read }`.

## Instances

Each instance creates its own pull subscription on `order-events` at startup
(`notification-<uuid>`, filter `hasPrefix(attributes.type, "order.")`), so every instance
receives every event and delivers it to the sockets it holds (a map of user id to sockets).
The subscription is deleted on `SIGTERM`, and expires after a day if an instance disappears
without deleting it.

Storage uses a separate subscription shared by all instances (`notification-store`), so
each event is stored once and Pub/Sub retries it until the insert succeeds.

On Cloud Run the service needs `--ingress all`, CPU always allocated (`--no-cpu-throttling`)
so the subscription keeps pulling between requests, and clients that reconnect, since a
request (and so a WebSocket) lasts at most 60 minutes.
