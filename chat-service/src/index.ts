import { app, markInitialized } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { startEventSubscriptions } from "./events.js";

let stopSubscriptions: (() => Promise<void>) | undefined;
let shuttingDown = false;

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Chat service listening on http://0.0.0.0:${config.port}`);
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
    console.log("[chat-service] Database and Pub/Sub subscriptions initialized");
  } catch (error) {
    console.error("[chat-service] Startup initialization failed", error);
    try {
      await shutdown();
    } catch (shutdownError) {
      console.error("[chat-service] Shutdown after startup failure failed", shutdownError);
    }
    process.exit(1);
  }
}

process.once("SIGTERM", () => {
  void shutdown().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error("[chat-service] Shutdown failed", error);
      process.exit(1);
    },
  );
});
process.once("SIGINT", () => {
  void shutdown().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error("[chat-service] Shutdown failed", error);
      process.exit(1);
    },
  );
});

void initialize();
