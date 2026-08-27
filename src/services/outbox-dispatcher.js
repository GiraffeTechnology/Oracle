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
        await this.publisher.publish(event);
      } catch {
        try {
          const attempts = event.attempts + 1;
          await this.deliveryStore?.recordOutboxAttempt(event.eventId, attempts);
          this.outbox.recordAttempt(event.eventId);
          results.push({ eventId: event.eventId, status: "RETRY" });
        } catch {
          results.push({ eventId: event.eventId, status: "DELIVERY_STATE_RETRY" });
        }
        continue;
      }
      try {
        const publishedAt = this.clock().toISOString();
        await this.deliveryStore?.markOutboxPublished(event.eventId, publishedAt);
        this.outbox.markPublished(event.eventId, publishedAt);
        results.push({ eventId: event.eventId, status: "PUBLISHED" });
      } catch {
        results.push({ eventId: event.eventId, status: "DELIVERY_STATE_RETRY" });
      }
    }
    for (const event of deadLetterEvents) {
      try {
        if (typeof this.publisher.publishDeadLetter !== "function") throw new Error("DEAD_LETTER_PUBLISHER_UNAVAILABLE");
        await this.publisher.publishDeadLetter(event);
      } catch {
        try {
          const attempts = (event.deadLetterAttempts ?? 0) + 1;
          await this.deliveryStore?.recordOutboxDeadLetterAttempt(event.eventId, attempts);
          this.outbox.recordDeadLetterAttempt(event.eventId);
          results.push({ eventId: event.eventId, status: "DEAD_LETTER_RETRY" });
        } catch {
          results.push({ eventId: event.eventId, status: "DEAD_LETTER_STATE_RETRY" });
        }
        continue;
      }
      try {
        const deadLetteredAt = this.clock().toISOString();
        await this.deliveryStore?.markOutboxDeadLettered(event.eventId, deadLetteredAt);
        this.outbox.markDeadLettered(event.eventId, deadLetteredAt);
        results.push({ eventId: event.eventId, status: "DEAD_LETTERED" });
      } catch {
        results.push({ eventId: event.eventId, status: "DEAD_LETTER_STATE_RETRY" });
      }
    }
    return results;
  }
}
