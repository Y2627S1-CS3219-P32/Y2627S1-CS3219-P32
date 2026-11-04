import { Router, type Request, type Response } from "express";
import { requirePubSubCaller } from "../http-handler/auth.js";
import { initializeAccount, deactivateAccount } from "../services/accounts.js";
import {
  reserveCredits,
  releaseCredits,
  transferCredits,
} from "../services/credits.js";
import { decodeMessage, parseCommand, parseUserEvent } from "./parsers.js";

export async function receiveUserEvent(req: Request, res: Response) {
  await requirePubSubCaller(req);
  const event = parseUserEvent(decodeMessage(req.body));
  const input = { requestId: event.eventId, userId: event.userId };
  switch (event.type) {
    case "user.created":
      await initializeAccount(input);
      break;
    case "user.deleted":
      await deactivateAccount(input);
      break;
  }
  res.status(200).json({ status: "ok" });
}

export async function receiveCreditCommand(req: Request, res: Response) {
  await requirePubSubCaller(req);
  const command = parseCommand(decodeMessage(req.body));
  switch (command.kind) {
    case "RESERVE":
      await reserveCredits(command);
      break;
    case "RELEASE":
      await releaseCredits(command);
      break;
    case "TRANSFER":
      await transferCredits(command);
      break;
  }
  res.sendStatus(204);
}

export const eventRouter = Router();
eventRouter.post("/internal/pubsub/user-events", receiveUserEvent);
eventRouter.post("/internal/pubsub/credit-commands", receiveCreditCommand);
