import { CreditError, type Command } from "../credit/types.js";

function id(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new CreditError(400, "INVALID_COMMAND");
  return value.toLowerCase();
}
function integer(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    throw new CreditError(400, "INVALID_COMMAND");
  return value;
}
export function parseCommand(value: unknown): Command {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    !("requestId" in value) ||
    !("correlationId" in value) ||
    !("orderId" in value)
  )
    throw new CreditError(400, "INVALID_COMMAND");
  const base = {
    requestId: id(value.requestId),
    correlationId: id(value.correlationId),
    orderId: id(value.orderId),
  };
  if (value.type === "credit.transfer" && "courierId" in value)
    return { ...base, kind: "TRANSFER", courierId: integer(value.courierId) };
  if (
    (value.type === "credit.reserve" || value.type === "credit.release") &&
    "requesterId" in value &&
    "amount" in value
  ) {
    const fields = {
      requesterId: integer(value.requesterId),
      amount: integer(value.amount),
    };
    if (value.type === "credit.reserve")
      return { ...base, ...fields, kind: "RESERVE" };
    if (
      "reason" in value &&
      typeof value.reason === "string" &&
      value.reason.trim() &&
      value.reason.length <= 200
    )
      return { ...base, ...fields, kind: "RELEASE", reason: value.reason };
  }
  throw new CreditError(400, "INVALID_COMMAND");
}
