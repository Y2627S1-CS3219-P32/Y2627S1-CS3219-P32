import { readFile } from "node:fs/promises";
import { PubSub } from "@google-cloud/pubsub";
import { config } from "../config.js";
import { COMMAND_TYPES, parseCommand } from "../event-handler/parsers.js";

const path = process.argv[2];
if (!path || process.argv.length !== 3)
  throw new Error("Usage: npm run command:publish -- path/to/command.json");
const value: unknown = JSON.parse(await readFile(path, "utf8"));
const command = parseCommand(value);
const { kind, ...fields } = command;
const type = COMMAND_TYPES[kind];
const pubsub = new PubSub({ projectId: config.projectId });
try {
  const messageId = await pubsub.topic(config.commandTopic).publishMessage({
    json: { ...fields, type },
    orderingKey: command.orderId,
    attributes: { type },
  });
  console.log(
    JSON.stringify({
      messageId,
      requestId: command.requestId,
      correlationId: command.correlationId,
      status: "accepted_by_broker",
      message:
        "Broker acceptance is not business completion. Read the outcome on credit-events.",
    }),
  );
} finally {
  await pubsub.close();
}
