<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
Scope: Hand-off notes for the event bus tap: how to run it, what was verified, and its limits.
Updated after the independent review with the author repair of its five Low findings
(self-tested, not re-reviewed). Author review: Pending. -->
# Event bus tap: hand-off

Base: `main` at `ea16eec` plus the uncommitted `docs/service-architecture-guide/`.
Nothing was committed, pushed or deployed, and no cloud resources were touched.

Status: the author pass had **one independent review** (`EVENT-BUS-TAP-REVIEW.md`,
artifacts in `event-bus-tap-review/`). It found nothing Critical, High or Medium and five
Low findings (T1, T2, T3, L1, P1). All five were then repaired by the author. The repairs are
**self-tested only and have not been re-reviewed**; see `EVENT-BUS-TAP-REPAIR.md`. The
review's two Info items (T4, T5) were not changed.

## What it is

`event-bus-tap/` is a passive observer. It **captures every application topic** and the
browser (or CLI) **displays only the topics you tick**. Unticking a topic never changes
capture: the tap keeps one subscription per topic the whole time, and events that arrive
while a topic is hidden appear as soon as it is ticked again.

- **All topics.** Pub/Sub has no wildcard subscription, so the tap lists the project's
  topics every 5 s and creates its own pull subscription `event-bus-tap-<instance>-<topic>`
  for each one. That covers the six topics the services create at startup
  (`user-events`, `supplier-events`, `order-events`, `order-commands`, `credit-commands`,
  `credit-events`) and any other topic that appears. The six show "not created yet" until
  a service creates them.
- **Never someone else's subscription.** It only pulls from subscriptions it created
  itself (or, in remote mode, `event-bus-tap-*` pull subscriptions you name). Because each
  subscription gets its own copy of every message, the application's 11 subscriptions
  receive everything as before. Verified with a real emulator: an independent consumer
  received every message the tap captured.
- **Acknowledgements.** Every delivery on the tap's own subscriptions is acknowledged after
  it is stored, unparseable ones included, so nothing loops. The tap never publishes.
- **Redaction before anything leaves the process.** Password hashes, passwords, tokens,
  secrets, cookies, JWTs, bearer values, `?token=` URL parameters and private keys are
  replaced with `[redacted]`. E-mail addresses become `a***@u.nus.edu`. The patterns run
  before a long string is cut at 2000 characters, so a secret on the cut is still caught
  (repair T3). Non-JSON payloads are not kept. Only the redacted copy is stored, so the viewer, the export, the CLI and
  the logs cannot show the original. There is no "raw" switch.
- **Emulator by default, no cloud calls.** Without `PUBSUB_EMULATOR_HOST` it refuses to
  start, unless `TAP_MODE=remote` is set. The client is built in emulator mode, and the
  auth library's probe for a Google metadata server is switched off. Before that fix the
  probe showed up as a `MetadataLookupWarning` in the tap's log; afterwards it is gone.
- **Bounded.** The last 1000 events (`TAP_MAX_EVENTS`) are kept in the tap and in the
  browser. The browser uses the tap's configured limit from its first snapshot, so with
  a larger `TAP_MAX_EVENTS` it receives the whole buffer (repair T2). Payloads over 64 KiB are counted but not kept. The page renders at most 500 rows.
- **Duplicates are kept and labelled**: "redelivery of #n" (same topic and message id)
  and "same eventId/commandId/requestId as #n" (for example an outbox row published twice).
- **Failure handling.** Stream errors are retried with backoff from 1 s to 30 s. A
  subscription the emulator lost (for example after an emulator restart) is recreated, and
  the topic shows "resubscribed ×n (gap)". The viewer shows Loading, Live,
  Disconnected/reconnecting, and Broker unreachable, plus a state for each topic. While
  the broker is unreachable, topics that were "listening" or "not created yet" show a grey
  "unknown" instead (its tooltip says why), because an open stream does not necessarily
  fail during an outage (repair T1). On SIGTERM/SIGINT the tap deletes its own
  subscriptions.
- **Viewer**: timestamp, topic, kind (command or event), type, the ids that are present
  (orderId, correlationId, requestId, commandId, eventId, userId, supplierId, sequence,
  version, ordering key), duplicate flags, and expandable redacted JSON with attributes
  and metadata. It also has All/None, Pause, Clear view (hides only), Refresh topics and
  a redacted export of the ticked topics.

## Run it on the demo machine (Docker)

The tap needs the repository's `compose.yaml` and `.env.example`. If you received the
`cs3219-event-bus-tap.zip` archive, unzip it and copy `event-bus-tap/`, `compose.tap.yaml`,
`EVENT-BUS-TAP-HANDOFF.md` and `EVENT-BUS-TAP-REPAIR.md` into the **root of your checkout**,
next to `compose.yaml`. The archive's `README.md` is this working tree's root README,
included for reference only. Do not copy it over yours; the tap adds just its "Watch the
event bus (optional)" section. The archive has no `node_modules/` or `dist/`. Docker
builds both, and the steps below rebuild them. Then, from the repository root:

```sh
cp .env.example .env    # put a long random JWT_SECRET (>= 32 bytes) in .env;
                        # add BOOTSTRAP_SECRET (>= 32 bytes) if you want an admin for supplier edits
docker compose -f compose.yaml -f compose.tap.yaml up -d --build
docker compose -f compose.yaml -f compose.tap.yaml ps   # event-bus-tap healthy = every existing topic subscribed
```

- Viewer: <http://127.0.0.1:3010>. App: <http://127.0.0.1:3001>.
- Before the demo, wait until the viewer's header shows **Broker: all topics subscribed**
  and all six topics are **listening**. The tap only sees messages published after its
  subscription exists.
- Without `-f compose.tap.yaml`, `docker compose up` is exactly as before.
  `compose.tap.yaml` only adds the `event-bus-tap` service: on the Compose network it
  reaches `pubsub-emulator:8085`, which is not published to the host, and it publishes
  only `127.0.0.1:3010`.
- Terminal viewer with only some topics:
  `docker compose -f compose.yaml -f compose.tap.yaml exec event-bus-tap node dist/cli.js --topics order-events,order-commands`
- Stop the tap (it deletes its subscriptions):
  `docker compose -f compose.yaml -f compose.tap.yaml stop event-bus-tap`.
  Leftovers from a killed tap:
  `docker compose -f compose.yaml -f compose.tap.yaml exec event-bus-tap node dist/cleanup.js`
  (add `--yes` to delete). This works in emulator mode only.
- If you restart only `pubsub-emulator`, every subscription disappears. The tap recreates
  its own and shows a gap; the application services need a restart to recreate theirs
  (an existing behaviour).

**Not verified here:** this machine has no Docker. The image was never built and
`compose up` was never run, by the author, the reviewer or the repair. Both Compose files were parsed with a standalone
`docker-compose` v5.6.0 (`config` needs no daemon). The default service list is
unchanged; the only difference in the rendered config is the added `event-bus-tap`
service (`event-bus-tap/evidence/compose-config.txt`). The full stack also needs the
`.env` secrets above. Please run the commands above once before the demo.

## Run it without Docker

```sh
# 1. A Pub/Sub emulator on 127.0.0.1:8085 (gcloud: `gcloud beta emulators pubsub start --host-port=127.0.0.1:8085`)
# 2. The tap (Node 22 or newer; @google-cloud/pubsub 6 requires it)
cd event-bus-tap && npm ci && npm run build
PUBSUB_EMULATOR_HOST=127.0.0.1:8085 PUBSUB_PROJECT_ID=foc-local npm start   # http://127.0.0.1:3010
# 3. Optional checks
npm run typecheck && npm test                                   # no emulator, no network
PUBSUB_EMULATOR_HOST=127.0.0.1:8085 npm run test:emulator       # throwaway random project
PUBSUB_EMULATOR_HOST=127.0.0.1:8085 npm run test:browser        # needs Chromium; set CHROME_PATH
```

`npm run test:emulator` and `npm run test:browser` overwrite files in
`event-bus-tap/evidence/`. Run them in a copy if you want to keep the recorded evidence.

On this machine the emulator is the official gcloud component `pubsub-emulator` 0.8.37
(the manifest's SHA-256 was checked) running on Temurin JRE 21.0.12 (Adoptium's SHA-256
was checked). Both live under `/home/hermes/tap-runtime/`, outside the repository. That
folder also holds the native stack used for the real-flow evidence: PostgreSQL 17.10 from
`@embedded-postgres/linux-x64` on `127.0.0.1:55432`, a `git archive HEAD` copy of the
services, and `run-stack.sh`, which uses the environment from `compose.yaml` with every
service on its own `127.0.0.1` port. Start it with `start-emulator.sh`,
`start-postgres.sh` and `run-stack.sh`; stop everything with `stop-all.sh`. It is
throwaway tooling: delete the folder when done.

### Remote Pub/Sub (opt-in, not exercised)

`TAP_MODE=remote` must be set explicitly, together with `PUBSUB_PROJECT_ID` and
`TAP_REMOTE_SUBSCRIPTIONS=topic=event-bus-tap-...,...`, and without
`PUBSUB_EMULATOR_HOST`. In this mode the tap **never creates, deletes or lists**
anything. It checks that each named subscription exists, is a pull subscription and
belongs to that topic, and then reads it. Creating those subscriptions, the credentials
and the cost are the operator's decision; Pub/Sub bills message throughput for every
subscription. The tap triggers no authentication flow of its own. Remote mode is covered
only by unit tests with an in-memory broker and has never run against Google Cloud.

## Demo sequence (real flows)

The tap shows that a message was **published**. Read the rows like this:

- A **command** row (`order-commands`, `credit-commands`) means the saga has *asked* a
  service to act. It does not mean the service has done it.
- An **event** row means its publisher committed a change and published it (from an
  outbox, or directly in user-service's case).
- **Business processing completion** is never visible as "a message arrived". It shows
  as the receiving service's *own* result: the matching result event (same `requestId`,
  or an order event carrying the `commandId`), or that service's state (the order page,
  or the database queries in the guide's appendix). Several consumers publish nothing at
  all (user-event-worker, supplier-event-worker, order-service's copies,
  notification-service), so the tap cannot show their effect.

All five steps below were run on this machine against the real services (native stack,
real emulator). Each step lists what the tap captured and the state that proves
processing. Evidence: `event-bus-tap/evidence/real-flow-timeline.json`, `real-flow-tap-export.json`
and `real-flow-supplier-edit.json`, plus `real-flow-*.png`.

1. **Sign-up** (register two students). The tap shows `user-events / user.created` (no
   `type` attribute; the type is read from the payload), with `passwordHash: [redacted]`
   and a masked e-mail. Four application subscriptions get the same message. The only
   one you can see react is credit: `credit-events / credit.account_allocated`. Proof of
   the others is in their state: `credit_accounts` at 1000, the user rows in order-service
   and supplier-service.
2. **Supplier edit** (an admin renames a supplier). `supplier-events / supplier.updated`
   arrives with a new `version` (22). Proof: order-service `supplier_versions` gained
   version 22.
3. **Order happy path** (reward 12). Order of rows:
   `order.created` → `credit.reserve` (command) → `credit.reserved` → `OpenOrder` (command) →
   `order.opened` → `order.accepted` → `order.picked_up` → `order.delivered` →
   `order.completed` → `credit.transfer` (command) → `credit.transferred` → `SettleOrder`
   (command) → `order.settled`. Tick only `order-events` + `order-commands` to follow the
   order, or only `credit-commands` + `credit-events` to see each command paired with its
   result by `requestId`/`correlationId`. Proof: order `SETTLED`, saga `SETTLED`,
   requester 988 and courier 1012 credits.
4. **Refusal** (reward 5000 > balance). `credit.reserve` → `credit.reservation_rejected` →
   `RejectOrder` → `order.rejected`. Proof: saga `REJECTED` / `INSUFFICIENT_CREDITS`.
5. **Compensation** (cancel an open order). `order.cancelled` → `credit.release` →
   `credit.released`. Proof: saga `RELEASED`, reserved credits back to 0.

Optional, **not run here**: the timeout/abort path from the guide's appendix
(`docker compose stop credit-service`, create an order, wait more than 60 s plus one
saga-ticker cycle). The `credit.reserve` command is visible but has no result, and then
`AbortOrder`/`order.aborted` follow.

## Changed paths

- `event-bus-tap/` (new): `src/` (config, redact, capture, store, broker, tap, server,
  app, index, cli, cli-format, cleanup), `public/` (index.html, app.js, view.js,
  style.css), `test/` (unit, emulator and browser tests), `Dockerfile`, `.dockerignore`,
  `.gitignore`, `package.json`, `package-lock.json` (npm-generated), `tsconfig*.json`,
  `README.md`, `evidence/`.
- `compose.tap.yaml` (new, opt-in override).
- `EVENT-BUS-TAP-HANDOFF.md` (this file).
- `README.md`: a short "Watch the event bus (optional)" section.
- `AI_USAGE_LOG.md`: appended entries only (the tap, then the repair with its L1 correction).
- Repair (after the review): `event-bus-tap/src/redact.ts`, `public/view.js`,
  `public/app.js`, `public/style.css`, `package.json` (the `test:browser` script),
  `test/redact.test.mjs`, `test/view.test.mjs`, new `test/browser-view.integration.mjs`,
  `docs/service-architecture-guide/guide.tex` and `guide.pdf` (one §2 sentence),
  `CLAIM_MAP.md` (one row), `RESULT.md` (an appended repair note), this file, and
  `EVENT-BUS-TAP-REPAIR.md`.
- No application service code, `compose.yaml`, `compose.dev.yaml`, `cloudbuild.yaml` or
  `deploy.sh` was modified.

## Test results (actual, this machine, 2026-10-19)

After the repair, on the final code (self-tested; emulator and browser suites run in a
copy so the evidence files below are the author's originals):

| Check | Result |
|---|---|
| `npm run typecheck` (TypeScript 7.0.2) | clean |
| `npm test`: unit tests for redaction, capture, bounded store, display filter, config safety, supervisor with an in-memory broker, CLI, plus the repair regressions for T1, T2 and T3 | **57 pass, 0 fail** (53 before the repair) |
| `npm run test:emulator`: real emulator 0.8.37, random throwaway project | **10 pass, 0 fail** |
| `npm run test:browser`: headless Chromium (Playwright build 1248) with the real emulator, plus `browser-view.integration.mjs` (T1 and T2 against the real HTTP/SSE server, in-memory broker) | **11 pass, 0 fail** (9 before the repair) |
| The new T1/T2/T3 regressions against the pre-repair logic | fail as expected, at the asserted lines |
| Clean extract of `cs3219-event-bus-tap.zip`: `npm ci`, `npm run build`, `npm run typecheck`, `npm test` | see `EVENT-BUS-TAP-REPAIR.md` |

The rows below are from the author pass and were **not** repeated after the repair:

| Check | Result |
|---|---|
| Existing suites (unchanged code, HEAD copy, local PostgreSQL): order 17, saga 8, notification 7, supplier 50, user 9, credit 21 | **all pass** |
| Real flows on the native stack (5 steps above) | all business states reached; **0 secrets** in the tap export |
| Graceful shutdown on the real stack | deleted its 6 subscriptions; the 11 application subscriptions remained |

The real-flow run came before three last small robustness fixes: an SSE response error
listener, stopping retries for a topic deleted while retrying, and resetting Pause after
a tap restart. All automated suites above were re-run after those fixes; the real-flow
run was not repeated by the author. The independent review then ran real flows and the
lifecycle checks on that final pre-repair code (`EVENT-BUS-TAP-REVIEW.md` §2 and §3).

What the emulator and browser tests cover:
- Only the selected topic is visible while both are captured, including an event that
  arrived while its topic was hidden.
- Switching the filter shows already captured events.
- A topic created after start is discovered.
- An independent consumer of the same topic still receives every message.
- Retention stays bounded (40 in the tap after 50 more events; 15/15 in the browser).
- Hostile `<img onerror>`/`<script>` text is shown literally and not executed.
- Non-JSON payloads are withheld.
- A republished message is labelled.
- A subscription deleted under the tap is recreated.
- Loading, disconnected/reconnected and broker-unreachable states are shown.
- `/api/refresh` requires the custom header, and a foreign `Host` gets 421.
- No secret appears in the export, status, stream, logs or page.

## Evidence artifacts (`event-bus-tap/evidence/`)

- `test-results.txt`: the typecheck, unit, emulator and browser runs above.
- `emulator-integration.json`: subscription lists, fanout message ids, a redacted sample,
  the bounded-retention numbers, the recovery steps and the tap's log lines.
- `browser-integration.json` with `browser-1-loading.png` … `browser-10-broker-unreachable.png`.
- `real-flow-timeline.json` (HTTP steps, saga/credit/order state from each service's own
  database, secret scan), `real-flow-tap-export.json` (the tap's redacted export: 33
  events on all six topics), `real-flow-supplier-edit.json`,
  `real-flow-1-all-topics.png` … `real-flow-4-user-event-redacted.png`.
- `cli-commands-only.txt`: the CLI showing only the command topics of the real run.
- `real-stack-tap-shutdown.log`: SIGTERM deleting exactly the tap's own subscriptions.
- `compose-config.txt` and `service-regression.txt`.
- `real-flow-driver.mjs`, `real-flow-supplier-edit.mjs`, `real-flow-screenshots.mjs`:
  the evidence tooling, kept so the runs can be repeated. They drive a **local** stack
  through its public APIs and are not part of the tap. The tap never publishes.

## Limitations and open points

- No Docker run (see above). The `Dockerfile` follows notification-service's pattern but
  has never been built.
- Remote mode has never run against Google Cloud (see above).
- The tap only sees messages published after its subscription exists. The buffer is in
  memory and is lost on restart. Messages published while a lost subscription is being
  recreated are lost, and the topic is marked "resubscribed (gap)".
- Redaction is key- and pattern-based. Names (`name`, `displayName`), titles,
  descriptions and delivery locations are shown. A secret stored under an innocent key,
  in a format no pattern recognises, would not be caught.
- The viewer has no login. It listens on loopback only and only answers to local `Host`
  names, so anyone on the same machine can see the redacted stream.
- Rows are in the order the tap received them. Delivery is ordered per ordering key, but
  there is no global order; the publish time is in the details.
- `deliveryAttempt` shows "not reported" because no subscription has a dead-letter
  policy. Redelivery labels only cover events still in the buffer.
- The 24 h expiry policy on tap subscriptions may not be enforced by the emulator; use
  `cleanup` after a killed tap.
- The browser test finds Chromium in the Playwright cache; set `CHROME_PATH` elsewhere.
- Redaction patterns run over the first 4000 characters of a string before it is cut to
  2000. That bound keeps the e-mail pattern fast (unbounded, one 64 KiB string took about
  9 s). Only a secret that starts before character 2000 and is itself over 2000
  characters long could still be cut before its shape is complete.
- The real-flow run, the existing service suites and the graceful-shutdown check on the
  real stack were not repeated after the repair. The repair touched only redaction, the
  viewer's topic labels and the browser's first-snapshot limit.
