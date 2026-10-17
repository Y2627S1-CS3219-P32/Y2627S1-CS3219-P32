/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Order-service startup. Author review: Pending.
 */
import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { requestOutboxPublish } from "./events/outbox.js";
import { ensureEmulatorResources } from "./events/pubsub.js";

pool.query("select 1")
  .then(ensureEmulatorResources)
  .then(() => {
    app.listen(config.port, "0.0.0.0", (error) => {
      if (error) throw error;
      console.log(`Order service listening on http://localhost:${config.port}`);
      // Publish anything left from before a restart.
      requestOutboxPublish();
    });
  })
  .catch(async (error: unknown) => {
    console.error("[order-service] Startup failed", error);
    await pool.end();
    process.exitCode = 1;
  });
