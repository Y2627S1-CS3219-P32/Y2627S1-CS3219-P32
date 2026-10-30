import { PubSub } from '@google-cloud/pubsub';
import { config } from '../config.js';
import { pool } from '../db/index.js';
import { checkDatabase } from '../repositories/health.js';

const pubsub = new PubSub({ projectId: config.projectId });
try {
  await checkDatabase();
  await pubsub.topic(config.creditTopic).getMetadata({ timeout: 3000 });
} catch {
  process.exitCode = 1;
} finally {
  await pubsub.close();
  await pool.end();
}
