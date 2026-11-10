/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-11.
 * Scope: One embedding request with the deployed settings, run by deploy.sh before the service,
 * so a wrong key, model or vector length stops the deploy instead of leaving orders unembedded.
 * Author review: Pending.
 */
import { config } from "./config.js";
import { EMBEDDING_DIMENSIONS } from "./db/schema.js";
import { embed } from "./ranking/embeddings.js";

if (config.embedding.provider !== "openai") {
  console.error("EMBEDDING_PROVIDER is not openai: the keyless hashing embedder is for development only.");
  process.exit(1);
}

try {
  const [vector] = await embed(["Embedding check: bubble tea from the COM2 canteen"]);
  console.log(`Embeddings OK: model ${config.embedding.model} at ${config.embedding.openaiBaseUrl} returned ${vector!.length} dimensions (database: ${EMBEDDING_DIMENSIONS}).`);
} catch (error) {
  console.error(`Embedding check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
