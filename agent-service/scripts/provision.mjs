import { PubSub } from '@google-cloud/pubsub';
export async function provision(projectId = process.env.PUBSUB_PROJECT_ID) {
  if (!process.env.PUBSUB_EMULATOR_HOST || !projectId)
    throw new Error('Provisioning is local-emulator-only');
  const client = new PubSub({ projectId });
  try {
    for (const [topicName, subscriptionName, ordered] of [
      ['agent-turns-dead-letter', 'agent-turns-failures', false],
      ['agent-turns', 'agent-orchestrator-turns', true],
      ['mandate-events', 'agent-chat-approvals', false],
    ]) {
      const topic = client.topic(topicName);
      try {
        await topic.create();
      } catch (error) {
        if (error.code !== 6) throw error;
      }
      const deadLetterPolicy =
        topicName === 'agent-turns'
          ? {
              deadLetterTopic: client.topic('agent-turns-dead-letter').name,
              maxDeliveryAttempts: 5,
            }
          : undefined;
      try {
        await topic.createSubscription(subscriptionName, {
          enableMessageOrdering: ordered,
          ackDeadlineSeconds: 30,
          ...(deadLetterPolicy ? { deadLetterPolicy } : {}),
        });
      } catch (error) {
        if (error.code !== 6) throw error;
      }
      if (deadLetterPolicy)
        await client.subscription(subscriptionName).setMetadata({ deadLetterPolicy });
    }
  } finally {
    await client.close();
  }
}
if (process.argv[1]?.endsWith('/provision.mjs')) await provision();
