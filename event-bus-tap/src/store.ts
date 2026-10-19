/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Bounded in-memory event store for the tap, labelling redeliveries and
 * republished messages instead of dropping them. Author review: Pending.
 */
import type { CapturedEvent } from "./capture.js";

export interface StoredEvent extends CapturedEvent {
  seq: number;
  // Same topic and Pub/Sub message id as an earlier stored event: a redelivery.
  redeliveryOf?: number;
  // A new message id but the same business id: e.g. an outbox row published twice.
  sameIdAs?: { seq: number; key: string };
}

function businessKey(event: CapturedEvent): string | undefined {
  for (const field of ["eventId", "commandId", "requestId"] as const) {
    const value = event.ids[field];
    if (value !== undefined) return `${field} ${value}`;
  }
  return undefined;
}

export class EventStore {
  #events: StoredEvent[] = [];
  #nextSeq = 1;
  #evicted = 0;
  #capturedByTopic = new Map<string, number>();
  // Indexes only cover events still held, so they never outgrow the buffer.
  #byMessage = new Map<string, number>();
  #byBusinessKey = new Map<string, number>();

  constructor(readonly maxEvents: number) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) throw new Error("maxEvents must be a positive integer");
  }

  add(event: CapturedEvent): StoredEvent {
    const stored: StoredEvent = { ...event, seq: this.#nextSeq++ };
    const messageKey = `${event.topic}\n${event.messageId}`;
    const key = businessKey(event);
    const redeliveryOf = this.#byMessage.get(messageKey);
    if (redeliveryOf !== undefined) {
      stored.redeliveryOf = redeliveryOf;
    } else if (key !== undefined) {
      const earlier = this.#byBusinessKey.get(`${event.topic}\n${key}`);
      if (earlier !== undefined) stored.sameIdAs = { seq: earlier, key };
    }
    this.#byMessage.set(messageKey, stored.seq);
    if (key !== undefined) this.#byBusinessKey.set(`${event.topic}\n${key}`, stored.seq);
    this.#capturedByTopic.set(event.topic, (this.#capturedByTopic.get(event.topic) ?? 0) + 1);

    this.#events.push(stored);
    while (this.#events.length > this.maxEvents) this.#evict(this.#events.shift()!);
    return stored;
  }

  #evict(event: StoredEvent): void {
    this.#evicted++;
    const messageKey = `${event.topic}\n${event.messageId}`;
    if (this.#byMessage.get(messageKey) === event.seq) this.#byMessage.delete(messageKey);
    const key = businessKey(event);
    if (key !== undefined && this.#byBusinessKey.get(`${event.topic}\n${key}`) === event.seq) {
      this.#byBusinessKey.delete(`${event.topic}\n${key}`);
    }
  }

  list(): StoredEvent[] {
    return [...this.#events];
  }

  get size(): number {
    return this.#events.length;
  }

  get evicted(): number {
    return this.#evicted;
  }

  // Every event captured since start, per topic, including evicted ones.
  capturedByTopic(): Record<string, number> {
    return Object.fromEntries(this.#capturedByTopic);
  }

  indexSize(): number {
    return this.#byMessage.size + this.#byBusinessKey.size;
  }
}
