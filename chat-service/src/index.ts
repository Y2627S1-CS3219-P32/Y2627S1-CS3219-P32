import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { startEventSubscriptions } from "./events.js";

pool.query("select 1")
  .then(startEventSubscriptions)
  .then(({ stop }) => {
    const server = app.listen(config.port, "0.0.0.0", () => {
      console.log(`Chat service listening on http://localhost:${config.port}`);
    });

    const shutdown = async () => {
      server.close();
      await stop();
      await pool.end();
      process.exit(0);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  })
  .catch(async (error: unknown) => {
    console.error("[chat-service] Startup failed", error);
    await pool.end();
    process.exitCode = 1;
  });
