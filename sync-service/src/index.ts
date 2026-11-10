/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Sync-service startup and graceful shutdown (deleting this instance's relay
 * subscription on SIGTERM). Author review: Pending.
 */
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { createSyncServer } from "./server.js";
import { startSubscriptions } from "./subscriptions.js";

const { server, closeAll } = createSyncServer();

pool.query("select 1")
  .then(startSubscriptions)
  .then((stopSubscriptions) => {
    server.listen(config.port, "0.0.0.0", () => {
      console.log(`Sync service listening on http://localhost:${config.port}`);
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
    console.error("[sync-service] Startup failed", error);
    process.exitCode = 1;
  });
