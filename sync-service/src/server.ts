/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: HTTP routes (health, tickets, placing a group order) and the
 * /documents/:orderId WebSocket endpoint, which only the requester and members of an open
 * group order may join. Author review: Pending.
 */
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { and, eq } from "drizzle-orm";
import express, { type ErrorRequestHandler, type Request } from "express";
import { WebSocketServer } from "ws";
import { issueTicket, redeemTicket, verifyAccessToken, type AccessToken } from "./auth.js";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { documentMembers, documents } from "./db/schema.js";
import { attachConnection } from "./documents.js";
import { PlaceError, placeDocument } from "./place.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const app = express();
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

function bearer(req: Request): AccessToken | undefined {
  const match = req.header("authorization")?.match(/^Bearer (\S+)$/i);
  return match ? verifyAccessToken(match[1]!) : undefined;
}

// Called by the frontend's server with the user's JWT (which the browser cannot read).
app.post("/tickets", (req, res) => {
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: "A valid bearer token is required" });
    return;
  }
  res.status(201).json({ ticket: issueTicket(token), expiresIn: config.ticketTtlSeconds });
});

app.post("/documents/:orderId/place", async (req, res) => {
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: "A valid bearer token is required" });
    return;
  }
  const orderId = req.params.orderId;
  if (typeof orderId !== "string" || !UUID.test(orderId)) {
    res.status(404).json({ error: "Group order not found" });
    return;
  }
  const description = await placeDocument(orderId.toLowerCase(), token.userId);
  res.status(202).json({ status: "placed", description });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof PlaceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ error: "Request body contains invalid JSON" });
    return;
  }
  console.error("[sync-service] Request failed", error);
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

function reject(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

// Whether the user may edit the document: 0 = yes, otherwise the HTTP status to refuse with.
async function accessStatus(orderId: string, userId: number): Promise<[number, string] | undefined> {
  const [document] = await db.select().from(documents).where(eq(documents.orderId, orderId));
  // The order.group_started event may not have arrived yet; the client retries.
  if (!document) return [404, "Not Found"];
  if (document.status !== "open") return [409, "Conflict"];
  if (document.requesterId === userId) return undefined;
  const [member] = await db.select().from(documentMembers)
    .where(and(eq(documentMembers.orderId, orderId), eq(documentMembers.userId, userId)));
  return member ? undefined : [403, "Forbidden"];
}

const HEARTBEAT_MS = 30_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

export function createSyncServer() {
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const match = url.pathname.match(/^\/documents\/([0-9a-f-]{36})$/i);
    if (!match || !UUID.test(match[1]!)) return reject(socket, 404, "Not Found");
    const orderId = match[1]!.toLowerCase();

    const origin = request.headers.origin;
    if (config.allowedOrigins.length > 0 && (!origin || !config.allowedOrigins.includes(origin))) {
      return reject(socket, 403, "Forbidden");
    }
    const session = redeemTicket(url.searchParams.get("ticket") ?? "");
    if (!session) return reject(socket, 401, "Unauthorized");

    let refused: [number, string] | undefined;
    try {
      refused = await accessStatus(orderId, session.userId);
    } catch (error) {
      console.error("[sync-service] Access check failed", error);
      refused = [503, "Service Unavailable"];
    }
    if (refused) return reject(socket, ...refused);

    wss.handleUpgrade(request, socket, head, (ws) => {
      attachConnection(ws, orderId);

      const expiry = setTimeout(() => ws.close(4001, "Session expired"),
        Math.min(session.expiresAt * 1000 - Date.now(), MAX_TIMER_MS));
      let alive = true;
      ws.on("pong", () => { alive = true; });
      const heartbeat = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, HEARTBEAT_MS);
      ws.once("close", () => {
        clearTimeout(expiry);
        clearInterval(heartbeat);
      });
    });
  });

  const closeAll = () => {
    for (const client of wss.clients) client.close(1001, "Server shutting down");
  };
  return { server, closeAll };
}
