/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Saga orchestrator startup. Author review: Pending.
 */
import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { requestPublish } from "./outbox.js";
import { ensureEmulatorResources } from "./pubsub.js";

pool.query("select 1")
  .then(ensureEmulatorResources)
  .then(() => {
    app.listen(config.port, "0.0.0.0", (error) => {
      if (error) throw error;
      console.log(`Saga orchestrator listening on http://localhost:${config.port}`);
      // Publish anything left from before a restart.
      requestPublish();
    });
  })
  .catch(async (error: unknown) => {
    console.error("[saga-orchestrator] Startup failed", error);
    await pool.end();
    process.exitCode = 1;
  });
