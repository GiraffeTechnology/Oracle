export class OutboxDispatcher {
  constructor({ outbox, publisher, clock = () => new Date(), maxAttempts = 5 }) {
    Object.assign(this, { outbox, publisher, clock, maxAttempts });
  }

  async drain(limit = 100) {
    const results = [];
    for (const event of this.outbox.pending(limit)) {
      if (event.attempts >= this.maxAttempts) {
        try {
          if (typeof this.publisher.publishDeadLetter !== "function") throw new Error("DEAD_LETTER_PUBLISHER_UNAVAILABLE");
          await this.publisher.publishDeadLetter(event);
          this.outbox.markDeadLettered(event.eventId, this.clock().toISOString());
          results.push({ eventId: event.eventId, status: "DEAD_LETTERED" });
        } catch {
          results.push({ eventId: event.eventId, status: "DEAD_LETTER_RETRY" });
        }
        continue;
      }
      this.outbox.recordAttempt(event.eventId);
      try {
        await this.publisher.publish(event);
        this.outbox.markPublished(event.eventId, this.clock().toISOString());
        results.push({ eventId: event.eventId, status: "PUBLISHED" });
      } catch {
        results.push({ eventId: event.eventId, status: "RETRY" });
      }
    }
    return results;
  }
}

