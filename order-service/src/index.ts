/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Order-service startup. Author review: Pending.
 */
import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { requestOutboxPublish } from "./events/outbox.js";
import { ensureEmulatorResources } from "./events/pubsub.js";
// Claude Code (Opus 5.5), 2026-11-04: logs through the shared pino logger. Author review: Pending.
import { logger } from "./shared/logger.js";

pool.query("select 1")
  .then(ensureEmulatorResources)
  .then(() => {
    app.listen(config.port, "0.0.0.0", (error) => {
      if (error) throw error;
      logger.info({ port: config.port }, "Order service listening");
      // Publish anything left from before a restart.
      void requestOutboxPublish();
    });
  })
  .catch(async (error: unknown) => {
    logger.error({ err: error }, "Startup failed");
    await pool.end();
    process.exitCode = 1;
  });
