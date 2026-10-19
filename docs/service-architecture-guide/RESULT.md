<!-- AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
Scope: Result summary for the service architecture teaching guide. Author review: Pending. -->

# Result: service architecture teaching guide

## Deliverables (this folder)

| File | What it is |
| --- | --- |
| `guide.pdf` | **Canonical short guide, 4 A4 pages**, 11pt body, 2 TikZ figures (topic/subscription map, order saga sequence), 1 compact per-service container table |
| `guide.tex` | Its single-file LaTeX source |
| `guide-detailed.pdf` / `.tex` | The original 33-page guide, kept unchanged as the detailed reference (payloads, Cloud Run, gaps, demo appendix) |
| `CLAIM_MAP.md` | Claim-to-source map (section numbers refer to the detailed guide; the short guide draws only on claims listed there) |
| `BUILD.md` | How to rebuild and visually check either PDF |
| `RESULT.md` | This file |

## Short guide revision (2026-10-19)

The user asked for a guide of at most four pages, including title and references, that
teaches rather than compresses. `guide.tex` was rewritten from scratch; the 33-page
source and PDF were first copied to `guide-detailed.tex` / `guide-detailed.pdf`
(byte-identical copies).

**Scope of the four pages.** (1) HTTP vs Pub/Sub, topic, subscription, ack, push vs
pull, at-least-once and idempotency, ordering keys, filters, independent fanout vs
competing consumers (notification-service's per-instance and shared subscriptions),
events vs commands; Figure 1 shows all six topics and all eleven subscription kinds with
publisher, delivery style and consumer. (2) All seven services (frontend, user,
supplier, order, saga, credit, notification) and their extra programs. (3) The outbox,
user-service's publish-instead-of-write exception, status codes as acknowledgements, and
deduplication per consumer. (4) Sign-up replication, supplier-edit replication, and the
order saga end to end (Figure 2) with rejection, timeout compensation, release and
`FAILED`. (5) Containerization: the common three-stage image, a 7-row table of
per-service differences (image shape, user, ports, extra containers), Compose
networking and DNS, published vs container ports, startup order via healthchecks and
`depends_on`, volumes, the dev and tap overrides, and one sentence on Cloud Run.
Provenance is a single footnote. Left out on purpose (still in the detailed guide):
payload listings, code excerpts, Cloud transport detail, gaps list, tap notes, demo
commands, line-number appendix.

**Self-checks (author checks only; no independent verification was run).**
- `latexmk -pdf -interaction=nonstopmode -halt-on-error guide.tex`: exit 0, 0 overfull
  and 0 underfull boxes, no undefined references or missing glyphs.
- Page count asserted with PyMuPDF: **4** (`assert page_count <= 4` passed).
- All four pages rendered at 110 dpi and inspected individually and as a contact sheet:
  no clipping, overflow, overlapping diagram labels, orphaned headings or widow lines;
  body text is 11pt, the table and figure labels are \small (about 10pt), the footnote
  8.5pt.
- Extracted text: no replacement characters; all eleven subscription names and all seven
  service names present; "exactly once" appears only in a negation.
- Facts were taken from the detailed guide and spot-checked against `compose.yaml`
  (ports, commands, targets, images, conditions) and every `Dockerfile` (stages, base
  images, `USER`, `EXPOSE`, `CMD`). `git diff ea16eec HEAD` touches no service code,
  only the tap and docs, so the pinned snapshot still describes the services.
- Nothing was run (no Docker, services, emulator or cloud).

---

# Original record for the detailed guide (`guide-detailed.pdf`)

The sections below describe the 33-page guide as first produced and repaired. Where they
say `guide.pdf` / `guide.tex`, read `guide-detailed.pdf` / `guide-detailed.tex`.

## Snapshot described

`main` at `ea16eec5baddbcbddd9412eeb219f563a81b8499` ("Merge pull request #21 from
Y2627S1-CS3219-P32/supplier-pubsub"). `git fetch --dry-run` showed `origin/main` at the
same commit, and the working tree was clean before work started. No repository files
outside this folder were modified, apart from one appended entry in `AI_USAGE_LOG.md`.

## What the guide covers

1. A mental model (phone call vs mailing list), then vocabulary tied to the code:
   topic, subscription, message parts, push/pull, ack/retry, at-least-once, idempotency
   techniques, ordering keys, filters, fanout vs competing consumers, events vs commands,
   outbox, saga, projection.
2. An inventory of every running program in `compose.yaml` (frontend, user API and
   worker, supplier API, worker and ticker, order and ticker, saga and ticker, credit
   API, publisher and provisioner, notification, emulator, six PostgreSQL databases,
   migration jobs, tools profile), with ports and database ownership.
3. Synchronous HTTP: the browser → Nuxt BFF → backend path, the cookie, local JWT
   verification, the local user copies and their 503 responses, notification tickets
   and the WebSocket, internal routes.
4. All six topics and their eleven subscriptions (the per-instance notification
   subscriptions counted once), with publisher mechanism, ordering key,
   attributes, filters, and real payload shapes with field meanings.
5. Delivery mechanics: the push envelope, status codes as acknowledgements (and how
   the five push consumers differ), and pull acknowledgement in notification-service.
6. The outbox as implemented (four variants), what it guarantees, and user-service as
   the publish-instead-of-write exception.
7. Walkthroughs: sign-up replication to four services; order create → reserve → open
   → accept/pickup/deliver/confirm → transfer → settle; rejection, timeout abort with
   compensation, cancel/expire release, duplicate handling layer by layer; supplier edit
   to `supplier_versions`.
8. Local emulator self-provisioning vs `deploy.sh` Cloud transport (OIDC push, IAM,
   Scheduler), and what is configured vs actually exercised.
9. Containerization: every Dockerfile (stages, base images, users, EXPOSE, commands),
   the Compose network and DNS, published vs exposed ports, `depends_on` conditions vs
   the exact healthcheck commands, volumes and bind mounts, `compose.dev.yaml`, database
   ownership and migrations, Cloud Build and Cloud Run packaging.
10. Gaps and missing links, notes for the future event bus tap, a demo run appendix,
    and a provenance appendix.

## Verification performed

- Compiled with `latexmk -pdf`: exit 0, **0 overfull boxes**, no undefined references,
  no missing glyphs. All fonts are embedded Type 1 (Latin Modern).
- Rendered every page to PNG at 110 dpi and inspected all 33 pages individually and as
  contact sheets. Diagram overlaps found in the first renders (labels on arrows,
  clipped node text, `Pub/Sub` split by TikZ `\foreach`, notes over arrows, `\code`
  dropping spaces) were fixed and re-checked.
- Extracted the PDF text: no replacement characters; no source-relative narration; the
  phrase "exactly-once" appears only in negations.
- Checked every line range in Appendix B and `CLAIM_MAP.md` against the files at the
  pinned commit (in bounds, and the first and last lines read).

## Evidence boundaries

- **Read only, nothing run.** This machine has no Docker. No service, test, Compose
  stack, emulator or cloud command was run, and no network or cloud calls were made
  apart from a read-only `git fetch --dry-run`. Every behavioural statement is derived
  from reading code and configuration.
- **"Exercised" claims are reported, not reproduced.** Statements that a flow ran on the
  local emulator come from earlier entries in `AI_USAGE_LOG.md`. The guide labels them
  as reported. The Cloud Pub/Sub transport is described as configured only, because
  those log entries record only `bash -n` and config parsing and say Cloud deployment
  was not run.
- **Pub/Sub platform behaviour** (non-2xx push responses are retried, messages only
  reach subscriptions that exist at publish time, ordering keys and filters) is general
  Google Cloud Pub/Sub behaviour that the repository's code comments rely on. It was not
  verified against the emulator here.
- **No exactly-once or end-to-end atomicity is claimed.** The guide states only what the
  code shows: the business change and the outbox row share one PostgreSQL transaction,
  publication is at-least-once, and consumers deduplicate.
- **Payload examples** use illustrative values; the field sets come from the code that
  builds each message.
- One edge case (concurrent conflicting registrations against the lagging user
  projection) is inferred from code structure and marked as such; it was not
  reproduced.

## Notes for the next task (event bus tap; not implemented)

The guide's Section 20 lists the constraints a tap design will meet:
- Add a new subscription per topic (fanout). Joining an existing subscription would
  compete with its consumer and take messages away from it.
- A tap only sees messages published after its subscription exists, and locally only
  while the emulator keeps running.
- The emulator's port 8085 is not published to the host.
- `type` attributes exist on every topic except `user-events`.
- `user-events` carries `passwordHash` and e-mail addresses, which a tap should not
  display or store as they are.
- Pull avoids public endpoints and OIDC verification; notification-service's
  per-instance subscription with an expiry policy is an existing precedent.

## Repair P1 (2026-10-19, after the independent review; self-tested, not re-reviewed)

The review's Low finding P1 said §2 claimed that commands "are sent only by the saga
orchestrator", but credit-service also ships a manual tool, `npm run command:publish`
(`credit-service/package.json` 10, `src/events/send-command.ts`), that publishes straight
to `credit-commands`. The §2 paragraph "Events vs commands" now says that in the normal
workflow only the saga sends commands, and names that tool as the one exception, an
operator test tool outside the workflow. `CLAIM_MAP.md` gained one row for this. Nothing
else in the guide changed.

Rebuilt with `latexmk -pdf -interaction=nonstopmode -halt-on-error guide.tex`: exit 0,
0 overfull boxes (24 underfull, as before), no undefined references, all fonts embedded.
It is still **33 pages**. Compared with the previous PDF, the extracted text differs only
on pages 4–6 (the new sentence, then page breaks moving within those pages). Page 6 ends
at the same text as before, and pages 1–3 and 7–33, including the table of contents, are
text-identical. Pages 4–6 were rendered and inspected.
