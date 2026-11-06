/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Notification-service startup and graceful shutdown (deleting this instance's
 * subscription on SIGTERM). Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: database check and pool shutdown. Author review: Pending.
 */
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { createNotificationServer } from "./server.js";
import { subscribeToEvents } from "./subscription.js";
// Claude Code (Opus 5.5), 2026-11-04: logs through the shared pino logger. Author review: Pending.
import { logger } from "./shared/logger.js";

const { server, closeAll } = createNotificationServer();

pool.query("select 1")
  .then(subscribeToEvents)
  .then((subscription) => {
    server.listen(config.port, "0.0.0.0", () => {
      logger.info({ port: config.port, subscription: subscription.name }, "Notification service listening");
    });

    // Cloud Run sends SIGTERM before stopping an instance.
    const shutdown = async () => {
      closeAll();
      server.close();
      await subscription.stop();
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
