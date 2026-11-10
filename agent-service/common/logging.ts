// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-10.
// Scope: report() through the shared pino logger (common/shared/, a copy of shared/src made by
// `node shared/sync.mjs` or the Dockerfile), so errors carry the stack, the service name and,
// with telemetry on, the trace they happened in. Author review: Pending.
import { logger } from './shared/logger.js';

export { logger };

export function report(error: unknown) {
  logger.error(
    { code: 'AGENT_ERROR', err: error },
    error instanceof Error ? error.message : 'Unknown error',
  );
}
