/**
    AI Assistance Disclosure:
    Tool: Copilot SDK in VS Code, 2026-10-15
    Scope: User state-change event contract and Pub/Sub publisher
    Author review: Pending
    Tool: ChatGPT (GPT-6), 2026-11-04
    Scope: Include account verification fields in user event snapshots
    Author review: Pending
**/
import { randomUUID } from "node:crypto";

import { PubSub } from "@google-cloud/pubsub";

import type { User, VerificationPurpose } from "../db/schema";
import { reserveUserEventVersion } from "../repositories/users.repository";

export const userEventsTopicName = process.env.PUBSUB_TOPIC ?? "user-events";
const projectId = process.env.PUBSUB_PROJECT_ID
  ?? process.env.GOOGLE_CLOUD_PROJECT
  ?? "foc-local";

export type UserSnapshot = Pick<
  User,
  | "id"
  | "name"
  | "displayName"
  | "email"
  | "role"
  | "passwordHash"
  | "verificationStatus"
  | "verificationCode"
  | "verificationPurpose"
>;

export type UserEventPayload =
  | { type: "user.created" | "user.updated"; user: UserSnapshot }
  | {
      type: "user.verified";
      user: UserSnapshot;
      verificationPurpose: VerificationPurpose;
    }
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
    await userEventsTopic.publishMessage({
      json: { ...event, eventId: randomUUID(), version },
      orderingKey: key,
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
    verificationStatus: user.verificationStatus,
    verificationCode: user.verificationCode,
    verificationPurpose: user.verificationPurpose,
  };
}
