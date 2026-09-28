<!-- AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
Scope: Consolidated AI disclosure. Author review: Done. -->
# CS3219 — Software Design and Architecture (AY2627 Sem 1)

## Friend on Campus (FoC)

**Friend on Campus (FoC)** is a peer-to-peer campus errand platform where
students can request items to be collected from stores or facilities on
campus, and other students can fulfil (and deliver) those requests. The
platform runs on a closed credit economy — credits cannot be bought,
withdrawn, or exchanged for money, and only circulate within the platform.

---

## Team Members

| Name | Role |
| ----- | ----- |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |

---

## Repository Structure

This repository follows a **one-service-per-folder** structure: each
microservice (`user-service/`, `supplier-service/`, `order-service/`,
`credit-service/`) lives in its own top-level folder.

```text
.
├── user-service/
├── supplier-service/
├── order-service/
├── credit-service/
├── <n2h-service>/
└── README.md
```

- Any **nice-to-have (N2H)** feature that warrants its own service should
  be added as an **additional folder** at the same level, following the
  same per-service structure.
- Files for agentic coding tools (e.g. agent configs, prompts, skills)
  may be added as needed, but must still **respect the
  one-service-per-folder skeleton** for core implementation.

---

## AI Assistance Disclosure - Supplier Service

Tool: ChatGPT / Codex (GPT-6). Modes: boilerplate generation, debugging,
documentation, and verification. Supplier-service setup assistance is recorded
in the [service README](supplier-service/README.md). The exact Drizzle setup
prompt, subsequent TypeScript configuration fix, schema implementation and migration,
CSV-derived seed implementation, local database connection fix, key responses, affected files,
and review status are in the
[AI usage log](AI_USAGE_LOG.md).

Drizzle assistance covers connection and tooling boilerplate and implementation
of the student-defined database schema. Database schema and architecture decisions
remain with the student. Prior setup was reviewed; the latest schema, migration, and seed
changes await student review.
Link this README from the submission slide deck when it is created.
