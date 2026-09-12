export class ReviewQueue {
  #items = new Map();

  enqueue({ reviewId, subjectId, findingCodes, evidenceHash, createdAt }) {
    if (!reviewId || !subjectId || !evidenceHash || !createdAt || !Array.isArray(findingCodes) || findingCodes.length === 0) throw new Error("REVIEW_ITEM_INVALID");
    const existing = this.#items.get(reviewId);
    const candidate = Object.freeze({ reviewId, subjectId, findingCodes: Object.freeze([...new Set(findingCodes)].sort()), evidenceHash, createdAt, status: "REVIEW_REQUIRED" });
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(candidate)) throw new Error("REVIEW_IDEMPOTENCY_CONFLICT");
      return existing;
    }
    this.#items.set(reviewId, candidate);
    return candidate;
  }

  get(reviewId) { return this.#items.get(reviewId) ?? null; }
  list() { return [...this.#items.values()]; }
  exportState() { return Object.freeze({ items: this.list() }); }
  importState(state) {
    if (this.#items.size || !Array.isArray(state?.items)) throw new Error("REVIEW_STATE_IMPORT_REJECTED");
    for (const item of state.items) this.#items.set(item.reviewId, Object.freeze({ ...item, findingCodes: Object.freeze([...item.findingCodes]) }));
  }
}
