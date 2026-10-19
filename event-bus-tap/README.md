<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
Scope: Event bus tap README. Author review: Pending. -->
# Event bus tap

A read-only live viewer of every Pub/Sub topic, for demonstrating the event-driven
architecture. It captures **all** application topics continuously and lets the viewer
choose which topics to **display**; unticking a topic never changes what is captured.

Full run instructions, the demo sequence and the evidence are in
[`../EVENT-BUS-TAP-HANDOFF.md`](../EVENT-BUS-TAP-HANDOFF.md).

## How it works

- Pub/Sub has no wildcard subscription. The tap lists the project's topics every few
  seconds and gives **each topic its own pull subscription**
  (`event-bus-tap-<instance>-<topic>`). Each subscription receives its own copy of every
  message, so the application's subscriptions lose nothing.
- It never reads an application subscription: names must start with `event-bus-tap-`, and
  if a subscription with its chosen name already exists it refuses to use it.
- Every delivery on its own subscriptions is acknowledged after it is stored, malformed
  ones included, so nothing is redelivered forever. It never publishes.
- Messages are **redacted before they are stored**: password hashes, passwords, tokens,
  secrets, cookies, JWTs, `?token=` URL parameters and private keys are replaced, and e-mail
  addresses are masked (`a***@u.nus.edu`). Non-JSON payloads are not kept at all. The
  browser, the CLI, the export and the logs only ever see the redacted copy.
- The last `TAP_MAX_EVENTS` (default 1000) are kept in memory. Redeliveries (same message
  id) and republished messages (same `eventId`/`commandId`/`requestId`) are kept and labelled.
- Stream errors are retried with backoff from 1 s to 30 s. A subscription the emulator lost
  is recreated, and the topic shows "resubscribed (gap)". On SIGTERM/SIGINT it deletes its
  own subscriptions.

## Modes

| | `TAP_MODE=emulator` (default) | `TAP_MODE=remote` (explicit opt-in) |
|---|---|---|
| Needs | `PUBSUB_EMULATOR_HOST` (refuses to start without it) | `PUBSUB_PROJECT_ID`, `TAP_REMOTE_SUBSCRIPTIONS`, your own credentials |
| Topics | lists all topics | only the configured ones |
| Subscriptions | creates and deletes its own | **never creates or deletes**; only pulls from `event-bus-tap-*` pull subscriptions you created |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PUBSUB_EMULATOR_HOST` | (none) | Emulator address, e.g. `pubsub-emulator:8085` |
| `PUBSUB_PROJECT_ID` | `foc-local` | Project to tap |
| `TAP_HOST` / `TAP_PORT` | `127.0.0.1` / `3010` | Viewer address |
| `TAP_ALLOWED_HOSTS` | (none) | Extra `Host` names the viewer answers to (localhost, 127.0.0.1 and [::1] always) |
| `TAP_MAX_EVENTS` | `1000` | Events kept in memory (1–20000) |
| `TAP_MAX_PAYLOAD_BYTES` | `65536` | Larger payloads are counted but not kept |
| `TAP_DISCOVERY_INTERVAL_MS` | `5000` | How often topics and subscriptions are checked |
| `TAP_EXPECTED_TOPICS` | the six application topics | Shown as "not created yet" until they exist |
| `TAP_REMOTE_SUBSCRIPTIONS` | (none) | Remote mode: `topic=event-bus-tap-...,topic=...` |

## Commands

```sh
npm ci && npm run build
PUBSUB_EMULATOR_HOST=127.0.0.1:8085 npm start      # viewer on http://127.0.0.1:3010
npm run cli -- --topics order-events,order-commands  # terminal viewer of a running tap
PUBSUB_EMULATOR_HOST=127.0.0.1:8085 npm run cleanup  # list leftover tap subscriptions; add -- --yes to delete
npm test                                             # unit tests
PUBSUB_EMULATOR_HOST=127.0.0.1:8085 npm run test:emulator
PUBSUB_EMULATOR_HOST=127.0.0.1:8085 npm run test:browser   # needs a Chromium (CHROME_PATH)
```

HTTP: `GET /` viewer, `GET /api/stream` (Server-Sent Events), `GET /api/status`,
`GET /api/events?topics=a,b` (redacted export), `POST /api/refresh` (header
`X-Tap-Request: 1`), `GET /health`, `GET /health/ready`.
