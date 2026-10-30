/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-18.
 * Scope: Structured HTTP errors, mirroring order-service. Author review: Pending.
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}
