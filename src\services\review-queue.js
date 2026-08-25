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
}
