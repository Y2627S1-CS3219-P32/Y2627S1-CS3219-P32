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

export function errorHasMessage(error: unknown, message: string): boolean {
  let cause = error;
  while (cause instanceof Error) {
    if (cause.message.includes(message)) return true;
    cause = cause.cause;
  }
  return false;
}
