export class KeySetRegistry {
  #sets = new Map();

  register({ keySetId, publicKey, validFrom, expiresAt = null, status = "ACTIVE" }) {
    if (this.#sets.has(keySetId)) throw new Error("KEY_SET_ALREADY_EXISTS");
    if (!keySetId || !publicKey || !validFrom) throw new Error("KEY_SET_INVALID");
    if (!new Set(["ACTIVE", "RETIRED", "REVOKED"]).has(status)) throw new Error("KEY_SET_STATUS_INVALID");
    const record = Object.freeze({ keySetId, publicKey, validFrom, expiresAt, status });
    this.#sets.set(keySetId, record);
    return record;
  }

  requireValid(keySetId, at) {
    const record = this.#sets.get(keySetId);
    if (!record) throw new Error("KEY_SET_NOT_REGISTERED");
    if (record.status !== "ACTIVE") throw new Error("KEY_SET_NOT_ACTIVE");
    const time = new Date(at);
    if (Number.isNaN(time.getTime()) || time < new Date(record.validFrom)) throw new Error("KEY_SET_NOT_YET_VALID");
    if (record.expiresAt && time >= new Date(record.expiresAt)) throw new Error("KEY_SET_EXPIRED");
    return record;
  }

  replace(keySetId, status) {
    const current = this.#sets.get(keySetId);
    if (!current) throw new Error("KEY_SET_NOT_REGISTERED");
    if (!new Set(["RETIRED", "REVOKED"]).has(status)) throw new Error("KEY_SET_REPLACEMENT_INVALID");
    const next = Object.freeze({ ...current, status });
    this.#sets.set(keySetId, next);
    return next;
  }

  publicStatus(keySetId) {
    const record = this.#sets.get(keySetId);
    return record ? { keySetId: record.keySetId, validFrom: record.validFrom, expiresAt: record.expiresAt, status: record.status } : null;
  }
}

