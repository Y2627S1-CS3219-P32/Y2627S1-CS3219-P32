/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-30
    Scope: Administrator role-change constraints
    Author review: Done
**/
import { HttpError } from "./errors";

export async function assertAdministratorCanBeDemoted(
  userId: number,
  actingUserId: number,
  getAdministratorCount: () => Promise<number>,
): Promise<void> {
  if (userId === actingUserId) {
    throw new HttpError(409, "You cannot demote your own administrator account");
  }
  const administratorCount = await getAdministratorCount();
  if (administratorCount <= 1) {
    throw new HttpError(409, "The last administrator cannot be demoted");
  }
}
