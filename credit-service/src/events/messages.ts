import { CreditError } from "../credit/types.js";

export function decodeMessage(body: unknown): unknown {
  if (
    typeof body !== "object" ||
    body === null ||
    !("message" in body) ||
    typeof body.message !== "object" ||
    body.message === null ||
    !("data" in body.message) ||
    typeof body.message.data !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(body.message.data)
  )
    throw new CreditError(400, "INVALID_EVENT");
  try {
    return JSON.parse(
      Buffer.from(body.message.data, "base64").toString("utf8"),
    );
  } catch {
    throw new CreditError(400, "INVALID_EVENT");
  }
}
