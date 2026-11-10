// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-04.
// Scope: Copy shared/src into each backend service's src/shared/ for running outside Docker.
// Author review: Pending.
//
// Usage, from anywhere:  node shared/sync.mjs
// Re-run after editing anything in shared/src. Docker builds copy shared/src themselves.
// Claude Code (Opus 5.5), 2026-11-10: chat, mail, order-ranking and sync services.
// Author review: Pending.
// Claude Code (Opus 5.5), 2026-11-10: mandate-service, and agent-service, whose copy is in
// common/shared/ (part of @campus/agent-contracts, used by its chat and orchestrator).
// Author review: Pending.
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const services = [
  "chat-service",
  "credit-service",
  "mail-service",
  "mandate-service",
  "notification-service",
  "order-ranking-service",
  "order-service",
  "saga-orchestrator",
  "supplier-service",
  "sync-service",
  "user-service",
];

// Relative to the repository root.
const targets = [...services.map((service) => join(service, "src", "shared")), join("agent-service", "common", "shared")];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "shared", "src");

for (const relative of targets) {
  // A generated, git-ignored folder: replace it whole so deleted files go too.
  const target = join(root, relative);
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  console.log(`shared/src -> ${relative.replaceAll("\\", "/")}`);
}
