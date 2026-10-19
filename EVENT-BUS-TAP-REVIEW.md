<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
Scope: Independent review of the event bus tap and the service architecture teaching PDF.
Reviewer-only; no implementation, guide or log file was changed. Author review: Pending. -->
# Event bus tap and teaching PDF: independent review

Reviewed on 2026-10-19 against the working tree at `ea16eec` plus the uncommitted author
work (`event-bus-tap/`, `compose.tap.yaml`, `EVENT-BUS-TAP-HANDOFF.md`, README and
AI-log additions, `docs/service-architecture-guide/`). This is the single independent
review. I tested the final code by running it, and did not rely on the author's claims.

## Verdict

| Area | Result | Blocking? |
|---|---|---|
| Tap: captures every topic, displays only the ticked ones, on the real stack | **PASS** | – |
| Tap: one subscription of its own per topic; application subscriptions untouched | **PASS** | – |
| Tap: redaction before data leaves the server (payload, attributes, errors, export, logs, DOM) | **PASS** for the app's known sensitive fields; 1 Low edge case (T3) | no |
| Tap: lifecycle (lost subscription, SIGTERM cleanup, reconnect, broker down, emulator back empty) | **PASS**; 1 Low display inconsistency (T1) | no |
| Tap: browser retention / filter history | **PASS** with the default settings; 1 Low bug when `TAP_MAX_EVENTS` > 1000 (T2) | no |
| Tap: HTTP bind, Host check, Compose config, Docker build inputs, Node 22 runtime | **PASS** (no Docker here: image not built, `compose up` not run) | – |
| Tap: no cloud calls or mutations by default | **PASS** | – |
| Coursework AI log intact | **PASS** (append-only); 1 Low note (L1) | no |
| Teaching PDF: high-risk architecture claims against source | **PASS**: no material inaccuracy; 1 Low wording issue (P1) | no |

**Nothing Critical, High or Medium was found.** The five Low findings below are optional,
small fixes. Nothing here requires another author repair before the demo. The one thing
nobody has done yet is run the real `docker compose ... up` once (see "Residual risk").

## Findings (most severe first; all Low or Info)

| ID | Sev. | Finding | Evidence | Minimal fix |
|---|---|---|---|---|
| T1 | Low | While the broker is unreachable, the header correctly says "Broker unreachable", but all six topic rows stay green **"listening"** (server state `ready`). The streaming pull did not error during a 30 s+ outage, so topic state never left `ready`. | `event-bus-tap-review/artifacts/review-life-v2-3-broker-unreachable.png`; `/api/status` after the emulator stopped: `unreachable ready=false user-events:ready …` | `public/app.js` `renderTopics()`: extend the existing `unknown` rule, so that when `status.broker.state !== "connected"` any non-missing topic shows "unknown (broker unreachable)". |
| T2 | Low | The browser trims the **first** snapshot to 1000 events before it learns `TAP_MAX_EVENTS`: `createViewState(1000)`, then `applySnapshot()` runs before `applyStatus()` sets `maxEvents`. With `TAP_MAX_EVENTS=1500` and 1301 captured events, the page held 1000, so hidden-topic history older than that was missing from the browser although the tap still had it. The default (1000) is unaffected. | `artifacts/redaction-and-view-probe.txt` (BUG-CONFIRMED ×2: "Browser holds 1000 of at most 1500. Tap holds 1301") | In the `snapshot` handler in `public/app.js`, set `state.maxEvents = snapshot.status.store.max` before calling `applySnapshot(state, snapshot)`. |
| T3 | Low | `scrubString()` truncates strings at 2000 characters **before** it applies the patterns. A value cut at the boundary loses the shape the regex needs. Confirmed: an e-mail straddling the cut is shown as `ada.tan@u.…[truncated]`. The same applies to a JWT cut before its second dot. Needs a string over 2000 characters with the secret exactly at the boundary. | `artifacts/redaction-and-view-probe.txt` (BUG-CONFIRMED) | `src/redact.ts` `scrubString`: run the replacements on the full string, then truncate. |
| L1 | Low | Both new `AI_USAGE_LOG.md` entries label a prompt as "Exact prompt", but it is cut mid-word (`…preserve PDF/source/AI lo`, `…fetched/fast-forwarded to ea16eec5baddbcbddd9412eeb219f5`), with no truncation marker. Earlier entries quote prompts in full. | `git diff AI_USAGE_LOG.md` (61 added lines, 0 removed) | Add "… (truncated)" or paste the full prompt. Do not rewrite any earlier entry. |
| P1 | Low | Guide §2 ("Events vs commands", `guide.tex:307`) says commands "are sent only by the saga orchestrator". credit-service also ships an operator CLI that publishes straight to `credit-commands` (`credit-service/package.json:10` `command:publish` → `src/events/send-command.ts`). It is not part of the running system, but a reader or a tap viewer could meet it. | source lines cited | Append to that sentence: "(apart from credit-service's manual test tool `npm run command:publish`)". Rebuild the PDF. |
| T4 | Info | Known limitation, documented in the handoff: redaction is key- and pattern-based. Labelled counterexamples that are **shown**: a secret in prose under an innocent key, an AWS-style key under `key`, `pin`/`otp`, phone and delivery location, an OAuth token with no key or URL hint. The fields this application actually puts on the bus that are sensitive (`passwordHash`, `email`) are redacted or masked; that was confirmed on real `user.created` traffic. | `artifacts/redaction-and-view-probe.txt` ("LIMITATION (leaks)" ×5; not counted as passes) | None needed for this app. Keep the handoff wording, which says this accurately. |
| T5 | Info | Found by reading the code only; **not reproduced**. If a stream error fires while discovery is awaiting `getSubscription` for a `ready` topic, discovery can resubscribe and `#open` while the scheduled retry later calls `#open` again. That second call replaces `entry.handle` without closing the first. Messages are still captured (both listeners store them); the cost is one leaked stream until the subscription is deleted. | `src/tap.ts` `#discoverEmulator` (ready branch) and `#scheduleRetry` | In `#open`, close any existing `entry.handle` first, or cancel `entry.cancelRetry` in the discovery resubscribe branch. |

## What was tested, how, and the results

All runs used isolated local processes on unused ports. The emulator was the runtime's
gcloud `pubsub-emulator` 0.8.37 jar on Temurin JRE 21, started on **127.0.0.1:8086**.
PostgreSQL ran from a **copy** of `/home/hermes/tap-runtime/pgdata-parent/data`, placed in
`/tmp/tapreview/pg/data`, on **127.0.0.1:55433**. The tap was the repo's own
`event-bus-tap/dist` on **3012**. The services came from the runtime's stack copy, whose
`src/` is identical to the repo for all six services. I started every process myself and
stopped all of them; afterwards no listener remained on 3000/3012/3102–3107/3333/3334/8086/55433.
`find /home/hermes/tap-runtime -newer <review start>` returned **0** files, so the runtime
folder and its data were not modified. Throwaway secrets (a JWT secret and the test
users' passwords and tokens) were written to `/tmp/tapreview` with mode 600, never
printed, and deleted at the end.

### 1. Build, dependencies and author suites (final source)

| Command (in a clean copy, `/tmp/tapreview/ctx` / `full`) | Result |
|---|---|
| Docker build context emulated by applying `.dockerignore`, then `npm ci && npm run build && npm prune --omit=dev`, then runtime imports of `dist/config.js`, `@google-cloud/pubsub` and `express` | PASS. 158 packages, build clean, `public/` present; `dist/` from a fresh build is **byte-identical** to the repo's `event-bus-tap/dist` |
| Lockfile: native `@typescript/typescript-linux-{x64,arm64}` 7.0.2 and `@esbuild/linux-{x64,arm64}` present; `@google-cloud/pubsub` 6.3.0 needs `node>=22` | PASS for amd64 and arm64 Linux images; matches `node:22-bookworm-slim` (local Node is 22.23.1) |
| `npm run typecheck` | PASS (clean) |
| `npm test` | **53/53 pass** |
| `PUBSUB_EMULATOR_HOST=127.0.0.1:8086 npm run test:emulator` | **10/10 pass** |
| `… npm run test:browser` (Chromium 1248, headless) | **9/9 pass** |

These suites ran in a copy so that their evidence writers did not overwrite the author's
`event-bus-tap/evidence/`. Log: `event-bus-tap-review/artifacts/author-suites-rerun.txt`.

### 2. Real flows through the final tap with a real browser (`scripts/real-flow-browser-probe.mjs`)

The tap started against an **empty** emulator project and discovered all six topics as the
services created them. It then held exactly 6 pull subscriptions named
`event-bus-tap-<instance>-<topic>`; the 11 application subscriptions were separate.
Before any business traffic I ticked only `credit-commands` and `credit-events`, then ran a
copy of the author's `real-flow-driver.mjs`. The only change to that copy saves its secret
list for my scans (`artifacts/driver-copy.diff`).

- Business state reached (from the services' own databases): settled order (requester 988,
  courier 1012), rejected order (`INSUFFICIENT_CREDITS`), cancelled order with saga
  `RELEASED`. The row order matched the handoff's sequence (`artifacts/review-real-flow-export.json`).
- The page showed only credit rows (12) while the tap captured 30 on 5 topics ("18 captured
  on unticked topics are hidden"). Ticking `order-events` afterwards showed **all** 12
  order events captured while it was hidden, and ticking `user-events` showed both
  `user.created` rows. The expanded payload showed `"passwordHash": "[redacted]"` and
  `r***@u.nus.edu`.
- No known secret (test passwords, JWTs, password hashes, e-mail local parts, the run's
  JWT_SECRET, the four `local-only-*` internal secrets) appeared in the **DOM, SSE snapshot,
  `/api/status`, export or the tap log file**. No page JavaScript errors.
- The probe's one FAIL, "all six topics captured", is a **reviewer setup artifact**, not a
  tap defect. The copied database already had the author's seeded suppliers, so this run
  published no `supplier-events` (`published: 0`). I covered it separately with
  `scripts/supplier-edit-probe.mjs`. That probe promotes the run's own courier to admin, in
  the review DB copy only, because first-admin bootstrap was already used. A real
  `PUT /suppliers/:id` returned 200 and order-service stored version 22 → 23. The tap
  captured `supplier.updated` v23 with 0 leaks (`artifacts/supplier-edit-probe.json`).
  With that, all six topics were captured on final code. The author's own real-flow run
  predated their last three fixes, so this closes that gap.

### 3. Lifecycle on the real stack (`scripts/lifecycle-probe-v2.mjs`): 11/11 PASS

Subscription deleted under the tap → recreated, and the viewer shows "resubscribed ×1
(gap)"; application subscriptions untouched. SIGTERM → exactly the 6 tap subscriptions
deleted and the 11 application subscriptions remain. Open page → "Disconnected:
reconnecting…", then it reconnects by itself to the restarted tap (new instance) and shows
a new real `user.created` live. Emulator stopped → "Broker unreachable", `/health/ready`
503, history still shown. The first run (`lifecycle-probe.json`) has 2 FAILs caused by **my**
probe (mismatched `email`/`confirmEmail` → HTTP 400, so there was nothing to show). They are
kept and labelled; v2 fixed the probe and passed. A separate check: an emulator brought back
empty makes the topics "missing", and a recreated `user-events` is resubscribed (`resub1`).
Finding T1 comes from this run.

### 4. Redaction and viewer edges (`scripts/redaction-and-view-probe-v2.mjs`)

13 PASS, 0 FAIL, 5 labelled LIMITATIONs (T4), 3 BUG-CONFIRMED (T2 ×2, T3). The checks
covered:

- Attributes (`authorization`, `x-internal-secret`, `cookie`, `?token=`, a JWT in `type`).
- Nested arrays; hashes, JWTs and e-mails inside prose; an e-mail used as a key.
- A top-level JSON string; non-JSON and oversize payloads withheld.
- `orderingKey`/`messageId` scrubbed; error text (`?access_token=`, Bearer) scrubbed;
  `__proto__` kept inert.
- End to end through the real HTTP/SSE server (in-memory broker) and Chromium: no Bearer
  JWT, hash or e-mail in the DOM; `<img onerror>` rendered as text and never executed.

A first draft of the truncation check used too narrow a needle and labelled a real leak
PASS. I replaced it rather than count it as a pass (v2).

### 5. HTTP bind, Host check, Compose and startup safety (`artifacts/bind-and-health.txt`)

**Does the Compose loopback setup work?** Yes. Compose publishes `127.0.0.1:3010:3010`
on the host, and inside the container the server listens on `TAP_HOST=0.0.0.0`. Docker
delivers published-port traffic to the container's network interface, not to the
container's own loopback. So a server bound to `127.0.0.1` inside the container would be
unreachable from the host, while `0.0.0.0` works. The host-side `127.0.0.1` binding
separately keeps the viewer off the LAN.

How I checked it without Docker:

- **Unprivileged network namespaces are blocked on this machine**, and I did not bind
  `0.0.0.0` here because that would expose the tap on the real network.
- **The server binds exactly `TAP_HOST`.** With `TAP_HOST=127.0.0.2`, a request to
  127.0.0.2 returns **200** and a request to 127.0.0.1 is **refused**. That is the same
  failure a loopback-only bind causes inside a container behind a published port.
- **The rendered Compose config is correct.** I rendered it with the runtime's standalone
  `docker-compose` v5.6.0 (`config`, no daemon; its SHA-256 matches its `sum` file). It
  shows `TAP_HOST=0.0.0.0` and the port `{host_ip: 127.0.0.1, target: 3010, published: 3010}`.
  The tap depends on `pubsub-emulator: service_healthy`, the emulator has no published
  port, and every non-tap service is **identical** with and without `compose.tap.yaml`
  (`services-default.txt` / `services-tap.txt` differ only by `event-bus-tap`).
- **The Host header passes.** Docker does not rewrite it, so the server sees what the host
  browser sends. `Host: 127.0.0.1:3010` and `localhost:3010` return 200; a container-IP or
  `evil.example` Host returns **421**.
- **The healthcheck works.** The `compose.tap.yaml` healthcheck command, run verbatim
  against the real entry point, exits **0**. Readiness is true with zero topics, as the
  handoff says.
- **No cloud by default.** The entry point refuses to start without `PUBSUB_EMULATOR_HOST`,
  with a `googleapis.com` emulator host, and in remote mode without
  `TAP_REMOTE_SUBSCRIPTIONS` (exit 1 each time). Compose sets `TAP_MODE: emulator` as a
  literal. Remote mode never creates or deletes anything (`#discoverRemote`, and `stop()`
  deletes only in emulator mode). `cleanup` refuses remote mode. No `MetadataLookupWarning`
  appeared in the tap logs.
- **Cleanup touches only tap subscriptions** (`artifacts/cleanup-probe.txt`). It lists by
  default and deletes with `--yes` only `event-bus-tap-dead1234-order-events`.
  `event-bus-tapX-lookalike`, `notification-store` and `saga-orchestrator-order-events`
  remain.
- No application service lists or deletes other services' subscriptions. Grepping the
  source finds only notification-service deleting its own `live` subscription.

### 6. Coursework AI log

`git diff --numstat AI_USAGE_LOG.md` → `61 0`. The diff is append-only; no earlier entry was
changed. See L1.

### 7. Teaching PDF

- Rebuilt in a temp copy (`/tmp/tapreview/pdf/build`) with
  `latexmk -pdf -interaction=nonstopmode -halt-on-error guide.tex`: exit 0, **0 overfull**
  boxes (24 underfull), 33 pages. The extracted text (PyMuPDF, `scripts/pdftext.py`) is
  **identical** to the delivered `guide.pdf`.
- Pages 9, 17, 18, 23 and 28 were rendered and inspected (`artifacts/guide-page-*.png`):
  the order workflow topics, both state machines, the opening sequence, the Cloud topology
  and the startup dependencies. All are legible, and the diagrams match the source.
- High-risk claims checked against source, plus live capture where possible. **All
  accurate**, except P1:
  - **Topics and subscriptions:** 6 topics; 11 subscriptions with the stated names, push
    or pull, ordering and filters (live list from the emulator).
  - **Saga filter:** the order-events filter passes exactly 4 types (`saga-orchestrator/src/pubsub.ts:54`).
  - **Credit subscriptions:** unordered, 7-day retention, 1–30 s backoff (`credit-service/src/events/provision.ts`).
  - **Attributes and ordering keys per topic:** no attributes on user-events; `type` only
    on commands; `type`+`orderId` on order and credit events; account allocation keyed by
    user ID. All matched the live capture exactly.
  - **User-service publishing:** it publishes directly with no outbox and inserts no user
    row (`auth.service.ts` reserves an id, hashes, then calls `publishUserEvent`).
  - **Outboxes:** order, saga, supplier and credit outboxes, and `resumePublishing` in every
    publisher.
  - **Saga transitions:** they match `saga.ts`, including abort = release + AbortOrder;
    RELEASING from RESERVING or OPEN; FAILED.
  - **Readiness:** `listen()` is called after the DB check and emulator provisioning.
  - **Ports and Compose:** the port table; credit on host 3004 vs supplier worker 3004 in
    its container; the missing `supplier-service/db/init` folder.
  - **Cloud vs local:** `deploy.sh` topic lists, ack deadline and retry delays, ordering
    flags, the saga filter, pubsub.editor for the compute SA, and the single-instance
    credit-publisher.
- Teaching sufficiency: every running program in `compose.yaml` is covered, with both
  delivery styles and all four walkthrough flows. §20, "notes for the tap", correctly
  predicted the design constraints the tap had to meet.

## Residual risk (not verifiable here)

- **Docker:** there is no Docker on this machine. The image was not built, and
  `docker compose -f compose.yaml -f compose.tap.yaml up` was not run, by the author or by
  me. I verified the build steps, the lockfile platforms, the Node 22 runtime, the rendered
  config, the bind and Host logic, and the healthcheck command separately. Run the
  handoff's two Compose commands once before the demo and confirm
  `http://127.0.0.1:3010` shows "Broker: all topics subscribed".
- **Remote mode** has never run against Google Cloud (unit tests only, as the handoff says).
- **The 500-row page cap** was checked by reading the code (`visible.slice(0, MAX_ROWS)`).
  My probe peaked at 499 visible rows, so it did not exceed the cap.
- **The CLI viewer** was not re-run independently (the author's unit tests pass).

## Exact commands (summary)

```sh
# preservation snapshot (before) and comparison (after): see the end of this file
find . -path ./.git -prune -o -path '*/node_modules' -prune -o -type f -print0 | sort -z | xargs -0 sha256sum
# build and suites in copies
npm ci && npm run build && npm prune --omit=dev           # /tmp/tapreview/ctx (dockerignore applied)
npm run typecheck; npm test; npm run test:emulator; npm run test:browser   # /tmp/tapreview/full, PUBSUB_EMULATOR_HOST=127.0.0.1:8086
# isolated stack: emulator jar on 8086; pg_ctl -D /tmp/tapreview/pg/data -o "-p 55433 ..."; scripts/run-stack-review.sh
node scripts/real-flow-browser-probe.mjs; node scripts/supplier-edit-probe.mjs
node scripts/lifecycle-probe.mjs; node scripts/lifecycle-probe-v2.mjs
node scripts/redaction-and-view-probe-v2.mjs
/home/hermes/tap-runtime/dl-compose/docker-compose -f compose.yaml [-f compose.tap.yaml] config [--services|--format json]
latexmk -pdf -interaction=nonstopmode -halt-on-error guide.tex   # in /tmp/tapreview/pdf/build
python3 -I scripts/pdftext.py <pdf> <out>; python3 -I scripts/render.py <pdf> <outdir> 3,9,17,18,23,28
```

Reviewer artifacts: `event-bus-tap-review/scripts/` and `event-bus-tap-review/artifacts/`.
They are scanned and contain none of the run's secrets. Temporary work is in `/tmp/tapreview/`.

## Preservation

No file outside `EVENT-BUS-TAP-REVIEW.md` and `event-bus-tap-review/` was created or
changed. The checksum comparison of all 394 pre-existing files (excluding `.git` and
`node_modules`) is recorded below. Nothing was committed, pushed or deployed, and no cloud
API was called.

Checksum result (sha256 of every file except `.git/` and `node_modules/`, taken at the start
of the review and again after this file was written): **394 pre-existing files, 0 changed, 0
missing**. Added: `EVENT-BUS-TAP-REVIEW.md` (1) and `event-bus-tap-review/` (36 files).
`git status` still shows exactly the author's changes plus these two new paths.
