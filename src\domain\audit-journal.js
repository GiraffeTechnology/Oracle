import { evidenceHash } from "./canonical-json.js";

const GENESIS_HASH = "0".repeat(64);

export class AuditJournal {
  #events = [];

  append({ type, subjectId, payloadHash, actorId, occurredAt }) {
    if (![type, subjectId, payloadHash, actorId, occurredAt].every((v) => typeof v === "string" && v)) {
      throw new Error("AUDIT_EVENT_INVALID");
    }
    const sequence = this.#events.length + 1;
    const previousHash = this.#events.at(-1)?.eventHash ?? GENESIS_HASH;
    const body = { sequence, type, subjectId, payloadHash, actorId, occurredAt, previousHash };
    const event = Object.freeze({ ...body, eventHash: evidenceHash(body) });
    this.#events.push(event);
    return event;
  }

  list() {
    return [...this.#events];
  }

  verify() {
    let previousHash = GENESIS_HASH;
    for (const event of this.#events) {
      const { eventHash, ...body } = event;
      if (body.previousHash !== previousHash || evidenceHash(body) !== eventHash) return false;
      previousHash = eventHash;
    }
    return true;
  }
}

