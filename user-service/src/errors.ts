/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Structured HTTP errors and nested database-error matching
    Author review: Done
**/
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function isPostgresUniqueViolation(error: unknown, constraint: string): boolean {
  let cause = error;
  while (typeof cause === "object" && cause !== null) {
    if (
      "code" in cause &&
      cause.code === "23505" &&
      "constraint" in cause &&
      cause.constraint === constraint
    ) {
      return true;
    }
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return false;
}
