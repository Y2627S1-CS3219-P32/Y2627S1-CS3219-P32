/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-31.
 * Scope: Order-ranking-service startup, mirroring order-service. Author review: Pending.
 */
import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { ensureEmulatorResources } from "./events/pubsub.js";
import { requestEmbedding } from "./ranking/embedding-job.js";

pool.query("select 1")
  .then(ensureEmulatorResources)
  .then(() => {
    app.listen(config.port, "0.0.0.0", (error) => {
      if (error) throw error;
      console.log(`Order ranking service listening on http://localhost:${config.port} (embeddings: ${config.embedding.provider})`);
      // Embed anything left from before a restart.
      void requestEmbedding();
    });
  })
  .catch(async (error: unknown) => {
    console.error("[order-ranking-service] Startup failed", error);
    await pool.end();
    process.exitCode = 1;
  });
