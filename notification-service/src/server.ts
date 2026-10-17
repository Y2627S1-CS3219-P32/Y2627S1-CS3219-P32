/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-17.
 * Scope: HTTP routes (health, ticket issuing) and the /ws WebSocket endpoint that
 * redeems a ticket, registers the socket for its user, and closes it when the user's
 * session would expire. Author review: Pending.
 */
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import express, { type ErrorRequestHandler } from "express";
import { WebSocketServer } from "ws";
import { issueTicket, redeemTicket, verifyAccessToken } from "./auth.js";
import { config } from "./config.js";
import { addSocket, allSockets } from "./connections.js";

export const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Called by the frontend's server with the user's JWT (which the browser cannot read).
app.post("/tickets", (req, res) => {
  const match = req.header("authorization")?.match(/^Bearer (\S+)$/i);
  const token = match ? verifyAccessToken(match[1]!) : undefined;
  if (!token) {
    res.status(401).json({ error: "A valid bearer token is required" });
    return;
  }
  res.status(201).json({ ticket: issueTicket(token), expiresIn: config.ticketTtlSeconds });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error("[notification-service] Request failed", error);
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

const HEARTBEAT_MS = 30_000;
// Timers cannot exceed about 24.8 days; sessions are much shorter anyway.
const MAX_TIMER_MS = 2 ** 31 - 1;

function reject(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function createNotificationServer() {
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") return reject(socket, 404, "Not Found");

    const origin = request.headers.origin;
    if (config.allowedOrigins.length > 0 && (!origin || !config.allowedOrigins.includes(origin))) {
      return reject(socket, 403, "Forbidden");
    }

    const session = redeemTicket(url.searchParams.get("ticket") ?? "");
    if (!session) return reject(socket, 401, "Unauthorized");

    wss.handleUpgrade(request, socket, head, (ws) => {
      addSocket(session.userId, ws);

      // Close when the JWT behind the ticket expires; the client then fetches a new ticket.
      const expiry = setTimeout(() => ws.close(4001, "Session expired"),
        Math.min(session.expiresAt * 1000 - Date.now(), MAX_TIMER_MS));

      // Drop connections that stop answering pings (e.g. a closed laptop).
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
      ws.send(JSON.stringify({ type: "ready" }));
    });
  });

  // Closes every socket with "going away" so clients reconnect to another instance.
  const closeAll = () => {
    for (const socket of allSockets()) socket.close(1001, "Server shutting down");
  };

  return { server, closeAll };
}
