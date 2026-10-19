/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Terminal viewer formatting: stream parsing, topic filter arguments, and
 * escape sequences in payload text never reaching the terminal. Author review: Pending.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLine, parseCliArgs, SseParser } from "../dist/cli-format.js";

test("server-sent events are parsed across chunk boundaries", () => {
  const seen = [];
  const parser = new SseParser((name, data) => seen.push([name, data]));
  parser.push("retry: 2000\n\nevent: snap");
  parser.push('shot\ndata: {"a":1}\n\n: ping\n\nevent: tap-event\ndata: {"b":2}\n');
  assert.deepEqual(seen, [["snapshot", '{"a":1}']]);
  parser.push("\n");
  assert.deepEqual(seen, [["snapshot", '{"a":1}'], ["tap-event", '{"b":2}']]);
});

test("arguments choose the tap URL and the shown topics", () => {
  assert.deepEqual(parseCliArgs([]), { url: "http://127.0.0.1:3010", topics: undefined });
  const parsed = parseCliArgs(["--url", "http://localhost:4000", "--topics", "order-events,credit-events"]);
  assert.equal(parsed.url, "http://localhost:4000");
  assert.deepEqual([...parsed.topics], ["order-events", "credit-events"]);
  assert.throws(() => parseCliArgs(["--bogus"]), /Unknown argument/);
});

test("a line shows kind, topic, type, ids and duplicate labels", () => {
  const line = formatLine({
    seq: 4, topic: "credit-commands", kind: "command", type: "credit.reserve", receivedAt: "2026-10-19T03:15:22.481Z",
    ids: { orderId: "o-1", requestId: "r-1" }, orderingKey: "o-1", redeliveryOf: 2,
  });
  assert.match(line, /#4/);
  assert.match(line, /COMMAND/);
  assert.match(line, /credit-commands/);
  assert.match(line, /credit\.reserve/);
  assert.match(line, /orderId=o-1 requestId=r-1/);
  assert.match(line, /redelivery of #2/);
});

test("terminal control characters from payloads are neutralised", () => {
  const line = formatLine({
    seq: 1, topic: "order-events", kind: "event", type: "\u001b[31mevil\u001b]0;title\u0007\r\n", receivedAt: "2026-10-19T03:15:22.481Z",
    ids: { orderId: "\u001b[2J" }, orderingKey: "",
  });
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(line), JSON.stringify(line));
});
