/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Redaction applied to every message before the tap stores it, so nothing that
 * leaves the process (browser, CLI, export, logs) can carry a secret. Author review: Pending.
 */

export const REDACTED = "[redacted]";

const MAX_DEPTH = 32;
const MAX_STRING = 2000;
// Scrubbing runs on this much text before the cut, so a secret straddling MAX_STRING still
// has its full shape. It is bounded because the e-mail pattern is quadratic on long runs.
const SCRUB_WINDOW = MAX_STRING + 2000;
const MAX_ITEMS = 200;

// Compared against the key lower-cased with separators removed, e.g. "passwordHash", "api-key".
const SENSITIVE_KEY_PARTS = [
  "password", "passwd", "pwd", "secret", "token", "hash", "salt", "authorization", "cookie",
  "apikey", "credential", "privatekey", "signature", "session", "ticket", "jwt", "bearer",
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const JWT = /eyJ[\w-]*\.[\w-]+\.[\w-]*/g;
const BEARER = /\b(Bearer|Basic)\s+[\w.~+/=-]+/gi;
const PASSWORD_HASH = /(scrypt\$|\$2[aby]\$|\$argon2)\S*/g;
const URL_SECRET = /([?&](?:token|secret|key|password|sig|signature|access_token|code)=)[^&\s#"']*/gi;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function isEmailKey(key: string): boolean {
  return /e-?mail/i.test(key);
}

// "ada.tan@u.nus.edu" -> "a***@u.nus.edu".
export function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return REDACTED;
  return `${value[0]}***${value.slice(at)}`;
}

// Removes secret-looking substrings from any string, whatever key it is under.
// Patterns are applied before truncation, so the cut never breaks a secret's shape.
export function scrubString(value: string): string {
  const out = value
    .slice(0, SCRUB_WINDOW)
    .replace(PEM, REDACTED)
    .replace(JWT, REDACTED)
    .replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(PASSWORD_HASH, REDACTED)
    .replace(URL_SECRET, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(EMAIL, (match) => maskEmail(match));
  return value.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[truncated]` : out;
}

function redactAt(value: unknown, key: string | undefined, depth: number): unknown {
  if (key !== undefined && isSensitiveKey(key)) return REDACTED;
  if (typeof value === "string") {
    return key !== undefined && isEmailKey(key) ? maskEmail(value) : scrubString(value);
  }
  if (value === null || typeof value !== "object") {
    return typeof value === "number" || typeof value === "boolean" ? value : value === null ? null : String(value);
  }
  if (depth >= MAX_DEPTH) return "[truncated: too deep]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => redactAt(item, undefined, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`[truncated: ${value.length - MAX_ITEMS} more items]`);
    return items;
  }
  const entries = Object.entries(value);
  // Object.fromEntries defines own properties, so a "__proto__" key stays plain data.
  const out = Object.fromEntries(entries.slice(0, MAX_ITEMS).map(([k, v]) => [scrubString(k), redactAt(v, k, depth + 1)]));
  if (entries.length > MAX_ITEMS) out["[truncated]"] = `${entries.length - MAX_ITEMS} more keys`;
  return out;
}

// A redacted deep copy of a parsed JSON value.
export function redactValue(value: unknown): unknown {
  return redactAt(value, undefined, 0);
}

export function redactAttributes(attributes: Record<string, string>): Record<string, string> {
  return redactValue(attributes) as Record<string, string>;
}

// Error text can include endpoints with ?token=..., so it is scrubbed before it is shown.
export function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return scrubString(text).slice(0, 500);
}
