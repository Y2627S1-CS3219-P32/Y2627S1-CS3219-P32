import { createApp } from "./app.js";
import { config } from "./config.js";
import { execute } from "./credit/commands.js";
import { userEvent, validateInitialCredits } from "./credit/accounts.js";
import { balance, reservation, lookup } from "./credit/queries.js";
import { pool } from "./db/index.js";
if (!config.jwtSecret) throw new Error("JWT_SECRET is required");
validateInitialCredits(config.initialCredits);
const server = createApp({
  execute,
  balance,
  reservation,
  lookup,
  userEvent: (event) => userEvent(event, config.initialCredits),
}).listen(
  config.port,
  () => console.log(`Credit API listening on ${config.port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => server.close(() => void pool.end()));
