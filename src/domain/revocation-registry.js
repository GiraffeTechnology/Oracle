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

  exportState() { return Object.freeze({ items: [...this.#items.values()] }); }
  importState(state) {
    if (this.#items.size || !Array.isArray(state?.items)) throw new Error("REVOCATION_STATE_IMPORT_REJECTED");
    for (const item of state.items) this.revoke(item);
  }
}
