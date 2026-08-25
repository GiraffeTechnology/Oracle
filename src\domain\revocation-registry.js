export class RevocationRegistry {
  #items = new Map();

  revoke({ attestationId, reasonHash, revokedAt, authorityId }) {
    if (this.#items.has(attestationId)) return this.#items.get(attestationId);
    const record = Object.freeze({ attestationId, reasonHash, revokedAt, authorityId });
    this.#items.set(attestationId, record);
    return record;
  }

  isRevoked(attestationId) {
    return this.#items.has(attestationId);
  }

  get(attestationId) {
    return this.#items.get(attestationId) ?? null;
  }
}

