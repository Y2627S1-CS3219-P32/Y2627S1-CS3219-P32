import { PubSub } from "@google-cloud/pubsub";
import { config } from "../config.js";
import { db, pool } from "../db/index.js";
import { sql } from "drizzle-orm";
const pubsub = new PubSub({ projectId: config.projectId });
try {
  await db.execute(sql`SELECT 1`);
  await pubsub.topic(config.creditTopic).getMetadata({ timeout: 3000 });
} catch {
  process.exitCode = 1;
} finally {
  await pubsub.close();
  await pool.end();
}
