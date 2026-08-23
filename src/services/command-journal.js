import { evidenceHash } from "../domain/canonical-json.js";

export class CommandJournal {
  #commands = new Map();

  execute(idempotencyKey, command, operation) {
    if (!idempotencyKey || !command || typeof operation !== "function") throw new Error("COMMAND_INVALID");
    const commandHash = evidenceHash(command);
    const prior = this.#commands.get(idempotencyKey);
    if (prior && prior.commandHash !== commandHash) throw new Error("COMMAND_IDEMPOTENCY_CONFLICT");
    if (prior) return Object.freeze({ ...prior, replayed: true });
    const result = operation();
    const record = Object.freeze({ commandHash, result, replayed: false });
    this.#commands.set(idempotencyKey, record);
    return record;
  }
}

