import { readFile } from "node:fs/promises";
import { userEvent, validateInitialCredits } from "./credit/accounts.js";
import { pool } from "./db/index.js";
const file = process.argv[2];
if (!file)
  throw new Error("Usage: npm run backfill -- <trusted-user-created.jsonl>");
const initialCredits = BigInt(process.env.INITIAL_CREDITS ?? "1000");
validateInitialCredits(initialCredits);
try {
  for (const line of (await readFile(file, "utf8"))
    .split("\n")
    .filter((line) => line.trim())) {
    const event: unknown = JSON.parse(line);
    if (
      typeof event !== "object" ||
      event === null ||
      !("type" in event) ||
      event.type !== "user.created"
    )
      throw new Error(
        "Backfill accepts only user.created envelopes with stable source eventId values",
      );
    await userEvent(event, initialCredits);
  }
} finally {
  await pool.end();
}
