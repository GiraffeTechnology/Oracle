// Oracle transport checks only. Projection semantics remain in Kit.
export class ProjectionTransportError extends Error {
  constructor() {
    super('PROJECTION_RESPONSE_INVALID');
    this.code = 'PROJECTION_RESPONSE_INVALID';
  }
}

export function projectionIdentity(registerId, verificationProfile) {
  if (![registerId, verificationProfile].every((value) =>
    typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value)))
    throw new Error('PROJECTION_CONFIG_INVALID');
  return Object.freeze({ registerId, verificationProfile });
}

export function projectWireGap(gap, tokenId) {
  if (gap === null) return null;
  const hex = (value, length) => typeof value === 'string' &&
    new RegExp(`^0x[0-9a-f]{${length}}$`).test(value);
  const instant = (value) => typeof value === 'string' && value.length <= 20 &&
    /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) < (1n << 64n);
  if (!gap || typeof gap !== 'object' || Array.isArray(gap) ||
      gap.tokenId !== tokenId || gap.status !== 'OPEN' ||
      !hex(gap.settlementId, 64) || !hex(gap.snapshotHash, 64) ||
      !hex(gap.initiator, 40) || !hex(gap.expectedHolder, 40) ||
      !instant(gap.openedAt) || !instant(gap.deadline))
    throw new ProjectionTransportError();
  return { settlementId: gap.settlementId, tokenId, initiator: gap.initiator,
    expectedHolder: gap.expectedHolder, snapshotHash: gap.snapshotHash,
    openedAt: gap.openedAt, deadline: gap.deadline, status: gap.status };
}

export async function readBoundedJson(response, maxBytes = 32768) {
  const reader = response.body?.getReader();
  if (!reader) throw new ProjectionTransportError();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ProjectionTransportError();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new ProjectionTransportError();
    return body;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
    throw new ProjectionTransportError();
  } finally {
    reader.releaseLock();
  }
}

export function createKitProjectionTransport(fetchImpl = globalThis.fetch, expectedIdentity) {
  const identity = projectionIdentity(expectedIdentity?.registerId, expectedIdentity?.verificationProfile);
  return async (url, init = {}) => {
    const parsed = new URL(url);
    const match = /\/projection\/(0|[1-9][0-9]*)\/resolve\/as-of\/(0|[1-9][0-9]*)$/.exec(parsed.pathname);
    if (!match || parsed.search || parsed.hash || (init.method && init.method !== 'GET'))
      throw new ProjectionTransportError();
    // Resolve omits register identity. Check Kit's existing overview per read,
    // under the same timeout and credentials. This is endpoint configuration
    // binding, not chain-code verification or a legal-title assertion.
    const overviewUrl = new URL(parsed);
    overviewUrl.pathname = parsed.pathname.replace(/\/resolve\/as-of\/[0-9]+$/, '');
    const overviewResponse = await fetchImpl(overviewUrl.href, {
      ...init, method: 'GET', redirect: 'error', cache: 'no-store',
    });
    const overview = await readBoundedJson(overviewResponse);
    if (overviewResponse.status >= 400)
      return { status: overviewResponse.status, json: async () => overview };
    if (overviewResponse.status !== 200 || overview.tokenId !== match[1] ||
        overview.registerId !== identity.registerId ||
        overview.verificationProfile !== identity.verificationProfile)
      throw new ProjectionTransportError();
    const response = await fetchImpl(url, {
      ...init, method: 'GET', redirect: 'error', cache: 'no-store',
    });
    const body = await readBoundedJson(response);
    if (response.status < 400 && (response.status !== 200 ||
        body.tokenId !== match[1] || body.instant !== match[2]))
      throw new ProjectionTransportError();
    if (response.status === 200) body.openGap = projectWireGap(body.openGap, match[1]);
    // The upstream error code is classified by the SDK; no raw body is published.
    return { status: response.status, json: async () => body };
  };
}
