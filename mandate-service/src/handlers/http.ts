import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ErrorRequestHandler } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { userId, HttpError } from '../common/validation.js';
import { report } from '../common/logging.js';
export { HttpError };

function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function authenticateUser(request: IncomingMessage) {
  const token = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must have at least 32 characters');
  if (!token) throw new HttpError(401, 'A login is required');
  const [header, payload, signature, extra] = token.split('.');
  if (
    !header ||
    !payload ||
    !signature ||
    extra ||
    !equal(
      signature,
      createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url'),
    )
  )
    throw new HttpError(401, 'Invalid access token');
  try {
    z.object({ alg: z.literal('HS256'), typ: z.literal('JWT') }).parse(
      JSON.parse(Buffer.from(header, 'base64url').toString()),
    );
    const value = z
      .object({
        sub: z.string().regex(/^[1-9]\d*$/),
        exp: z
          .number()
          .int()
          .gt(Date.now() / 1000),
      })
      .parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    return userId.parse(Number(value.sub));
  } catch {
    throw new HttpError(401, 'Invalid or expired access token');
  }
}
const google = new OAuth2Client();
export async function authenticateInternalCaller(request: IncomingMessage) {
  if (process.env.SERVICE_AUTH_MODE === 'local') {
    const secret = process.env.MANDATE_SERVICE_SECRET,
      supplied = request.headers['x-internal-secret'];
    if (secret && secret.length >= 32 && typeof supplied === 'string' && equal(secret, supplied))
      return;
  } else if (process.env.SERVICE_AUTH_MODE === 'google') {
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    const audience = process.env.MANDATE_SERVICE_AUDIENCE;
    if (token && audience) {
      const ticket = await google.verifyIdToken({ idToken: token, audience }).catch(() => null);
      const payload = ticket?.getPayload();
      if (
        payload?.email_verified &&
        payload.email &&
        (process.env.INTERNAL_INVOKER_EMAILS ?? '').split(',').includes(payload.email)
      )
        return;
    }
  }
  throw new HttpError(401, 'Internal authentication required');
}
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  const parsed = z.object({ type: z.enum(['entity.too.large', 'entity.parse.failed']) }).safeParse(error);
  if (parsed.success) {
    const tooLarge = parsed.data.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'Request too large' : 'Invalid JSON' });
  } else if (error instanceof HttpError) res.status(error.status).json({ error: error.message });
  else if (error instanceof z.ZodError) res.status(400).json({ error: 'Invalid request' });
  else {
    report(error);
    res.status(503).json({ error: 'Service unavailable' });
  }
};
