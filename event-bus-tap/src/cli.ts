/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Terminal viewer for a running tap: prints events of the chosen topics from
 * the tap's stream. The filter is local; the tap keeps capturing every topic.
 * Author review: Pending.
 */
import { formatLine, type LineEvent, parseCliArgs, SseParser } from "./cli-format.js";

const { url, topics } = parseCliArgs(process.argv.slice(2));
let instanceId: string | undefined;
let lastSeq = 0;
let controller = new AbortController();
let stopped = false;

process.once("SIGINT", () => {
  stopped = true;
  controller.abort();
});

function show(event: LineEvent): void {
  if (event.seq <= lastSeq) return;
  lastSeq = event.seq;
  if (!topics || topics.has(event.topic)) console.log(formatLine(event));
}

async function connect(): Promise<void> {
  controller = new AbortController();
  const response = await fetch(new URL("/api/stream", url), { signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const parser = new SseParser((name, data) => {
    const message = JSON.parse(data);
    if (name === "snapshot") {
      // A different instance means the tap restarted and its sequence numbers too.
      if (message.instanceId !== instanceId) {
        instanceId = message.instanceId;
        lastSeq = 0;
        console.error(`# connected to tap ${instanceId}; showing ${topics ? [...topics].join(", ") : "all topics"}`);
      }
      for (const event of message.events) show(event);
    } else if (name === "tap-event") {
      show(message);
    }
  });
  const decoder = new TextDecoder();
  for await (const chunk of response.body) parser.push(decoder.decode(chunk, { stream: true }));
}

while (!stopped) {
  try {
    await connect();
    if (!stopped) console.error("# stream ended; reconnecting in 2 s");
  } catch (error) {
    if (stopped) break;
    console.error(`# disconnected (${error instanceof Error ? error.message : "error"}); retrying in 2 s`);
  }
  if (!stopped) await new Promise((resolve) => setTimeout(resolve, 2000));
}
