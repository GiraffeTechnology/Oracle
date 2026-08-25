const VALID_CAPABILITIES = new Set(["asset.read", "certificate.read", "warehouse.read"]);
export class ResilientSourceAdapter {
  #failures = 0;
  #openedAt = null;
  #requests = [];
  constructor({ sourceId, capability, versions, transport, timeoutMs = 1000, rateLimit = 10, failureThreshold = 2, resetMs = 1000, clock = () => Date.now() }) {
    if (!sourceId || !VALID_CAPABILITIES.has(capability) || !Array.isArray(versions) || versions.length === 0 || !transport?.fetch) throw new Error("RESILIENT_SOURCE_CONFIG_INVALID");
    Object.assign(this, { sourceId, capability, versions: Object.freeze([...versions]), transport, timeoutMs, rateLimit, failureThreshold, resetMs, clock });
  }
  async fetch({ version, recordRef }) {
    const now = this.clock();
    if (!this.versions.includes(version)) throw new Error("SOURCE_VERSION_NOT_NEGOTIATED");
    if (this.#openedAt !== null && now - this.#openedAt < this.resetMs) throw new Error("SOURCE_CIRCUIT_OPEN");
    if (this.#openedAt !== null) { this.#openedAt = null; this.#failures = 0; }
    this.#requests = this.#requests.filter((time) => now - time < 1000);
    if (this.#requests.length >= this.rateLimit) throw new Error("SOURCE_RATE_LIMITED");
    this.#requests.push(now);
    let timer;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("SOURCE_TIMEOUT")), this.timeoutMs); });
      const result = await Promise.race([this.transport.fetch({ sourceId: this.sourceId, capability: this.capability, version, recordRef }), timeout]);
      this.#failures = 0;
      return result;
    } catch (error) {
      this.#failures += 1;
      if (this.#failures >= this.failureThreshold) this.#openedAt = now;
      throw error;
    } finally { clearTimeout(timer); }
  }
}
