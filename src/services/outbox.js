import { randomUUID } from "node:crypto";

export class Outbox {
  #events = new Map();
  constructor({ requireDurable = false } = {}) {
    this.requireDurable = requireDurable === true;
  }

  enqueue({ eventType, subjectId, payloadHash, createdAt }) {
    const event = Object.freeze({ eventId: randomUUID(), eventType, subjectId, payloadHash, createdAt, attempts: 0, deliveryStateAttempts: 0, deadLetterAttempts: 0, deadLetterStateAttempts: 0, publishedAt: null, deadLetteredAt: null, durable: !this.requireDurable });
    this.#events.set(event.eventId, event);
    return event;
  }

  pending(limit = 100) {
    return [...this.#events.values()].filter((event) => !event.publishedAt && !event.deadLetteredAt && (!this.requireDurable || event.durable === true)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
  }
  pendingActive(maxAttempts, limit = 100) {
    return this.pending(Number.MAX_SAFE_INTEGER)
      .filter((event) => event.attempts < maxAttempts)
      .sort((a, b) => (a.deliveryStateAttempts ?? 0) - (b.deliveryStateAttempts ?? 0) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }

  pendingDeadLetter(maxAttempts, limit = 100) {
    return this.pending(Number.MAX_SAFE_INTEGER).filter((event) => event.attempts >= maxAttempts).sort((a, b) => (a.deadLetterStateAttempts ?? 0) - (b.deadLetterStateAttempts ?? 0) || (a.deadLetterAttempts ?? 0) - (b.deadLetterAttempts ?? 0) || a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
  }

  list() {
    return [...this.#events.values()];
  }

  recordAttempt(eventId) {
    const current = this.#events.get(eventId);
    if (!current || current.publishedAt || current.deadLetteredAt || (this.requireDurable && current.durable !== true)) throw new Error("OUTBOX_EVENT_NOT_PENDING");
    const next = Object.freeze({ ...current, attempts: current.attempts + 1 });
    this.#events.set(eventId, next);
    return next;
  }

  recordDeliveryStateAttempt(eventId) {
    const current = this.#events.get(eventId);
    if (!current || current.publishedAt || current.deadLetteredAt || (this.requireDurable && current.durable !== true)) throw new Error("OUTBOX_EVENT_NOT_PENDING");
    const next = Object.freeze({ ...current, deliveryStateAttempts: (current.deliveryStateAttempts ?? 0) + 1 });
    this.#events.set(eventId, next);
    return next;
  }

  recordDeadLetterAttempt(eventId) {
    const current = this.#events.get(eventId);
    if (!current || current.publishedAt || current.deadLetteredAt || (this.requireDurable && current.durable !== true)) throw new Error("OUTBOX_EVENT_NOT_PENDING");
    const next = Object.freeze({ ...current, deadLetterAttempts: (current.deadLetterAttempts ?? 0) + 1 });
    this.#events.set(eventId, next);
    return next;
  }

  recordDeadLetterStateAttempt(eventId) {
    const current = this.#events.get(eventId);
    if (!current || current.publishedAt || current.deadLetteredAt || (this.requireDurable && current.durable !== true)) throw new Error("OUTBOX_EVENT_NOT_PENDING");
    const next = Object.freeze({ ...current, deadLetterStateAttempts: (current.deadLetterStateAttempts ?? 0) + 1 });
    this.#events.set(eventId, next);
    return next;
  }
  markPublished(eventId, publishedAt) {
    const current = this.#events.get(eventId);
    if (!current) throw new Error("OUTBOX_EVENT_NOT_FOUND");
    if (current.publishedAt) return current;
    const next = Object.freeze({ ...current, publishedAt });
    this.#events.set(eventId, next);
    return next;
  }

  markDeadLettered(eventId, deadLetteredAt) {
    const current = this.#events.get(eventId);
    if (!current) throw new Error("OUTBOX_EVENT_NOT_FOUND");
    if (current.publishedAt) throw new Error("OUTBOX_EVENT_ALREADY_PUBLISHED");
    if (current.deadLetteredAt) return current;
    const next = Object.freeze({ ...current, deadLetteredAt });
    this.#events.set(eventId, next);
    return next;
  }

  markDurable(eventId) {
    const current = this.#events.get(eventId);
    if (!current) throw new Error("OUTBOX_EVENT_NOT_FOUND");
    if (current.durable === true) return current;
    const next = Object.freeze({ ...current, durable: true });
    this.#events.set(eventId, next);
    return next;
  }

  exportState() { return Object.freeze({ events: this.list() }); }
  importState(state) {
    if (this.#events.size || !Array.isArray(state?.events)) throw new Error("OUTBOX_STATE_IMPORT_REJECTED");
    for (const event of state.events) this.#events.set(event.eventId, Object.freeze({ ...event, deliveryStateAttempts: event.deliveryStateAttempts ?? 0, deadLetterAttempts: event.deadLetterAttempts ?? 0, deadLetterStateAttempts: event.deadLetterStateAttempts ?? 0, durable: this.requireDurable ? true : event.durable !== false }));
  }
}
