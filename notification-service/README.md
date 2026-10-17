<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
Scope: Notification-service setup and protocol documentation. Author review: Pending. -->
# Notification Service

Pushes order events to the browsers of the people involved (the requester and the courier)
over WebSockets. Express + `ws`, with Google Pub/Sub. No database.

```sh
npm install
npm run dev
npm test
```

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Same secret as user-service; JWTs are verified locally |
| `NOTIFICATION_TICKET_SECRET` | Signs WebSocket tickets; at least 32 bytes and the same on every instance |
| `TICKET_TTL_SECONDS` | Ticket lifetime; defaults to `30` |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed to connect (e.g. the frontend URL); empty allows any |
| `PORT` | Defaults to `3000` (Compose publishes it on host port `3003`) |
| `PUBSUB_PROJECT_ID`, `PUBSUB_EMULATOR_HOST`, `ORDER_EVENTS_TOPIC`, `SUBSCRIPTION_PREFIX` | Pub/Sub settings |

## Connecting

The browser cannot read the JWT (it is in an httpOnly cookie), so it connects with a ticket:

1. The frontend's server calls `POST /tickets` with `Authorization: Bearer <JWT>` and gets
   `{ "ticket", "expiresIn": 30 }`. The ticket is signed and can be used once.
2. The browser opens `wss://<service>/ws?ticket=<ticket>`. A missing, expired, forged or
   reused ticket gets `401`; a disallowed `Origin` gets `403`.
3. The server sends `{ "type": "ready" }`, then `{ "type": "order.event", "event": { ... } }`
   for each event about the user's orders (the event as published on `order-events`).

The socket closes with code `4001` when the user's JWT expires, and with `1001` when the
instance shuts down; the client then fetches a new ticket and reconnects. Clients should
re-fetch their data after connecting, since events sent while offline are not replayed.

## Instances

Each instance creates its own pull subscription on `order-events` at startup
(`notification-<uuid>`, filter `hasPrefix(attributes.type, "order.")`), so every instance
receives every event and delivers it to the sockets it holds (a map of user id to sockets).
The subscription is deleted on `SIGTERM`, and expires after a day if an instance disappears
without deleting it.

On Cloud Run the service needs `--ingress all`, CPU always allocated (`--no-cpu-throttling`)
so the subscription keeps pulling between requests, and clients that reconnect, since a
request (and so a WebSocket) lasts at most 60 minutes.
