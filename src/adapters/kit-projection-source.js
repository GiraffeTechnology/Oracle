import { ProjectionSourceError, assertUint64 } from "../ports/projection-source.js";

/**
 * Consumes the pinned ERC8415-Kit v2.0 temporal projection surface over its
 * read API.
 *
 * Only the projection routes are called. The Kit's admission route is a write
 * path and is deliberately unreachable from here: Oracle's application-facing
 * boundary exposes reads, and nothing a consumer sends can reach an
 * admission.
 *
 * A refusal from the Kit is surfaced as a refusal. There is no fallback to a
 * neighbouring instant, no cached answer, and no substitution of the ERC-721
 * owner for a confirmed holder.
 *
 * @implements {import("../ports/projection-source.js").ProjectionSource}
 */
export class KitProjectionSource {
  #baseUrl;
  #fetch;
  #timeoutMs;

  constructor({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
    const url = new URL(baseUrl);
    if (url.username || url.password) throw new Error("KIT_BASE_URL_CREDENTIALS_REFUSED");
    const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new Error("KIT_BASE_URL_INSECURE");
    }
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async registerId() {
    const body = await this.#get(`/projection/1`);
    return body.registerId;
  }

  async entryCount(tokenId) {
    const body = await this.#get(`/projection/${assertUint64(tokenId, "TOKEN_ID_INVALID")}/entries?limit=1`);
    return String(body.entryCount);
  }

  async currentEntry(tokenId) {
    const id = assertUint64(tokenId, "TOKEN_ID_INVALID");
    const body = await this.#get(`/projection/${id}/entries?limit=100`);
    const entries = body.entries ?? [];
    const latest = entries.at(-1);
    if (!latest) throw new ProjectionSourceError("PROJECTION_EMPTY", 404);
    return latest;
  }

  async entryAt(tokenId, version) {
    const id = assertUint64(tokenId, "TOKEN_ID_INVALID");
    const v = assertUint64(version, "VERSION_INVALID");
    return (await this.#get(`/projection/${id}/entry/version/${v}`)).entry;
  }

  async entryAsOf(tokenId, instant) {
    const id = assertUint64(tokenId, "TOKEN_ID_INVALID");
    const t = assertUint64(instant, "INSTANT_INVALID");
    return (await this.#get(`/projection/${id}/entry/as-of/${t}`)).entry;
  }

  async holderAsOf(tokenId, instant) {
    const id = assertUint64(tokenId, "TOKEN_ID_INVALID");
    const t = assertUint64(instant, "INSTANT_INVALID");
    return (await this.#get(`/projection/${id}/holder/as-of/${t}`)).holder;
  }

  async isFinalAsOf(tokenId, instant) {
    const id = assertUint64(tokenId, "TOKEN_ID_INVALID");
    const t = assertUint64(instant, "INSTANT_INVALID");
    // Never throws for an instant the projection does not cover: the standard
    // requires false there, and the Kit answers it rather than refusing.
    return Boolean((await this.#get(`/projection/${id}/finality/as-of/${t}`)).final);
  }

  async #get(routePath) {
    let response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${routePath}`, {
        signal: AbortSignal.timeout(this.#timeoutMs),
        headers: { accept: "application/json" },
      });
    } catch {
      // A read that never returns is a read that never fails. Surface it.
      throw new ProjectionSourceError("PROJECTION_SOURCE_UNAVAILABLE", 503);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new ProjectionSourceError("PROJECTION_SOURCE_MALFORMED", 502);
    }

    if (response.status >= 400) {
      const code = typeof body?.error === "string" ? body.error : "PROJECTION_SOURCE_REFUSED";
      // "Not covered" is not an internal failure; it is the answer.
      const status = code === "INSTANT_NOT_COVERED" || code === "UNKNOWN_TOKEN" || code === "UNKNOWN_VERSION" ? 404 : 502;
      throw new ProjectionSourceError(code, status);
    }
    return body;
  }
}
