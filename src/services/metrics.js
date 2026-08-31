const SAFE_METRIC = /^[a-z][a-z0-9_]{2,63}$/;

export class Metrics {
  #counters = new Map();
  #gauges = new Map();

  increment(name, amount = 1) {
    if (!SAFE_METRIC.test(name) || !Number.isFinite(amount) || amount < 0) throw new Error("METRIC_INVALID");
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + amount);
  }

  gauge(name, value) {
    if (!SAFE_METRIC.test(name) || !Number.isFinite(value)) throw new Error("METRIC_INVALID");
    this.#gauges.set(name, value);
  }

  snapshot() {
    return Object.freeze({ counters: Object.fromEntries([...this.#counters].sort()), gauges: Object.fromEntries([...this.#gauges].sort()) });
  }
}

