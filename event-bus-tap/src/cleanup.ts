/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Emulator-only cleanup of tap subscriptions left by a tap that was killed
 * without shutting down. Lists by default; deletes only with --yes. Author review: Pending.
 */
import { PubSubBroker } from "./broker.js";
import { isTapSubscriptionName, loadConfig } from "./config.js";
import { describeError } from "./redact.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.mode !== "emulator") throw new Error("Cleanup only runs against the emulator");
  const broker = new PubSubBroker(config);
  try {
    const names = (await broker.listSubscriptionNames()).filter(isTapSubscriptionName);
    if (names.length === 0) console.log("No tap subscriptions found.");
    for (const name of names) {
      if (process.argv.includes("--yes")) {
        await broker.deleteSubscription(name);
        console.log(`Deleted ${name}`);
      } else {
        console.log(`Would delete ${name}`);
      }
    }
    if (names.length > 0 && !process.argv.includes("--yes")) {
      console.log("Stop running taps first, then re-run with --yes to delete these.");
    }
  } finally {
    await broker.close();
  }
}

main().catch((error: unknown) => {
  console.error(`[event-bus-tap] Cleanup failed: ${describeError(error)}`);
  process.exitCode = 1;
});
