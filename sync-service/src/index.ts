/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Sync-service startup and graceful shutdown (deleting this instance's relay
 * subscription on SIGTERM). Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-10: logging through the shared pino logger. Author review: Pending.
 */
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { createSyncServer } from "./server.js";
import { startSubscriptions } from "./subscriptions.js";
import { logger } from "./shared/logger.js";

const { server, closeAll } = createSyncServer();

pool.query("select 1")
  .then(startSubscriptions)
  .then((stopSubscriptions) => {
    server.listen(config.port, "0.0.0.0", () => {
      logger.info({ port: config.port }, "Sync service listening");
    });
    const shutdown = async () => {
      closeAll();
      server.close();
      await stopSubscriptions();
      await pool.end();
      process.exit(0);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  })
  .catch((error: unknown) => {
    logger.error({ err: error }, "Startup failed");
    process.exitCode = 1;
  });
