/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Event bus tap viewer: live stream over Server-Sent Events, topic toggles that
 * only filter the display, expandable redacted JSON. All message text is inserted with
 * textContent, never as HTML. Author review: Pending.
 */
import { addEvent, applySnapshot, countByTopic, createViewState, eventIds, topicKind, topicStateView, visibleEvents } from "./view.js";

const MAX_ROWS = 500;
const RECONNECT_MS = 3000;

const state = createViewState(1000);
const hidden = new Set(); // topics unticked by the user; new topics start ticked
const expanded = new Set(); // seq numbers whose details are open
let status = null;
let clearedThroughSeq = 0;
let paused = false;
let pausedAtSeq = 0; // while paused, only events up to here are shown
let source = null;
let renderQueued = false;

const $ = (id) => document.getElementById(id);

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.title) node.title = String(options.title);
  for (const child of children) node.append(child);
  return node;
}

function setBadge(node, kind, text, stateName) {
  node.className = `badge badge-${kind}`;
  node.textContent = text;
  node.dataset.state = stateName;
}

function time(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function allTopics() {
  const names = new Set((status?.topics ?? []).map((topic) => topic.topic));
  for (const event of state.events) names.add(event.topic);
  return [...names];
}

function selectedTopics() {
  return new Set(allTopics().filter((topic) => !hidden.has(topic)));
}

function renderTopics() {
  const list = $("topics");
  list.replaceChildren();
  const inView = countByTopic(state.events.filter((event) => event.seq > clearedThroughSeq));
  const topics = status?.topics ?? allTopics().map((topic) => ({ topic, kind: topicKind(topic), state: "missing", captured: 0 }));
  for (const topic of topics) {
    const box = el("input");
    box.type = "checkbox";
    box.checked = !hidden.has(topic.topic);
    box.dataset.topic = topic.topic;
    box.addEventListener("change", () => {
      if (box.checked) hidden.delete(topic.topic);
      else hidden.add(topic.topic);
      render();
    });
    const stateView = topicStateView(topic, status?.broker.state);
    const label = el("label", {}, [
      box,
      el("span", { text: topic.topic }),
      el("span", { className: `kind kind-${topic.kind}`, text: topic.kind }),
      el("span", { className: `state ${stateView.className}`, text: stateView.text, title: stateView.title }),
    ]);
    const meta = [`captured ${topic.captured}`, `in browser ${inView.get(topic.topic) ?? 0}`];
    if (topic.subscribedSince) meta.push(`since ${time(topic.subscribedSince)}`);
    if (topic.resubscriptions) meta.push(`resubscribed ×${topic.resubscriptions} (gap)`);
    if (topic.expected === false) meta.push("not one of the six known topics");
    const item = el("li", {}, [label, el("div", { className: "topic-meta", text: meta.join(" · ") })]);
    item.dataset.topicRow = topic.topic;
    if (topic.lastError) item.append(el("div", { className: "topic-meta", text: topic.lastError }));
    list.append(item);
  }
  if (topics.length === 0) list.append(el("li", { className: "muted", text: "No topics yet" }));
}

function detailRow(event) {
  const meta = el("dl");
  const fields = [
    ["topic", event.topic], ["subscription (tap's own)", event.subscription], ["message id", event.messageId],
    ["published", event.publishTime ?? "unknown"], ["received by tap", event.receivedAt],
    ["ordering key", event.orderingKey || "(none)"], ["delivery attempt", event.deliveryAttempt ?? "not reported"],
    ["size", `${event.sizeBytes} bytes`], ["payload", event.payloadStatus],
  ];
  for (const [name, value] of fields) meta.append(el("dt", { text: name }), el("dd", { text: value }));
  const cell = el("td", {}, [
    meta,
    el("div", { className: "muted small", text: "Attributes" }),
    el("pre", { text: JSON.stringify(event.attributes, null, 2) }),
    el("div", { className: "muted small", text: "Payload (redacted by the tap before it left the server)" }),
    el("pre", {
      className: "payload",
      text: event.payloadStatus === "json" ? JSON.stringify(event.payload, null, 2)
        : event.payloadStatus === "not-json" ? "(not JSON: not shown, because free text cannot be redacted reliably)"
          : event.payloadStatus === "too-large" ? "(larger than the tap's size limit: not kept)" : "(empty)",
    }),
  ]);
  cell.colSpan = 7;
  const row = el("tr", { className: "detail" }, [cell]);
  row.dataset.detailFor = String(event.seq);
  return row;
}

function eventRow(event) {
  const notes = el("td");
  if (event.redeliveryOf !== undefined) notes.append(el("span", { className: "flag", text: `redelivery of #${event.redeliveryOf}` }));
  if (event.sameIdAs) notes.append(el("span", { className: "flag", text: `same ${event.sameIdAs.key} as #${event.sameIdAs.seq}` }));
  if (event.payloadStatus !== "json") notes.append(el("span", { className: "flag", text: event.payloadStatus }));
  const row = el("tr", { className: expanded.has(event.seq) ? "event open" : "event" }, [
    el("td", { text: event.seq }),
    el("td", { className: "time", text: time(event.receivedAt), title: `published ${event.publishTime ?? "unknown"}` }),
    el("td", { className: "topic", text: event.topic }),
    el("td", {}, [el("span", { className: `kind kind-${event.kind}`, text: event.kind })]),
    el("td", { className: "type", text: event.type ?? "(no type)" }),
    el("td", { className: "ids" }, eventIds(event).map(([name, value]) => el("div", { text: `${name}=${value}` }))),
    notes,
  ]);
  row.dataset.seq = String(event.seq);
  row.dataset.topic = event.topic;
  row.addEventListener("click", () => {
    if (expanded.has(event.seq)) expanded.delete(event.seq);
    else expanded.add(event.seq);
    render();
  });
  return row;
}

function renderEvents() {
  let visible = visibleEvents(state, selectedTopics(), clearedThroughSeq);
  if (paused) visible = visible.filter((event) => event.seq <= pausedAtSeq);
  const body = $("events");
  const rows = [];
  for (const event of visible.slice(0, MAX_ROWS)) {
    rows.push(eventRow(event));
    if (expanded.has(event.seq)) rows.push(detailRow(event));
  }
  body.replaceChildren(...rows);
  const held = state.events.filter((event) => event.seq > clearedThroughSeq).length;
  const newWhilePaused = paused ? state.events.filter((event) => event.seq > pausedAtSeq).length : 0;
  const hiddenCount = held - visible.length - newWhilePaused;
  $("summary").textContent = `Showing ${Math.min(visible.length, MAX_ROWS)} of ${visible.length} events on selected topics`
    + (hiddenCount ? `; ${hiddenCount} captured on unticked topics are hidden` : "")
    + (paused ? `; paused (${newWhilePaused} newer events not shown yet)` : "");
  const empty = $("empty");
  empty.hidden = visible.length > 0;
  if (!status) empty.textContent = "Loading…";
  else if (held === 0) empty.textContent = "Waiting for messages. Use the application, and published messages appear here.";
  else empty.textContent = "No events on the selected topics.";
  const exportTopics = [...selectedTopics()].join(",");
  $("export").href = `api/events?topics=${encodeURIComponent(exportTopics)}`;
  if (status) {
    $("buffer").textContent = `Browser holds ${state.events.length} of at most ${state.maxEvents}. `
      + `Tap holds ${status.store.size} of at most ${status.store.max}; ${status.store.evicted} older events evicted.`;
  }
}

function render() {
  renderTopics();
  renderEvents();
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function applyStatus(next) {
  status = next;
  state.maxEvents = next.store.max;
  const broker = $("broker");
  if (next.broker.state === "connected") setBadge(broker, next.ready ? "ok" : "wait", next.ready ? "Broker: all topics subscribed" : "Broker: subscribing", "connected");
  else if (next.broker.state === "unreachable") {
    const error = next.broker.lastError ?? "";
    setBadge(broker, "bad", `Broker unreachable: ${error.length > 90 ? `${error.slice(0, 90)}…` : error}`, "unreachable");
  }
  else setBadge(broker, "wait", "Broker: connecting", "connecting");
  broker.title = next.broker.lastError ?? "";
  $("source").textContent = `${next.mode} · project ${next.projectId}${next.emulatorHost ? ` · ${next.emulatorHost}` : ""}`;
}

function connect() {
  setBadge($("connection"), "wait", "Connecting…", "connecting");
  source = new EventSource("api/stream");
  source.addEventListener("snapshot", (message) => {
    const snapshot = JSON.parse(message.data);
    const restarted = snapshot.instanceId !== state.instanceId; // a restarted tap counts from 1 again
    applySnapshot(state, snapshot);
    if (restarted) {
      clearedThroughSeq = 0;
      pausedAtSeq = state.lastSeq;
    }
    applyStatus(snapshot.status);
    setBadge($("connection"), "ok", "Live", "live");
    render();
  });
  source.addEventListener("tap-event", (message) => {
    const event = JSON.parse(message.data);
    if (!addEvent(state, event)) return;
    const topic = status?.topics.find((entry) => entry.topic === event.topic);
    if (topic) topic.captured++;
    scheduleRender();
  });
  source.addEventListener("status", (message) => {
    applyStatus(JSON.parse(message.data));
    scheduleRender();
  });
  source.addEventListener("error", () => {
    // The browser retries by itself while CONNECTING; if it gave up, start again.
    if (source.readyState === EventSource.CLOSED) {
      setBadge($("connection"), "bad", "Disconnected: retrying", "disconnected");
      source.close();
      setTimeout(connect, RECONNECT_MS);
    } else {
      setBadge($("connection"), "bad", "Disconnected: reconnecting…", "disconnected");
    }
  });
}

$("all").addEventListener("click", () => {
  hidden.clear();
  render();
});
$("none").addEventListener("click", () => {
  for (const topic of allTopics()) hidden.add(topic);
  render();
});
$("pause").addEventListener("click", () => {
  paused = !paused;
  pausedAtSeq = state.lastSeq;
  $("pause").setAttribute("aria-pressed", String(paused));
  $("pause").textContent = paused ? "Resume" : "Pause";
  render();
});
$("clear").addEventListener("click", () => {
  clearedThroughSeq = state.lastSeq;
  expanded.clear();
  render();
});
$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  try {
    const response = await fetch("api/refresh", { method: "POST", headers: { "X-Tap-Request": "1" } });
    if (response.ok) applyStatus(await response.json());
  } catch {
    // The connection badge already shows the problem.
  } finally {
    $("refresh").disabled = false;
    render();
  }
});

connect();
