import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { userId } from '../contracts/ids.js';
import { HttpError } from './errors.js';
import { report } from './logging.js';
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
export function sendJson(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
export function sendHttpError(response: ServerResponse, error: unknown) {
  if (response.headersSent) {
    response.end();
    return;
  }
  const parsed = z.object({ type: z.enum(['entity.too.large', 'entity.parse.failed']) }).safeParse(error);
  if (parsed.success) {
    const tooLarge = parsed.data.type === 'entity.too.large';
    sendJson(response, { error: tooLarge ? 'Request too large' : 'Invalid JSON' }, tooLarge ? 413 : 400);
  } else if (error instanceof HttpError) sendJson(response, { error: error.message }, error.status);
  else if (error instanceof z.ZodError) sendJson(response, { error: 'Invalid request' }, 400);
  else {
    report(error);
    sendJson(response, { error: 'Service unavailable' }, 503);
  }
}
