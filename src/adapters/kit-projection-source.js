import { ADDRESS, BYTES32, ProjectionSourceError, assertUint64, assertUint256 } from '../ports/projection-source.js';

const malformed = () => new ProjectionSourceError('PROJECTION_SOURCE_MALFORMED', 502);
const MAX_RESPONSE_BYTES = 64 * 1024;
const REFUSALS = new Set(['INSTANT_NOT_COVERED', 'UNKNOWN_TOKEN', 'UNKNOWN_VERSION', 'EMPTY_PROJECTION']);

function uint64(value) {
  try { return assertUint64(value, 'PROJECTION_SOURCE_MALFORMED'); } catch { throw malformed(); }
}
function entry(value) {
  if (!value || typeof value !== 'object' || !ADDRESS.test(value.holder) ||
      !BYTES32.test(value.recordCommitment) || !BYTES32.test(value.previousCommitment) ||
      !BYTES32.test(value.registryReference)) throw malformed();
  // Return only the verified wire fields; do not expose source-internal metadata.
  const result = {
    version: uint64(value.version), holder: value.holder,
    effectiveAt: uint64(value.effectiveAt), supersededAt: uint64(value.supersededAt),
    recordCommitment: value.recordCommitment, previousCommitment: value.previousCommitment,
    registryReference: value.registryReference,
  };
  if (result.version === '0' || (result.supersededAt !== '0' && BigInt(result.supersededAt) <= BigInt(result.effectiveAt))) throw malformed();
  return result;
}

/** Oracle-owned HTTP adapter; only the pinned Kit read routes are reachable. */
export class KitProjectionSource {
  #baseUrl;
  #fetch;
  #timeoutMs;

  constructor({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
    const url = new URL(baseUrl);
    if (url.username || url.password) throw new Error('KIT_BASE_URL_CREDENTIALS_REFUSED');
    if (url.search || url.hash) throw new Error('KIT_BASE_URL_INVALID');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('KIT_BASE_URL_INSECURE');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('KIT_TIMEOUT_INVALID');
    this.#baseUrl = url.href.replace(/\/+$/, '');
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async registerId(tokenId) {
    const id = assertUint256(tokenId, 'TOKEN_ID_INVALID');
    const body = await this.#get(`/projection/${id}`, id);
    if (!BYTES32.test(body.registerId)) throw malformed();
    return body.registerId;
  }

  async entryCount(tokenId) {
    const id = assertUint256(tokenId, 'TOKEN_ID_INVALID');
    const body = await this.#get(`/projection/${id}`, id);
    const count = body.entryCount;
    // The pinned Kit serializes its in-memory array count as a safe number.
    // Decimal strings also preserve compatibility with durable uint64 stores.
    if (typeof count === 'number' && (!Number.isSafeInteger(count) || count < 0)) throw malformed();
    return uint64(typeof count === 'number' ? String(count) : count);
  }

  async currentEntry(tokenId) {
    const id = assertUint256(tokenId, 'TOKEN_ID_INVALID');
    const count = await this.entryCount(id);
    if (count === '0') throw new ProjectionSourceError('EMPTY_PROJECTION', 404);
    // Kit has no current route. Count is the consecutive latest version, not
    // the last item of its first (at most 100-entry) history page. Reads are not
    // an atomic snapshot: an admission may happen after this count was read.
    return this.entryAt(id, count);
  }

  async entryAt(tokenId, version) {
    const id = assertUint256(tokenId, 'TOKEN_ID_INVALID');
    const v = assertUint64(version, 'VERSION_INVALID');
    const value = entry((await this.#get(`/projection/${id}/entry/version/${v}`, id)).entry);
    if (value.version !== v) throw malformed();
    return value;
  }

  async entryAsOf(tokenId, instant) {
    const id = assertUint256(tokenId, 'TOKEN_ID_INVALID');
    const t = assertUint64(instant, 'INSTANT_INVALID');
    const value = entry((await this.#get(`/projection/${id}/entry/as-of/${t}`, id, t)).entry);
    if (BigInt(value.effectiveAt) > BigInt(t) || (value.supersededAt !== '0' && BigInt(t) >= BigInt(value.supersededAt))) throw malformed();
    return value;
  }

  async holderAsOf(tokenId, instant) {
    const id = assertUint256(tokenId, 'TOKEN_ID_INVALID');
    const t = assertUint64(instant, 'INSTANT_INVALID');
    const body = await this.#get(`/projection/${id}/holder/as-of/${t}`, id, t);
    if (!ADDRESS.test(body.holder)) throw malformed();
    return body.holder;
  }

  async isFinalAsOf(tokenId, instant) {
    const id = assertUint256(tokenId, 'TOKEN_ID_INVALID');
    const t = assertUint64(instant, 'INSTANT_INVALID');
    const body = await this.#get(`/projection/${id}/finality/as-of/${t}`, id, t);
    if (typeof body.final !== 'boolean') throw malformed();
    return body.final;
  }

  async #get(routePath, tokenId, instant) {
    const controller = new AbortController();
    let reader;
    let timer;
    const unavailable = () => new ProjectionSourceError('PROJECTION_SOURCE_UNAVAILABLE', 503);
    const operation = async () => {
      let response;
      try {
        response = await this.#fetch(`${this.#baseUrl}${routePath}`, {
          method: 'GET', redirect: 'error', signal: controller.signal,
          headers: { accept: 'application/json' },
        });
      } catch { throw unavailable(); }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type') ?? '')) throw malformed();
      const length = response.headers.get('content-length');
      if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw malformed();
      if (!response.body?.getReader) throw malformed();
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw malformed();
          chunks.push(value);
        }
      } catch (error) {
        if (error instanceof ProjectionSourceError) throw error;
        throw unavailable();
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { throw malformed(); }
      if (response.status < 200 || response.status >= 300) {
        const code = REFUSALS.has(body?.error) ? body.error : 'PROJECTION_SOURCE_REFUSED';
        throw new ProjectionSourceError(code, REFUSALS.has(code) ? 404 : 502);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.tokenId !== tokenId ||
          (instant !== undefined && body.instant !== instant)) throw malformed();
      return body;
    };
    // Bound the whole operation, including bodies and test transports that do
    // not implement fetch's abort contract. Never wait for cancellation itself.
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, this.#timeoutMs);
    });
    try { return await Promise.race([operation(), deadline]); }
    finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }
  }
}
