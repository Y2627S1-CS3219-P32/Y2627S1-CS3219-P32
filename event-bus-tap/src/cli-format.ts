/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Pure helpers for the terminal viewer: argument parsing, a small
 * Server-Sent Events parser, and safe one-line formatting. Author review: Pending.
 */
import { ID_FIELDS } from "./capture.js";
import type { StoredEvent } from "./store.js";

export type LineEvent = Pick<StoredEvent, "seq" | "topic" | "kind" | "type" | "receivedAt" | "ids" | "orderingKey" | "redeliveryOf" | "sameIdAs">;

export function parseCliArgs(args: string[]): { url: string; topics: Set<string> | undefined } {
  let url = "http://127.0.0.1:3010";
  let topics: Set<string> | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--url" && args[i + 1]) url = args[++i]!;
    else if (arg === "--topics" && args[i + 1]) topics = new Set(args[++i]!.split(",").map((topic) => topic.trim()).filter(Boolean));
    else throw new Error(`Unknown argument ${arg}; use --url <tap url> and --topics a,b`);
  }
  return { url, topics };
}

export class SseParser {
  #buffer = "";
  constructor(readonly onMessage: (event: string, data: string) => void) {}

  push(chunk: string): void {
    this.#buffer += chunk;
    let end: number;
    while ((end = this.#buffer.indexOf("\n\n")) !== -1) {
      const block = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data.push(line.slice(6));
      }
      if (data.length > 0) this.onMessage(event, data.join("\n"));
    }
  }
}

// Payload text could carry escape sequences that rewrite the terminal.
function safe(value: unknown): string {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
}

export function formatLine(event: LineEvent): string {
  const time = safe(event.receivedAt.slice(11, 23));
  const ids = ID_FIELDS.filter((field) => event.ids[field] !== undefined).map((field) => `${field}=${safe(event.ids[field])}`);
  const notes = [
    event.redeliveryOf !== undefined ? `redelivery of #${event.redeliveryOf}` : "",
    event.sameIdAs ? `same ${safe(event.sameIdAs.key)} as #${event.sameIdAs.seq}` : "",
  ].filter(Boolean);
  return [
    `#${event.seq}`, time, event.kind.toUpperCase().padEnd(7), safe(event.topic).padEnd(16), safe(event.type ?? "(no type)"),
    ids.join(" "), notes.length ? `[${notes.join("; ")}]` : "",
  ].filter(Boolean).join("  ");
}
