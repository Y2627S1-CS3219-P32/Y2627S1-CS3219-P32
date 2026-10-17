// AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
// Scope: Server-side client for the order service, forwarding the user's bearer token,
// mirroring the supplier-service client. Author review: Pending.
import type { H3Event } from "h3";
import type { Order, OrderAction, OrderCreate, OrderEdit, OrderEvent, OrderListQuery, OrderPage } from "#shared/services/order-service/types";

const FORWARDED_STATUSES = new Set([400, 401, 403, 404, 409, 503]);

function options(event: H3Event) {
  const token = getCookie(event, "user_access_token");
  if (!token) throw createError({ statusCode: 401, message: "A login is required." });
  return {
    baseURL: useRuntimeConfig(event).orderServiceBaseUrl,
    headers: { authorization: `Bearer ${token}` },
    timeout: 5000,
    retry: 0 as const,
  };
}

// Client errors from order-service keep their status and message; anything else is a 502.
function toOrderServiceError(error: unknown) {
  if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" && FORWARDED_STATUSES.has(error.statusCode)) {
    const data = "data" in error ? error.data : undefined;
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error
      : "The order request was rejected.";
    return createError({ statusCode: error.statusCode, message, data: { error: message } });
  }
  const message = "Orders are temporarily unavailable. Please try again.";
  return createError({ statusCode: 502, message, data: { error: message } });
}

async function call<T>(event: H3Event, path: string, init: Record<string, unknown> = {}): Promise<T> {
  const base = options(event);
  try {
    // Nitro types $fetch by route; these are external order-service paths.
    return (await $fetch(path, { ...base, ...init })) as T;
  } catch (error) {
    throw toOrderServiceError(error);
  }
}

const orderPath = (id: string) => `/orders/${encodeURIComponent(id)}`;

export const listOrders = (event: H3Event, query: OrderListQuery, mine = false) =>
  call<OrderPage>(event, mine ? "/orders/me" : "/orders", { query });
export const getOrder = (event: H3Event, id: string) => call<Order>(event, orderPath(id));
export const getOrderEvents = (event: H3Event, id: string) => call<OrderEvent[]>(event, `${orderPath(id)}/events`);
export const createOrder = (event: H3Event, body: OrderCreate) => call<Order>(event, "/orders", { method: "POST", body });
export const editOrder = (event: H3Event, id: string, body: OrderEdit) => call<Order>(event, orderPath(id), { method: "PATCH", body });
export const performOrderAction = (event: H3Event, id: string, action: OrderAction) =>
  call<Order>(event, `${orderPath(id)}/${action}`, { method: "POST" });

// Only the documented query parameters are forwarded.
export function orderListQuery(event: H3Event): OrderListQuery {
  const query = getQuery(event);
  const text = (key: string) => typeof query[key] === "string" && query[key].trim() ? query[key].trim() : undefined;
  return Object.fromEntries(
    (["state", "supplierId", "sort", "limit", "cursor"] as const).flatMap((key) => {
      const value = text(key);
      return value === undefined ? [] : [[key, value]];
    }),
  ) as OrderListQuery;
}
