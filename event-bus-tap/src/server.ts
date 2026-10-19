/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: The tap's HTTP side: static viewer, status, redacted export, and a
 * Server-Sent Events stream (snapshot on every connect, then live events and status).
 * Everything served comes from the store, which only holds redacted records.
 * Author review: Pending.
 */
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import type { TapConfig } from "./config.js";
import type { EventStore, StoredEvent } from "./store.js";
import type { Tap, TapStatus } from "./tap.js";

const HEARTBEAT_MS = 15_000;
// A browser this far behind is dropped; it reconnects and gets a fresh snapshot.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

interface Client {
  res: Response;
}

function hostName(header: string | undefined): string {
  if (!header) return "";
  const host = header.toLowerCase();
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
}

export function createTapServer(options: { tap: Tap; store: EventStore; config: TapConfig }): {
  server: Server;
  closeClients: () => void;
} {
  const { tap, store, config } = options;
  const clients = new Set<Client>();
  const app = express();
  app.disable("x-powered-by");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!config.allowedHosts.includes(hostName(req.headers.host))) {
      res.status(421).type("text/plain").send("Unknown host name; set TAP_ALLOWED_HOSTS to allow it");
      return;
    }
    res.setHeader("Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/health", (_req, res) => {
    res.type("text/plain").send("ok");
  });
  app.get("/health/ready", (_req, res) => {
    const status = tap.status();
    res.status(status.ready ? 200 : 503).json({ ready: status.ready, broker: status.broker.state });
  });
  app.get("/api/status", (_req, res) => {
    res.json(tap.status());
  });

  // Redacted export of the current buffer, optionally for some topics only.
  app.get("/api/events", (req, res) => {
    const topics = typeof req.query.topics === "string" ? new Set(req.query.topics.split(",").filter(Boolean)) : undefined;
    const events = store.list().filter((event) => !topics || topics.has(event.topic));
    res.json({ instanceId: tap.instanceId, exportedAt: new Date().toISOString(), redacted: true, events });
  });

  // A custom header cannot be sent cross-site without a CORS preflight, which is never allowed.
  app.post("/api/refresh", async (req, res) => {
    if (req.get("x-tap-request") !== "1") {
      res.status(403).json({ error: "Missing X-Tap-Request header" });
      return;
    }
    await tap.discover();
    res.json(tap.status());
  });

  app.get("/api/stream", (req, res) => {
    if (clients.size >= config.maxClients) {
      res.status(503).json({ error: "Too many viewers connected" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const client: Client = { res };
    clients.add(client);
    res.write("retry: 2000\n\n");
    send(client, "snapshot", { instanceId: tap.instanceId, events: store.list(), status: tap.status() });
    req.on("close", () => clients.delete(client));
    res.on("error", () => clients.delete(client));
  });

  app.use(express.static(PUBLIC_DIR, { index: "index.html" }));

  // JSON.stringify never emits raw newlines, so each message is one data line.
  function send(client: Client, event: string, data: unknown): void {
    if (client.res.writableLength > MAX_BUFFERED_BYTES) {
      clients.delete(client);
      client.res.destroy();
      return;
    }
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const onEvent = (event: StoredEvent) => {
    for (const client of clients) send(client, "tap-event", event);
  };
  const onStatus = (status: TapStatus) => {
    for (const client of clients) send(client, "status", status);
  };
  tap.on("event", onEvent);
  tap.on("status", onStatus);
  const heartbeat = setInterval(() => {
    for (const client of clients) client.res.write(": ping\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    server: createServer(app),
    closeClients: () => {
      clearInterval(heartbeat);
      tap.off("event", onEvent);
      tap.off("status", onStatus);
      for (const client of clients) client.res.end();
      clients.clear();
    },
  };
}
