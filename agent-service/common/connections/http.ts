import { within } from '../deadline.js';
import { GoogleAuth } from 'google-auth-library';

export type Destination = 'supplier' | 'order' | 'mandate' | 'credit';
export type FailureKind = 'authentication' | 'rejected' | 'unavailable' | 'invalid_response' | 'cancelled' | 'uncertain_write';
export class ConnectionError extends Error {
  constructor(readonly kind: FailureKind, message: string, readonly status?: number) { super(message); }
}
export interface InternalRequest {
  destination: Destination; path: string; method: 'GET' | 'POST'; body: unknown;
  operation_key: string | null; signal: AbortSignal; traceparent?: string;
}
export type HttpConfig = {
  destinations: Record<Destination, { origin: string; audience?: string; secret?: string }>;
  auth: 'local' | 'google'; timeoutMs?: number; maxResponseBytes?: number;
};
const google = new GoogleAuth();
async function identityToken(audience: string): Promise<string> {
  const client = await google.getIdTokenClient(audience);
  return client.idTokenProvider.fetchIdToken(audience);
}

export function createTransport(config: HttpConfig, tokenProvider = identityToken) {
  const timeout = config.timeoutMs ?? 10_000, maxBytes = config.maxResponseBytes ?? 65_536;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid HTTP limits');
  for (const target of Object.values(config.destinations)) {
    const url = new URL(target.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid service origin');
    if (config.auth === 'google' && (url.protocol !== 'https:' || !target.audience)) throw new Error('Google authentication requires HTTPS and audience');
    if (config.auth === 'local' && (!target.secret || target.secret.length < 32)) throw new Error('Local service secret must have at least 32 characters');
  }
  return async (input: InternalRequest): Promise<unknown> => {
    const target = config.destinations[input.destination];
    const origin = new URL(target.origin);
    const url = new URL(input.path, origin);
    if (!input.path.startsWith('/') || input.path.startsWith('//') || input.path.includes('\\') || url.origin !== origin.origin || url.hash) throw new Error('Invalid internal path');
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(timeout)]);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (input.traceparent) headers.traceparent = input.traceparent;
    if (input.operation_key) headers['idempotency-key'] = input.operation_key;
    try {
      if (config.auth === 'local') headers['x-internal-secret'] = target.secret!;
      else headers.authorization = `Bearer ${await within(signal, () => tokenProvider(target.audience!))}`;
    } catch {
      if (signal.aborted) throw new ConnectionError('cancelled', 'Service identity acquisition cancelled');
      throw new ConnectionError('authentication', 'Service identity acquisition failed');
    }
    if (signal.aborted) throw new ConnectionError('cancelled', 'Service request cancelled');
    let sent = false;
    try {
      sent = true;
      const response = await fetch(url, { method: input.method, headers, redirect: 'error', signal,
        ...(input.method === 'GET' ? {} : { body: JSON.stringify(input.body) }) });
      if (!response.ok) {
        await response.body?.cancel();
        const kind = response.status === 401 || response.status === 403 ? 'authentication' :
          response.status >= 500 ? (input.operation_key ? 'uncertain_write' : 'unavailable') : 'rejected';
        throw new ConnectionError(kind, `Service returned HTTP ${response.status}`, response.status);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Expected JSON');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing JSON body');
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes) throw new Error('Service response too large');
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel(); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new Error('Invalid service JSON'); }
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      if (input.operation_key && sent) throw new ConnectionError('uncertain_write', 'Write outcome requires reconciliation');
      if (signal.aborted) throw new ConnectionError('cancelled', 'Service request cancelled or timed out');
      if (error instanceof TypeError) throw new ConnectionError('unavailable', 'Service request failed');
      throw new ConnectionError('invalid_response', 'Invalid service response');
    }
  };
}

export function httpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const auth = env.SERVICE_AUTH_MODE;
  if (auth !== 'local' && auth !== 'google') throw new Error('Set SERVICE_AUTH_MODE to local or google');
  function target(name: string) {
    const origin = env[`${name}_SERVICE_URL`];
    if (!origin) throw new Error(`Missing ${name}_SERVICE_URL`);
    const audience = env[`${name}_SERVICE_AUDIENCE`], secret = env[`${name}_SERVICE_SECRET`];
    return { origin, ...(audience ? { audience } : {}), ...(secret ? { secret } : {}) };
  }
  return { auth, destinations: { supplier: target('SUPPLIER'), order: target('ORDER'), mandate: target('MANDATE'), credit: target('CREDIT') } };
}
