/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Browser-side view model of the event bus tap. The topic filter only decides
 * what is shown; every received event stays in the (bounded) client copy.
 * Author review: Pending.
 */

const ID_ORDER = ["orderId", "correlationId", "requestId", "commandId", "eventId", "userId", "supplierId", "sequence", "version"];

export function topicKind(topic) {
  if (topic.endsWith("-commands")) return "command";
  if (topic.endsWith("-events")) return "event";
  return "message";
}

export function createViewState(maxEvents = 1000) {
  return { maxEvents, instanceId: null, events: [], lastSeq: 0 };
}

// Replaces the client copy with the server's buffer (on every connect or reconnect).
// The tap's own limit (TAP_MAX_EVENTS) comes with the snapshot, so it is applied before trimming.
export function applySnapshot(state, snapshot) {
  const max = snapshot.status?.store?.max;
  if (Number.isInteger(max) && max > 0) state.maxEvents = max;
  state.instanceId = snapshot.instanceId;
  state.events = snapshot.events.slice(-state.maxEvents);
  state.lastSeq = state.events.length ? state.events[state.events.length - 1].seq : 0;
}

// Returns false for an event the client already has.
export function addEvent(state, event) {
  if (event.seq <= state.lastSeq) return false;
  state.events.push(event);
  state.lastSeq = event.seq;
  if (state.events.length > state.maxEvents) state.events.splice(0, state.events.length - state.maxEvents);
  return true;
}

// Newest first, only selected topics, only events after the last "clear".
export function visibleEvents(state, selectedTopics, clearedThroughSeq = 0) {
  const out = [];
  for (let i = state.events.length - 1; i >= 0; i--) {
    const event = state.events[i];
    if (event.seq > clearedThroughSeq && selectedTopics.has(event.topic)) out.push(event);
  }
  return out;
}

const STATE_TEXT = {
  ready: "listening", missing: "not created yet", subscribing: "subscribing", retrying: "retrying", error: "error",
};

// Label and style for a topic row. "listening" and "not created yet" are only known while
// the broker answers; an open stream does not necessarily fail when the broker goes away.
export function topicStateView(topic, brokerState) {
  if ((topic.state === "ready" || topic.state === "missing") && brokerState !== "connected") {
    const title = brokerState === "unreachable" ? "Broker unreachable: not known whether this topic is being read" : "Broker has not answered yet";
    return { text: "unknown", className: "state-unknown", title };
  }
  const text = topic.state === "retrying" && topic.retryInMs ? `retrying in ${Math.round(topic.retryInMs / 1000)} s` : STATE_TEXT[topic.state];
  return { text, className: `state-${topic.state}`, title: topic.lastError ?? topic.subscription ?? "" };
}

export function countByTopic(events) {
  const counts = new Map();
  for (const event of events) counts.set(event.topic, (counts.get(event.topic) ?? 0) + 1);
  return counts;
}

export function eventIds(event) {
  const ids = [];
  for (const field of ID_ORDER) {
    const value = event.ids?.[field];
    if (value !== undefined && value !== null) ids.push([field, String(value)]);
  }
  if (event.orderingKey) ids.push(["orderingKey", String(event.orderingKey)]);
  return ids;
}
