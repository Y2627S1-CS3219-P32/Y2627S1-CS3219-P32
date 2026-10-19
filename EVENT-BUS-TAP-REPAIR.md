<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
Scope: Author repair of the five Low findings from the single independent review of the
event bus tap and the teaching PDF. Self-tested only; not re-reviewed. Author review: Pending. -->
# Event bus tap and teaching PDF: author repair of the review's Low findings

Repairs for findings T1, T2, T3, L1 and P1 in `EVENT-BUS-TAP-REVIEW.md`, done on
2026-10-19 on the same working tree (`ea16eec` plus the uncommitted tap and guide work).
**These repairs are self-tested by the author and have not been independently
re-reviewed.** The completed review (`EVENT-BUS-TAP-REVIEW.md`, `event-bus-tap-review/`)
and the author's evidence (`event-bus-tap/evidence/`) were left unchanged. The Info items
T4 (redaction limits, already documented) and T5 (possible leaked stream, not
reproduced) were out of scope and are unchanged. Nothing was committed, pushed or
deployed, no cloud API was called, and no application service was changed.

## What changed, per finding

| ID | Repair | Files |
|---|---|---|
| T1 | While the broker is not `connected`, a topic whose server state is `ready` or `missing` is shown as a grey **"unknown"** with the tooltip "Broker unreachable: not known whether this topic is being read" (or "Broker has not answered yet"). Before, `ready` stayed green "listening" during an outage. `retrying` and `error` keep their own labels and errors. A first version used the label "unknown (broker unreachable)", but it overflowed the topic list in a screenshot, so the explanation moved to the tooltip and the label stays the existing "unknown". The labelling is now one pure function, `topicStateView()` in `view.js`, so it can be unit-tested. | `public/view.js`, `public/app.js`, `public/style.css` |
| T2 | `applySnapshot()` takes the tap's limit from `snapshot.status.store.max` before trimming, so the first snapshot is no longer cut to 1000 when `TAP_MAX_EVENTS` is larger. | `public/view.js` |
| T3 | `scrubString()` applies every pattern **before** cutting the string at 2000 characters. The patterns run over the first 4000 characters, not the whole string: I measured the e-mail pattern at about 9 s on a single 64 KiB string with no `@` (it is quadratic on long runs), and payloads can be up to 1 MiB. `describeError()` had the same order (cut at 500, then scrub) and now scrubs first too. | `src/redact.ts` |
| L1 | Correction **appended** to `AI_USAGE_LOG.md`; no earlier line was edited. See the note below. | `AI_USAGE_LOG.md` |
| P1 | Guide §2 "Events vs commands" now says that in the normal workflow only the saga orchestrator sends commands, and names credit-service's `npm run command:publish` (`credit-service/package.json` 10, `src/events/send-command.ts`) as the one exception, an operator test tool outside that workflow. A search found no other publisher to either command topic. One `CLAIM_MAP.md` row was added and a repair note appended to `RESULT.md`. PDF rebuilt. | `docs/service-architecture-guide/guide.tex`, `guide.pdf`, `CLAIM_MAP.md`, `RESULT.md` |

**Note on L1.** In the file, the two quoted fragments the review cites are not cut:
line 1263 reads `…preserve PDF/source/AI log)` and line 1238 has the full 40-character SHA
`ea16eec5baddbcbddd9412eeb219f563a81b8499`. The review's fragments (`…AI lo`, `…eb219f5`)
may be how the original prompts actually read, which would mean the log silently
completed them. I cannot check that, because the original prompt text is not available
to me. Either way, the label "Exact prompt" cannot be verified for those two entries. The
appended correction therefore says that both quotations are the prompts as recorded,
possibly edited or abridged, and not verified verbatim. The historical entries are
unchanged (`git diff --numstat AI_USAGE_LOG.md` shows additions only).

## Regression tests added

- `test/redact.test.mjs`
  - The review's exact boundary e-mail case (1990 × `x` followed by the address).
  - A space-separated e-mail and a JWT at offsets 1985/1990/1995/1999: no leak, the
    output is exactly 2000 characters plus `…[truncated]`, and the masked `a***@` is
    shown where it fits.
  - Error text scrubbed before its 500-character cut.
  - A speed guard: four 64 KiB worst-case strings are scrubbed in under 1 s in total.
- `test/view.test.mjs`
  - The first snapshot with `max: 1500` keeps 1301 of 1301 events, and a smaller `max`
    still trims.
  - `topicStateView()` for every topic state × broker state combination that matters.
- `test/browser-view.integration.mjs` (new; real Chromium, real HTTP/SSE server,
  in-memory broker, no emulator, no network, no evidence files written)
  - **T1:** topics read "listening". Then `listTopics` starts failing, while the open
    streams stay silent, as in the review's outage. The broker badge reads
    "unreachable" and the server still reports the topics as `ready`, but no row says
    "listening" and none has the green class. When the broker recovers, the rows read
    "listening" again.
  - **T2:** with `TAP_MAX_EVENTS=1500` and 1301 captured events, the page reads "Browser
    holds 1301 of at most 1500. Tap holds 1301 …". After ticking only `user-events`, all
    651 of that topic's events are there.
  - `package.json` `test:browser` now runs this file after `browser.integration.mjs`.

Before the repair, each of these failed for the intended reason:

- The new redaction test failed on the old `dist/` build (`not ok … straddling the
  truncation boundary`).
- The T2 unit test failed on the old `applySnapshot()`.
- Both new browser tests failed on the old view logic, at the asserted lines: line 74
  (no row may read "listening") and line 95 ("Browser holds 1301").

## Self-test results (this machine, 2026-10-19)

| Command | Where | Result |
|---|---|---|
| `npm run typecheck` | `event-bus-tap/` | exit 0, clean |
| `npm test` (build, then all unit tests) | `event-bus-tap/` | **57 pass, 0 fail** (was 53) |
| `PUBSUB_EMULATOR_HOST=127.0.0.1:8087 npm run test:emulator` | scratch copy `/tmp/taprepair/full` | **10 pass, 0 fail** |
| `PUBSUB_EMULATOR_HOST=127.0.0.1:8087 npm run test:browser` | scratch copy | **11 pass, 0 fail** (the 9 existing tests + 2 new) |
| New browser tests against the pre-repair view logic | scratch copy `/tmp/taprepair/old` | 0 pass, 2 fail (expected) |
| Visual check of the T1 outage state (screenshot) | scratch | six grey "unknown" badges, no row overflows |
| Guide: `latexmk -pdf -interaction=nonstopmode -halt-on-error guide.tex` | scratch `/tmp/taprepair/pdf` | exit 0, 0 overfull (24 underfull, as before), still **33 pages** |
| Guide: extracted text compared with the previous PDF (PyMuPDF) | scratch | differs only on pages 4–6: the new sentence, then page breaks moving. Page 6 ends at the same text as before; pages 1–3 and 7–33, including the contents, are text-identical. All fonts embedded |
| Guide: pages 4, 5 and 6 rendered and inspected | scratch | legible; no clipping or overflow |
| Archive: clean extract, `npm ci`, `npm run build`, `npm run typecheck`, `npm test` | see below | see below |

The emulator was the local gcloud `pubsub-emulator` 0.8.37 jar on Temurin JRE 21. I
started it on 127.0.0.1:8087 with its log in `/tmp/taprepair/`, and stopped it afterwards.
The emulator and browser suites ran in a copy because they overwrite
`event-bus-tap/evidence/`.

**Not re-run after the repair:**

- The real-flow run on the native stack.
- The lifecycle probes.
- The existing service suites.
- The CLI.
- Any Docker build or `docker compose up` (no Docker on this machine).
- Remote mode (never run against Google Cloud).

The repair touches only redaction, the viewer's topic labels and the browser's
first-snapshot limit.

## Archive

`/home/hermes/cs3219-event-bus-tap.zip` holds 38 files under a top folder
`cs3219-event-bus-tap/`:

- `compose.tap.yaml`, `EVENT-BUS-TAP-HANDOFF.md`, `EVENT-BUS-TAP-REPAIR.md`.
- `README.md`: this working tree's root README, for its run instructions and the tap's
  "Watch the event bus (optional)" section. It is for reference; do not copy it over
  your README.
- `event-bus-tap/`:
  - `Dockerfile`, `.dockerignore`, `.gitignore`, `README.md`
  - `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`
  - `src/`, `public/`, `test/`

It leaves out:

- `node_modules/` and `dist/`, which are rebuilt by `npm ci` and `npm run build`, or by
  Docker.
- `evidence/` (3.8 MB of screenshots and run records). It stays in the working tree.
- The review folder, `.env` files, logs, the emulator/JRE/PostgreSQL downloads, and any
  repository history.

The archive was built from an explicit allow-list with Python `zipfile` (no `zip`
binary here), with fixed timestamps and mode 644. Unzip it and copy everything except
`README.md` into the root of a checkout, next to `compose.yaml`. The handoff's "Run it on
the demo machine" section has the commands.

Self-test of the archive, each step in a fresh empty directory under `/tmp/taprepair/`:

| Step | Result |
|---|---|
| `zipfile.testzip()`; every entry under `cs3219-event-bus-tap/`, no `..` | ok, 38 entries |
| `cd event-bus-tap && npm ci --offline` (Node 22.23.1, npm 10.9.8) | exit 0, 158 packages, from the local npm cache with no network access; the lockfile resolves completely |
| `npm run build` | exit 0; `dist/` byte-identical to the build the emulator and browser suites ran on |
| `npm run typecheck` | exit 0 |
| `npm test` | **57 pass, 0 fail** |
| Dockerfile stages emulated from the extracted files only: `package*.json` → `npm ci` → `tsconfig*.json`, `src` → `npm run build && npm prune --omit=dev`; runtime = `package*.json`, `node_modules`, `dist`, `public` | ok. The pruned runtime (129 top-level modules) started with `NODE_ENV=production` on 127.0.0.1:3019 against an unreachable emulator host: `GET /` 200, `GET /app.js` 200, `/health/ready` 503 `{"ready":false,"broker":"connecting"}` (correct with no emulator), and it exited on SIGTERM |
| Scan of the extracted files for private data | only synthetic test fixtures (for example `hunter2`, `ada.tan@u.nus.edu`, a dummy PEM). No `.env`, no real secrets, and no local paths other than the handoff's existing description of this machine's tool folder |

Not run from the archive:

- The emulator and browser suites. They need a Pub/Sub emulator and Chromium; they ran
  on the same sources in `/tmp/taprepair/full`, as listed above.
- An online `npm ci` against the registry. The offline install used the same lockfile
  and integrity hashes.
- Any Docker build (no Docker here).

## Residual limits

- Redaction patterns see the first 4000 characters of a string. Only a secret that
  starts before character 2000 and is itself over 2000 characters long could still be
  cut before its shape is complete.
- T1 is a display repair. The server still reports a topic as `ready` during an outage,
  because the client stream does not error. `/api/status` and `/health/ready` already
  report the broker as unreachable and not ready.
- Guide line 1333 ("Credits move only through the saga, never through an HTTP call from
  order-service") is inside the order-flow walkthrough and was left as it is. The new
  §2 sentence names the manual tool as the exception.

## Preservation

I took a SHA-256 snapshot of every file except `.git/` and `node_modules/` (431 files)
before the first edit and compared it after the last one:

- **0 missing.**
- **2 added:** this file and `event-bus-tap/test/browser-view.integration.mjs`.
- **15 changed**, all listed under "What changed" and in the handoff:
  - `AI_USAGE_LOG.md` (appended only; the earlier content is byte-identical), the
    handoff, and the four guide files.
  - The tap's `src/redact.ts`, `public/{app.js,view.js,style.css}`, `package.json`,
    `test/{redact,view}.test.mjs`.
  - `dist/redact.js` and `dist/redact.js.map`, which `npm test` rebuilds from the
    repaired source.

The review (`EVENT-BUS-TAP-REVIEW.md` and the 36 files in `event-bus-tap-review/`) and the
author's `event-bus-tap/evidence/` are unchanged: 64 files, 0 changed. `README.md`,
`compose.tap.yaml` and all application services are unchanged. Nothing under
`/home/hermes/tap-runtime/` was modified. No process was left listening on 8087, 3019 or
3010.
