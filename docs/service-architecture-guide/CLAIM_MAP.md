<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
Scope: Claim-to-source map backing guide.tex (learning support / documentation). Author review: Pending. -->

# Claim map for `guide.pdf`

Each architectural claim in the guide, mapped to the source that supports it. All paths
are relative to the repository root, at commit `ea16eec5baddbcbddd9412eeb219f563a81b8499`
(`main` = `origin/main`, clean working tree). The guide section is given in brackets.
"Reported" marks something taken from `AI_USAGE_LOG.md` rather than from code. I did not
re-run any of those checks.

## Programs, ports, databases [§3, Table 1]

| Claim | Source |
| --- | --- |
| frontend listens on 3000 in the container and is published as 3001 | `compose.yaml` 171–189; `frontend-service/Dockerfile` 11, 15 |
| user-service listens on 3333, its worker on 3334 (worker not published) | `compose.yaml` 85–99, 124–135; `user-service/src/worker.ts` 20, 140 |
| supplier API is fixed at 3000; the worker listens on 3004 and is not published | `supplier-service/src/index.ts` 57, 205–209; `compose.yaml` 216–219, 241–252; `supplier-service/src/worker.ts` 19 |
| order 3000→3002, notification 3000→3003, credit 3000→3004, saga not published | `compose.yaml` 363–375, 422–434, 50–55, 498–508 |
| the six databases and their loopback ports (5433–5436, 5438, 5439) | `compose.yaml` 4–18, 301–331, 336–350, 395–409, 471–485 |
| credit-publisher's health server starts because the shared env block sets `PORT` | `compose.yaml` 32–33, 68–72; `credit-service/src/events/publisher.ts` 81–84 |
| the emulator listens on 8085 with project `foc-local` and is not published | `compose.yaml` 152–169 |
| the root README lists only four services | `README.md` (Repository Structure section) |

## Synchronous HTTP and authentication [§4]

| Claim | Source |
| --- | --- |
| login stores the JWT in an httpOnly cookie `user_access_token` | `frontend-service/server/api/user-service/login.post.ts` 21–26; `register.post.ts` 26–31 |
| Nuxt clients forward `Authorization: Bearer`, use a 5 s timeout with no retry, pass through 400/401/403/404/409/503 and turn other errors into 502 | `frontend-service/server/services/order-service/client.ts` 7–41; `frontend-service/server/services/supplier-service/client.ts` 12–38; `frontend-service/server/services/user-service/errors.ts` 1–18 |
| backend base URLs come from runtime config, overridden by `NUXT_*` env in Compose and Cloud | `frontend-service/nuxt.config.ts` 11–22; `compose.yaml` 174–184; `deploy.sh` 414–417 |
| JWT: HS256, `sub` = user ID, `exp` | `user-service/src/auth.ts` 53–76 |
| each backend verifies the JWT locally with the same `JWT_SECRET` | `order-service/src/auth.ts` 17–49; `supplier-service/src/auth.ts` 42–83; `credit-service/src/auth.ts` 12–63; `notification-service/src/auth.ts` 28–50 |
| order and supplier return 503 with `retry-after: 2` when the caller is not yet in the local copy, and 401 if deleted | `order-service/src/auth.ts` 53–68; `supplier-service/src/auth.ts` 77–92 |
| credit returns 503 `ACCOUNT_PENDING` when there is no account | `credit-service/src/credit/queries.ts` 11–23 |
| WebSocket tickets: issued via `POST /tickets`, single-use, 30 s default TTL, origin check, socket closed at JWT expiry | `notification-service/src/server.ts` 24–97; `auth.ts` 52–85; `config.ts` 25–27; `frontend-service/server/api/notification-service/ticket.post.ts` |
| no backend calls another backend over HTTP | absence of `fetch(`/HTTP clients in `*/src` of all backends (searched with grep) |
| internal routes accept a Google OIDC token from allowed emails, or a local shared secret | `order-service/src/auth.ts` 76–106; `saga-orchestrator/src/auth.ts` 13–43; `credit-service/src/auth.ts` 70–95 |

## Topics and payloads [§5]

| Claim | Source |
| --- | --- |
| user-events are published directly (no outbox), keyed by user ID, with no attributes, and version from `user_event_sequence` | `user-service/src/events/user-events.ts` 62–78; `repositories/users.repository.ts` 65–74 |
| user-events payload shape | `user-service/src/events/user-events.ts` 19–28, 80–89 |
| password hash format is `scrypt$salt$hash` | `user-service/src/auth.ts` 21–25 |
| supplier and order copies keep only id, displayName, role and version | `supplier-service/src/user-events.ts` 33–67; `order-service/src/events/consumers.ts` 40–75 |
| supplier-events are written to the outbox in the same transaction; key = supplier ID; attributes `type`, `supplierId` | `supplier-service/src/supplier-events.ts` 71–86, 141; `index.ts` 132–141, 155–164, 175–181 |
| type/building rename emits one update per supplier, under row locks | `supplier-service/src/reference-routes.ts` 65–80 |
| type/building delete emits nothing and fails when the row is still used | `supplier-service/src/reference-routes.ts` 82–97 |
| `eventId` = outbox row ID; `version` from the sequence default | `supplier-service/src/supplier-events.ts` 132–139; `db/schema.ts` 113–135 |
| order-events payload fields, key = order ID, attributes `type`, `orderId` | `order-service/src/events/outbox.ts` 42–55; `orders/write.ts` 27–44 |
| order event types (including `order.edited`) | `order-service/src/orders/write.ts` 116–122, 169, 184–189, 218 |
| `(order_id, sequence)` unique; `command_id` unique | `order-service/src/db/schema.ts` 138–159 |
| credit-commands payload, key = order ID, attribute `type` | `saga-orchestrator/src/saga.ts` 66–80; `outbox.ts` 27 |
| [§2, added in repair P1] in the normal workflow only the saga sends commands; credit-service's manual `npm run command:publish` tool also publishes one command to `credit-commands` | `saga-orchestrator/src/saga.ts` 56–80; `credit-service/package.json` 10; `credit-service/src/events/send-command.ts` 7–20; no other publisher to either command topic (searched) |
| credit-commands subscription created without ordering | `credit-service/src/events/provision.ts` 44–56 |
| credit-events type names, key = `orderId` or requester ID, attributes | `credit-service/src/events/outbox.ts` 7–42; `events/publisher.ts` 38–48 |
| order-commands payload and the four transitions | `saga-orchestrator/src/saga.ts` 57–64; `order-service/src/orders/write.ts` 184–189 |
| saga filter on four order types; notification filter `hasPrefix("order.")` | `saga-orchestrator/src/pubsub.ts` 54–55, 68–72; `notification-service/src/subscription.ts` 16 |

## Delivery mechanics [§6]

| Claim | Source |
| --- | --- |
| push handlers decode `message.data` from base64 JSON | `order-service/src/events/pubsub.ts` 42–52; `saga-orchestrator/src/pubsub.ts` 37–47; `supplier-service/src/worker.ts` 33–42; `user-service/src/worker.ts` 89–103; `credit-service/src/events/messages.ts` |
| order, saga and supplier worker ack malformed messages with 204 and let DB errors become 500 | `order-service/src/app.ts` 85–99, 120–133; `saga-orchestrator/src/app.ts` 25–40, 62–74; `supplier-service/src/worker.ts` 44–56, 64–69 |
| user-event-worker returns 400, 500 or 204 | `user-service/src/worker.ts` 89–118 |
| credit returns 200/204 on success, 400 invalid, 409 conflict, 503 otherwise | `credit-service/src/app.ts` 37–48, 62–85; `credit/commands.ts` 42–53 |
| no dead-letter configuration anywhere | no dead-letter settings in `deploy.sh`, `credit-service/src/events/provision.ts` or any `createSubscription` call (searched) |
| credit subscription settings: retention 7 days, retry 1–30 s, ack deadline 30 s | `credit-service/src/events/provision.ts` 44–56 |
| notification: per-instance live subscription (retention 600 s, expiry 24 h) acked always; shared store subscription acked after insert, nacked on failure | `notification-service/src/subscription.ts` 26–83 |
| notification IDs are deterministic; the table has a unique key | `notification-service/src/rules.ts` 36–40; `store.ts` 9–14; `db/schema.ts` 28 |
| on SIGTERM: sockets closed with 1001, live subscription deleted | `notification-service/src/index.ts` 21–29; `server.ts` 99–102; `subscription.ts` 85–91 |

## Outbox [§7]

| Claim | Source |
| --- | --- |
| state change and outbox row are written in one transaction (supplier, order, saga, credit) | `supplier-service/src/index.ts` 132–141; `order-service/src/orders/write.ts` 52–77, 81–114; `saga-orchestrator/src/saga.ts` 93–97, 99–179; `credit-service/src/credit/commands.ts` 31–155 |
| relays use `pg_try_advisory_xact_lock`, batches of 100, a per-key blocked set, then mark `published_at` | `supplier-service/src/supplier-events.ts` 116–154; `order-service/src/events/outbox.ts` 18–64; `saga-orchestrator/src/outbox.ts` 13–37 |
| relay triggers: after commit (with rerun), at startup, and by the every-minute sweep | `supplier-service/src/supplier-events.ts` 156–177; `order-service/src/index.ts` 16–18; `saga-orchestrator/src/index.ts` 16–18; `compose.yaml` 273–284, 452–466, 529–543; `deploy.sh` 312–315, 399–408 |
| credit-publisher: session advisory lock, marks each row after publishing, stops at first failure, sleeps 1 s | `credit-service/src/events/publisher.ts` 18–76, 98–107 |
| at-least-once is stated in the code comments | `order-service/src/events/outbox.ts` 16–17; `supplier-service/src/supplier-events.ts` 114–115 |
| user-service: the API publishes and never inserts users; the worker writes them | `user-service/src/services/auth.service.ts` 43–89; `services/users.service.ts` 130–186; `worker.ts` 26–82 |
| the README warns about lag; the admin page polls the projected version | `README.md` (hot reloading section); `frontend-service/app/pages/admin/users.vue` 10–34; `user-service/src/routes/users.routes.ts` |
| uniqueness checks read the projection; the worker upsert is keyed by ID; email has a unique index (basis of the caveat) | `user-service/src/services/auth.service.ts` 68–73; `worker.ts` 48–64; `db/schema.ts` 26–30 |

## Walkthroughs [§8–§11]

| Claim | Source |
| --- | --- |
| registration flow, steps 1–8 | `user-service/src/services/auth.service.ts` 43–89; `controllers/auth.controller.ts` 32; `worker.ts` 26–82; `supplier-service/src/user-events.ts`; `order-service/src/events/consumers.ts` 40–75; `credit-service/src/credit/accounts.ts` 63–183 |
| credit ignores `user.updated`; the eventId is the request ID; INITIAL_CREDITS defaults to 1000 | `credit-service/src/credit/accounts.ts` 100–101; `config.ts` 5; `compose.yaml` 35 |
| saga ignores credit events without `orderId` | `saga-orchestrator/src/messages.ts` 43–46 |
| deletion: login row removed; soft delete in copies; tombstone ordering; credit `deleted_at` | `user-service/src/worker.ts` 45–46; `order-service/src/events/consumers.ts` 44–55; `credit-service/src/credit/accounts.ts` 105–121 |
| order creation checks the latest supplier version and active flag, then inserts PENDING plus event 1 | `order-service/src/orders/write.ts` 81–114 |
| saga on `order.created`: processed_messages, RESERVING, deadline, credit.reserve | `saga-orchestrator/src/saga.ts` 39–43, 99–116; `config.ts` 21 |
| credit reserve: locks, idempotency, available-credit check, movement, outbox | `credit-service/src/credit/commands.ts` 24–188, 239–276 |
| saga on the reserve result: OPEN + OpenOrder, or REJECTED + RejectOrder | `saga-orchestrator/src/saga.ts` 138–156 |
| order-service handles commands idempotently; OpenOrder sets `expires_at` with a 2 h TTL | `order-service/src/orders/write.ts` 197–216; `config.ts` 27 |
| notification recipients and the actor rule | `notification-service/src/rules.ts` 23–32, 61–82; `order-events.ts` 11–30 |
| user actions and permissions; accept refused after expiry | `order-service/src/orders/write.ts` 116–167; `app.ts` 74–80 |
| completion → transfer → SETTLED → SettleOrder | `saga-orchestrator/src/saga.ts` 129–134, 165–175; `credit-service/src/credit/commands.ts` 209–237 |
| abort sweep sends release + AbortOrder | `saga-orchestrator/src/saga.ts` 82–91, 185–203; `compose.yaml` 529–543 |
| release before reserve → CANCELLED; later reserve → RESERVATION_CANCELLED | `credit-service/src/credit/commands.ts` 160–207; `credit/queries.ts` 41–98 |
| cancel/expire → RELEASING; expiry uses SKIP LOCKED | `saga-orchestrator/src/saga.ts` 118–127; `order-service/src/orders/write.ts` 218–240 |
| 503 `ACCOUNT_PENDING` and `RESERVATION_NOT_READY` | `credit-service/src/credit/accounts.ts` 40; `credit/commands.ts` 49–53 |
| one allocation per user (partial unique index) | `credit-service/migrations/0000_credit.sql` 60 |
| FAILED is only logged | `saga-orchestrator/src/saga.ts` 158–175; `db/schema.ts` 19 |
| supplier edit flow; order-service appends versions and ignores imageUrl; the order keeps its supplier version FK | `supplier-service/src/index.ts` 150–170; `order-service/src/events/consumers.ts` 77–124; `db/schema.ts` 98–125 |
| the seed writes outbox rows but does not publish | `supplier-service/src/db/seed.ts` 87–90, 93–115 |

## Transport: local and Cloud [§12]

| Claim | Source |
| --- | --- |
| emulator self-provisioning per service | `user-service/src/worker.ts` 119–135; `user-service/src/events/user-events.ts` 35–60; `supplier-service/src/worker.ts` 75–93; `order-service/src/events/pubsub.ts` 58–92; `saga-orchestrator/src/pubsub.ts` 57–77; `credit-service/src/events/provision.ts` 4–83; `notification-service/src/subscription.ts` 26–64 |
| shared secret in the push URL and ticker header; compose defaults | `order-service/src/events/pubsub.ts` 79–86; `compose.yaml` 369–370, 452–466 |
| credit accepts the shared secret only when the emulator host is set, and `?token=` only on push routes | `credit-service/src/config.ts` 12–14; `auth.ts` 70–79 |
| the user and supplier workers have no auth check in code | `user-service/src/worker.ts` 88–118; `supplier-service/src/worker.ts` 44–62 |
| Cloud topics, push identity, push subscriptions (OIDC, ordering, filter, ack/retry) | `deploy.sh` 47–80, 181–197, 219–221, 261–263, 293–296, 351–388 |
| credit-provision job creates credit's subscriptions with OIDC | `deploy.sh` 265–276; `credit-service/src/events/provision.ts` 32–43 |
| Cloud Run IAM on the workers; invokers list | `deploy.sh` 240, 340–349, 365–375 |
| scheduler jobs | `deploy.sh` 199–206, 312–315, 399–408 |
| notification: min-instances, no CPU throttling, 3600 s timeout, pubsub.editor | `deploy.sh` 232–235, 298–310 |
| credit-publisher: min = max = 1, no CPU throttling | `deploy.sh` 277–284 |
| evidence of earlier local runs; Cloud not run (reported) | `AI_USAGE_LOG.md` entries "Supplier events (transactional outbox)", "Saga orchestrator", "Notification service and live order updates", "Stored notifications, ...", "Deploying the order, notification, credit and saga services" |

## Containers [§13–§18]

| Claim | Source |
| --- | --- |
| three-stage Dockerfiles (tooling/build/runtime, USER node, EXPOSE 3000) | `order-service/Dockerfile` 3–31; `supplier-service/Dockerfile` 3–31; `notification-service/Dockerfile` 4–31; `saga-orchestrator/Dockerfile` 3–31 |
| supplier tooling CMD is `db:check` | `supplier-service/Dockerfile` 14 |
| credit: Alpine, two stages, no USER, `npm ci --omit=dev`, migrations from the runtime image via the drizzle-orm migrator with an advisory lock | `credit-service/Dockerfile` 1–17; `package.json` scripts; `src/db/migrate.ts` 7–24; `compose.yaml` 20–27; `deploy.sh` 246–247 |
| user-service: single stage, root, tsx at runtime, no .dockerignore, `drizzle-kit push` | `user-service/Dockerfile` 3–16; `package.json` scripts; `drizzle.config.ts`; absence of `user-service/.dockerignore` |
| frontend: build/runtime, only `.output` copied | `frontend-service/Dockerfile` 3–16 |
| .dockerignore contents | `*/.dockerignore` |
| migrate containers use `target: tooling` (except user and credit) | `compose.yaml` 195–204, 206–214, 352–361, 411–420, 487–496, 20–27 |
| the worker runs the runtime image with `node dist/worker.js` | `compose.yaml` 241–243 |
| ticker images and loops | `compose.yaml` 273–284, 452–466, 529–543 |
| default network and service-name DNS (no `networks:` key) | `compose.yaml` (whole file) |
| depends_on conditions and healthcheck commands | `compose.yaml` (lines listed in Appendix B) |
| startup work before `listen()` | `user-service/src/index.ts` 43–53; `user-service/src/worker.ts` 137–147; `order-service/src/index.ts` 11–19; `notification-service/src/index.ts` 14–20; `saga-orchestrator/src/index.ts` 11–19; `supplier-service/src/worker.ts` 95–101 |
| credit readiness runs `SELECT 1`; the publisher health check reads DB and topic metadata | `credit-service/src/app.ts` 29–33; `events/publisher-health.ts` |
| user-service does not wait for credit-pubsub-provision | `compose.yaml` 110–122 |
| supplier-db init mount points to a missing folder | `compose.yaml` 311; `git ls-files supplier-service/db` (empty) |
| named volumes; supplier-db-tools bind mounts and profile | `compose.yaml` 286–299, 545–551 |
| JWT_SECRET required; anchor `&credit-environment` | `compose.yaml` 32–45, 90, 224, 368, 427 |
| compose.dev overrides and watch actions | `compose.dev.yaml` 6–132 |
| database tables and migration files per service | each service's src/db/schema.ts and `drizzle/` or `migrations/` folder |
| Cloud SQL instance, per-service database, users and secrets; migration jobs | `deploy.sh` 98–110, 124–134, 161–166, 208–213, 242–249, 321–324 |
| Cloud Build: 11 images, parallel, tags, registry | `cloudbuild.yaml` 9–146 |
| Cloud Run commands, ports, ingress, VPC, secrets and env | `deploy.sh` 256–310, 332–395, 414–417 |

## Gaps [§19]

| Claim | Source |
| --- | --- |
| only the saga subscribes to credit-events; the `credit` notification source is unused | `saga-orchestrator/src/pubsub.ts` 73–76; `notification-service/src/db/schema.ts` 9, 29; no other `credit-events` subscriber (searched) |
| the credit internal lookup routes have no caller | `credit-service/src/app.ts` 49–60; no references elsewhere (searched) |
| every frontend proxy route maps to an existing backend route | `frontend-service/server/api/**` compared with the route definitions in each backend |
