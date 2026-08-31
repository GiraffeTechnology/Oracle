import { evidenceHash } from "../domain/canonical-json.js";

export class CommandJournal {
  #commands = new Map();

  execute(idempotencyKey, command, operation) {
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128 || !command || typeof operation !== "function") throw new Error("COMMAND_INVALID");
    const commandHash = evidenceHash(command);
    const prior = this.#commands.get(idempotencyKey);
    if (prior && prior.commandHash !== commandHash) throw new Error("COMMAND_IDEMPOTENCY_CONFLICT");
    if (prior?.pending === true) return prior.promise.then((record) => Object.freeze({ ...record, replayed: true }));
    if (prior) return Object.freeze({ ...prior, replayed: true });
    const result = operation();
    if (result && typeof result.then === "function") {
      const pending = { commandHash, pending: true, promise: null };
      pending.promise = Promise.resolve(result).then((resolved) => {
        const record = Object.freeze({ commandHash, result: resolved, replayed: false });
        this.#commands.set(idempotencyKey, record);
        return record;
      }).catch((error) => {
        if (this.#commands.get(idempotencyKey) === pending) this.#commands.delete(idempotencyKey);
        throw error;
      });
      this.#commands.set(idempotencyKey, pending);
      return pending.promise;
    }
    const record = Object.freeze({ commandHash, result, replayed: false });
    this.#commands.set(idempotencyKey, record);
    return record;
  }
}
