import { PubSub } from '@google-cloud/pubsub';
import { approvalSchema } from './common/validation.js';
import * as repository from './repository.js';

let connection: PubSub | undefined;
function brokerConnection() {
  const projectId = process.env.PUBSUB_PROJECT_ID;
  if (!projectId || !/^[a-z][a-z0-9-]+$/.test(projectId)) throw new Error('Invalid Pub/Sub project');
  return (connection ??= new PubSub({ projectId }));
}
function getApprovalTopic() {
  const name = process.env.MANDATE_TOPIC;
  if (!name || !/^[a-zA-Z][\w.-]{2,254}$/.test(name)) throw new Error('Invalid MANDATE_TOPIC');
  return brokerConnection().topic(name, {
    batching: { maxMessages: 1 },
    gaxOpts: { timeout: 10_000 },
  });
}
export async function checkApprovalPublisherReadiness() {
  await getApprovalTopic().get({ timeout: 2000, retry: null });
}
export async function closeBrokerConnection() {
  await connection?.close();
  connection = undefined;
}
export async function publishPendingApprovals(signal: AbortSignal) {
  const publisher = getApprovalTopic();
  for (const { payload } of await repository.listPendingApprovalEvents()) {
    signal.throwIfAborted();
    const event = approvalSchema.parse(payload);
    const data = Buffer.from(JSON.stringify(event));
    if (data.length > 65_536) throw new Error('Event exceeds size limit');
    await publisher.publishMessage({ data });
    signal.throwIfAborted();
    await repository.markApprovalPublished(event.event_id);
  }
}
