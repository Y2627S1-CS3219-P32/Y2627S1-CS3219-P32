import { PubSub } from "@google-cloud/pubsub";
import { config } from "../config.js";
export async function provision() {
  const pubsub = new PubSub({ projectId: config.projectId });
  try {
    for (const name of [config.userTopic, config.creditTopic]) {
      try {
        await pubsub.createTopic(name);
      } catch (error) {
        if ((error as { code?: number }).code !== 6) throw error;
      }
    }
    const endpoint = new URL(
      "/internal/pubsub/user-events",
      config.pushBaseUrl,
    );
    if (config.internalSharedSecret)
      endpoint.searchParams.set("token", config.internalSharedSecret);
    const pushConfig = {
      pushEndpoint: endpoint.toString(),
      ...(config.pushInvokerEmail
        ? {
            oidcToken: {
              serviceAccountEmail: config.pushInvokerEmail,
              audience: config.internalAudience,
            },
          }
        : {}),
    };
    const subscription = pubsub.subscription(config.subscription);
    if (!(await subscription.exists())[0]) {
      await pubsub
        .topic(config.userTopic)
        .createSubscription(config.subscription, {
          pushConfig,
          ackDeadlineSeconds: 30,
          messageRetentionDuration: { seconds: 604800 },
          retryPolicy: {
            minimumBackoff: { seconds: 1 },
            maximumBackoff: { seconds: 30 },
          },
        });
    } else await subscription.setMetadata({ pushConfig });
    console.log(
      JSON.stringify({
        topic: config.userTopic,
        subscription: config.subscription,
        pushEndpoint: endpoint.origin + endpoint.pathname,
        status: "ready",
      }),
    );
  } finally {
    await pubsub.close();
  }
}
let attempt = 0;
while (true) {
  try {
    await provision();
    break;
  } catch (error) {
    if (++attempt >= 30) throw error;
    console.error(
      "pubsub_provision_retry",
      error instanceof Error ? error.message : "unknown",
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
