/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Order-ranking-service startup, mirroring order-service. Author review: Pending.
 * Claude Code (Opus 5.5), 2026-11-10: logging through the shared pino logger. Author review: Pending.
 */
import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { ensureEmulatorResources } from "./events/pubsub.js";
import { requestEmbedding } from "./ranking/embedding-job.js";
import { logger } from "./shared/logger.js";

pool.query("select 1")
  .then(ensureEmulatorResources)
  .then(() => {
    app.listen(config.port, "0.0.0.0", (error) => {
      if (error) throw error;
      logger.info({ port: config.port, embeddingProvider: config.embedding.provider }, `Order ranking service listening (embeddings: ${config.embedding.provider})`);
      // Embed anything left from before a restart.
      void requestEmbedding();
    });
  })
  .catch(async (error: unknown) => {
    logger.error({ err: error }, "Startup failed");
    await pool.end();
    process.exitCode = 1;
  });
