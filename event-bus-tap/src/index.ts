/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Event bus tap startup and graceful shutdown (deleting its own subscriptions).
 * Author review: Pending.
 */
import { randomBytes } from "node:crypto";
import { startTap } from "./app.js";
import { loadConfig } from "./config.js";
import { describeError } from "./redact.js";

async function main(): Promise<void> {
  const config = loadConfig();
  // Fresh per process, so two taps (or a restarted one) never share a subscription.
  const instanceId = randomBytes(4).toString("hex");
  const running = await startTap(config, { instanceId });
  console.log(`[event-bus-tap] ${config.mode} mode, project ${config.projectId}${config.emulatorHost ? ` at ${config.emulatorHost}` : ""}; viewer on ${running.url} (instance ${instanceId})`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[event-bus-tap] ${signal}: closing subscriptions`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await running.stop();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(`[event-bus-tap] Startup failed: ${describeError(error)}`);
  process.exitCode = 1;
});
