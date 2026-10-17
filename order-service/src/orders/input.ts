/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Validation for POST /orders bodies (FR10.1) and GET /orders query
 * parameters (filters, +/- sorting, cursor pagination; FR11.1).
 * Author review: Pending.
 * Claude Code (Opus 5.5), 2026-10-17: title, PATCH /orders/:orderId bodies, and
 * comma-separated state filters for the frontend tabs. Author review: Pending.
 */
import { ORDER_STATES, type OrderState } from "../db/schema.js";
import { HttpError } from "../errors.js";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 500;
const MAX_DELIVERY_LOCATION = 256;
const MAX_CREDIT_REWARD = 2_147_483_647; // integer column limit

export interface OrderInput {
  supplierId: string;
  title: string;
  description: string;
  deliveryLocation: string;
  creditReward: number;
}

function text(body: Record<string, unknown>, field: string, max: number): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${field} is required`);
  if (value.trim().length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return value.trim();
}

export function parseOrderInput(body: unknown): OrderInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  const fields = body as Record<string, unknown>;

  const supplierId = fields.supplierId;
  if (typeof supplierId !== "string" || !UUID_PATTERN.test(supplierId)) {
    throw new HttpError(400, "supplierId must be a supplier id");
  }

  const creditReward = fields.creditReward;
  // FR10.1.2: a positive whole number.
  if (typeof creditReward !== "number" || !Number.isInteger(creditReward) || creditReward <= 0 || creditReward > MAX_CREDIT_REWARD) {
    throw new HttpError(400, "creditReward must be a positive whole number");
  }

  return {
    supplierId: supplierId.toLowerCase(),
    title: text(fields, "title", MAX_TITLE),
    description: text(fields, "description", MAX_DESCRIPTION),
    deliveryLocation: text(fields, "deliveryLocation", MAX_DELIVERY_LOCATION),
    creditReward,
  };
}

export type OrderEdit = Partial<Pick<OrderInput, "title" | "description" | "deliveryLocation">>;

const EDITABLE = { title: MAX_TITLE, description: MAX_DESCRIPTION, deliveryLocation: MAX_DELIVERY_LOCATION } as const;

// PATCH /orders/:orderId: only the text fields; the supplier and the reward are fixed.
export function parseOrderEdit(body: unknown): OrderEdit {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  const fields = body as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (keys.some((key) => !Object.hasOwn(EDITABLE, key))) {
    throw new HttpError(400, "Only title, description and deliveryLocation can be edited");
  }
  if (keys.length === 0) throw new HttpError(400, "Provide at least one field to edit");

  const edit: OrderEdit = {};
  for (const key of keys as (keyof typeof EDITABLE)[]) edit[key] = text(fields, key, EDITABLE[key]);
  return edit;
}

export const SORTS = ["createdAt", "-createdAt", "reward", "-reward"] as const;
export type Sort = (typeof SORTS)[number];

// The last item's sort value and id; the id breaks ties between equal values.
export interface Cursor {
  sort: Sort;
  value: string | number;
  id: string;
}

export interface ListQuery {
  states: OrderState[];
  supplierId: string | undefined;
  sort: Sort;
  limit: number;
  cursor: Cursor | undefined;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.sort, cursor.value, cursor.id])).toString("base64url");
}

function decodeCursor(value: string, sort: Sort): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 3) {
      const [cursorSort, sortValue, id] = parsed as unknown[];
      const valueMatches = sort.endsWith("reward")
        ? typeof sortValue === "number" && Number.isSafeInteger(sortValue)
        : typeof sortValue === "string" && !Number.isNaN(Date.parse(sortValue));
      if (cursorSort === sort && valueMatches && typeof id === "string" && UUID_PATTERN.test(id)) {
        return { sort, value: sortValue as string | number, id };
      }
    }
  } catch {
    // Reported below.
  }
  throw new HttpError(400, "cursor is invalid or does not match the requested sort");
}

function single(query: Record<string, unknown>, field: string): string | undefined {
  const value = query[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be given once`);
  return value.trim() || undefined;
}

export function parseListQuery(query: Record<string, unknown>): ListQuery {
  // One state or a comma-separated list, e.g. state=ACCEPTED,PICKED_UP,DELIVERED.
  const states = (single(query, "state") ?? "").split(",").map((state) => state.trim()).filter(Boolean);
  if (states.some((state) => !ORDER_STATES.includes(state as OrderState))) {
    throw new HttpError(400, `state must be one or more of ${ORDER_STATES.join(", ")}`);
  }

  const supplierId = single(query, "supplierId");
  if (supplierId !== undefined && !UUID_PATTERN.test(supplierId)) {
    throw new HttpError(400, "supplierId must be a supplier id");
  }

  const sort = single(query, "sort") ?? "-createdAt";
  if (!SORTS.includes(sort as Sort)) throw new HttpError(400, `sort must be one of ${SORTS.join(", ")}`);

  const limitText = single(query, "limit");
  const limit = limitText === undefined ? DEFAULT_LIMIT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new HttpError(400, `limit must be a whole number from 1 to ${MAX_LIMIT}`);
  }

  const cursorText = single(query, "cursor");
  return {
    states: [...new Set(states)] as OrderState[],
    supplierId: supplierId?.toLowerCase(),
    sort: sort as Sort,
    limit,
    cursor: cursorText === undefined ? undefined : decodeCursor(cursorText, sort as Sort),
  };
}
