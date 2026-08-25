export class FixedWindowRateLimiter {
  #windows = new Map();
  constructor({ limit, windowMs, clock = () => Date.now() }) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) throw new Error("RATE_LIMIT_POLICY_INVALID");
    Object.assign(this, { limit, windowMs, clock });
  }
  consume(subject) {
    if (!subject) throw new Error("RATE_LIMIT_SUBJECT_REQUIRED");
    const now = this.clock();
    const current = this.#windows.get(subject);
    const window = !current || now >= current.resetAt ? { count: 0, resetAt: now + this.windowMs } : current;
    if (window.count >= this.limit) throw new Error("RATE_LIMIT_EXCEEDED");
    const next = Object.freeze({ count: window.count + 1, remaining: this.limit - window.count - 1, resetAt: window.resetAt });
    this.#windows.set(subject, next);
    return next;
  }
}
