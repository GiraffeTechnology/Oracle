export class OutboxDispatcher {
  constructor({ outbox, publisher, deliveryStore = null, clock = () => new Date(), maxAttempts = 5 }) {
    Object.assign(this, { outbox, publisher, deliveryStore, clock, maxAttempts });
  }

  async drain(limit = 100) {
    const results = [];
    const activeEvents = this.outbox.pendingActive(this.maxAttempts, limit);
    const deadLetterEvents = this.outbox.pendingDeadLetter(this.maxAttempts, limit);
    for (const event of activeEvents) {
      try {
        const attempts = event.attempts + 1;
        await this.deliveryStore?.recordOutboxAttempt(event.eventId, attempts);
        this.outbox.recordAttempt(event.eventId);
      } catch {
        results.push({ eventId: event.eventId, status: "DELIVERY_STATE_RETRY" });
        continue;
      }
      try {
        await this.publisher.publish(event);
        const publishedAt = this.clock().toISOString();
        await this.deliveryStore?.markOutboxPublished(event.eventId, publishedAt);
        this.outbox.markPublished(event.eventId, publishedAt);
        results.push({ eventId: event.eventId, status: "PUBLISHED" });
      } catch {
        results.push({ eventId: event.eventId, status: "RETRY" });
      }
    }
    for (const event of deadLetterEvents) {
      try {
        if (typeof this.publisher.publishDeadLetter !== "function") throw new Error("DEAD_LETTER_PUBLISHER_UNAVAILABLE");
        await this.publisher.publishDeadLetter(event);
        const deadLetteredAt = this.clock().toISOString();
        await this.deliveryStore?.markOutboxDeadLettered(event.eventId, deadLetteredAt);
        this.outbox.markDeadLettered(event.eventId, deadLetteredAt);
        results.push({ eventId: event.eventId, status: "DEAD_LETTERED" });
      } catch {
        results.push({ eventId: event.eventId, status: "DEAD_LETTER_RETRY" });
      }
    }
    return results;
  }
}
