/**AI Assistance Disclosure:
Tool: Claude Code (model: Opus 5.5), date: 2026-09-29
Scope: Structured HTTP errors for supplier-service handlers, mirroring user-service.
Author review: Done.
Tool: Claude Code (model: Opus 5.5), date: 2026-10-18
Scope: Optional response headers (such as retry-after).
Author review: Pending. **/

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
