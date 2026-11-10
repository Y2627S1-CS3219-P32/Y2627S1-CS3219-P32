// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-10.
// Scope: logging through the shared pino logger. Author review: Pending.
import { app, markInitialized } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { startEventSubscriptions } from "./events.js";
import { logger } from "./shared/logger.js";

let stopSubscriptions: (() => Promise<void>) | undefined;
let shuttingDown = false;

const server = app.listen(config.port, "0.0.0.0", () => {
  logger.info({ port: config.port }, "Chat service listening");
});

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (stopSubscriptions) await stopSubscriptions();
  await pool.end();
}

async function initialize(): Promise<void> {
  try {
    await pool.query("select 1");
    const subscriptions = await startEventSubscriptions();
    stopSubscriptions = subscriptions.stop;
    markInitialized();
    logger.info("Database and Pub/Sub subscriptions initialized");
  } catch (error) {
    logger.error({ err: error }, "Startup initialization failed");
    try {
      await shutdown();
    } catch (shutdownError) {
      logger.error({ err: shutdownError }, "Shutdown after startup failure failed");
    }
    process.exit(1);
  }
}

process.once("SIGTERM", () => {
  void shutdown().then(
    () => process.exit(0),
    (error: unknown) => {
      logger.error({ err: error }, "Shutdown failed");
      process.exit(1);
    },
  );
});
process.once("SIGINT", () => {
  void shutdown().then(
    () => process.exit(0),
    (error: unknown) => {
      logger.error({ err: error }, "Shutdown failed");
      process.exit(1);
    },
  );
});

void initialize();
