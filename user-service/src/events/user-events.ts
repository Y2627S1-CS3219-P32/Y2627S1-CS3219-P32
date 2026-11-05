/**
    AI Assistance Disclosure:
    Tool: Copilot SDK in VS Code, 2026-10-15
    Scope: User state-change event contract and Pub/Sub publisher
    Author review: Pending
**/
import { randomUUID } from "node:crypto";

import { PubSub } from "@google-cloud/pubsub";

import type { User } from "../db/schema";
import { reserveUserEventVersion } from "../repositories/users.repository";
import { publishMessage } from "../shared/messaging";

export const userEventsTopicName = process.env.PUBSUB_TOPIC ?? "user-events";
const projectId = process.env.PUBSUB_PROJECT_ID
  ?? process.env.GOOGLE_CLOUD_PROJECT
  ?? "foc-local";

export type UserSnapshot = Pick<
  User,
  "id" | "name" | "displayName" | "email" | "role" | "passwordHash"
>;

export type UserEventPayload =
  | { type: "user.created" | "user.updated"; user: UserSnapshot }
  | { type: "user.deleted"; userId: number };

export type UserEvent = UserEventPayload & { eventId: string; version: number };

export const pubsub = new PubSub({ projectId });
export const userEventsTopic = pubsub.topic(userEventsTopicName, { messageOrdering: true });

let topicInitialization: Promise<void> | undefined;

export async function ensureUserEventsTopic(): Promise<void> {
  if (!process.env.PUBSUB_EMULATOR_HOST) return;
  if (!topicInitialization) {
    topicInitialization = (async () => {
      const [exists] = await userEventsTopic.exists();
      if (!exists) {
        try {
          await pubsub.createTopic(userEventsTopicName);
        } catch (error) {
          if (
            typeof error !== "object" ||
            error === null ||
            !("code" in error) ||
            error.code !== 6
          ) {
            throw error;
          }
        }
      }
    })().catch((error: unknown) => {
      topicInitialization = undefined;
      throw error;
    });
  }
  await topicInitialization;
}

export async function publishUserEvent(
  event: UserEventPayload,
  orderingKey: number,
): Promise<void> {
  await ensureUserEventsTopic();
  const key = String(orderingKey);
  const version = await reserveUserEventVersion();
  try {
    // Claude Code (Opus 5.5), 2026-11-05: logged and traced by the shared helper; the type
    // attribute, as on the other topics, names the event in subscribers' logs.
    // Author review: Pending.
    await publishMessage(userEventsTopic, {
      json: { ...event, eventId: randomUUID(), version },
      orderingKey: key,
      attributes: { type: event.type },
    });
  } catch (error) {
    userEventsTopic.resumePublishing(key);
    throw error;
  }
}

export function userSnapshot(user: User): UserSnapshot {
  return {
    id: user.id,
    name: user.name,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    passwordHash: user.passwordHash,
  };
}
