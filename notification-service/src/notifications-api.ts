/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: Stored notifications for the signed-in user: cursor-paged list (newest first),
 * unread count, and marking as read. Author review: Pending.
 */
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { verifyAccessToken } from "./auth.js";
import { db } from "./db/index.js";
import { notifications } from "./db/schema.js";

class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_IDS = 100;

function requireUser(req: Request, res: Response, next: NextFunction): void {
  const match = req.header("authorization")?.match(/^Bearer (\S+)$/i);
  const token = match ? verifyAccessToken(match[1]!) : undefined;
  if (!token) throw new HttpError(401, "A valid bearer token is required");
  res.locals.userId = token.userId;
  next();
}

const userId = (res: Response) => res.locals.userId as number;

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
}

function decodeCursor(value: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [createdAt, id] = parsed as unknown[];
      if (typeof createdAt === "string" && !Number.isNaN(Date.parse(createdAt)) && typeof id === "string" && UUID.test(id)) {
        return [createdAt, id];
      }
    }
  } catch {
    // Reported below.
  }
  throw new HttpError(400, "cursor is invalid");
}

export const notificationsRouter = Router();
notificationsRouter.use("/notifications", requireUser);

notificationsRouter.get("/notifications", async (req, res) => {
  const limitText = typeof req.query.limit === "string" ? req.query.limit : undefined;
  const limit = limitText === undefined ? DEFAULT_LIMIT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new HttpError(400, `limit must be a whole number from 1 to ${MAX_LIMIT}`);
  }

  let after: SQL | undefined;
  if (typeof req.query.cursor === "string" && req.query.cursor) {
    const [createdAt, id] = decodeCursor(req.query.cursor);
    after = sql`(${notifications.createdAt}, ${notifications.id}) < (${createdAt}::timestamptz, ${id}::uuid)`;
  }

  const rows = await db
    .select({
      row: notifications,
      // Exact text keeps microseconds, so the cursor matches the stored value.
      createdAtText: sql<string>`${notifications.createdAt}::text`,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, userId(res)), after))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  res.json({
    items: page.map(({ row }) => ({
      id: row.id,
      source: row.source,
      type: row.type,
      orderId: row.orderId,
      payload: row.payload,
      createdAt: row.createdAt,
      read: row.readAt !== null,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAtText, last.row.id) : null,
  });
});

notificationsRouter.get("/notifications/unread-count", async (_req, res) => {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId(res)), isNull(notifications.readAt)));
  res.json({ count: result?.count ?? 0 });
});

// Body { ids: [...] } marks those; an empty body marks everything as read.
notificationsRouter.post("/notifications/read", async (req, res) => {
  const body: unknown = req.body ?? {};
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "Request body must be a JSON object");
  const ids = (body as Record<string, unknown>).ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === "string" && UUID.test(id)))) {
    throw new HttpError(400, `ids must be a list of 1 to ${MAX_IDS} notification ids`);
  }

  const updated = await db.update(notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(notifications.userId, userId(res)),
      isNull(notifications.readAt),
      ids ? inArray(notifications.id, (ids as string[]).map((id) => id.toLowerCase())) : undefined,
    ))
    .returning({ id: notifications.id });
  res.json({ updated: updated.length });
});

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
