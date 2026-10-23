import { readBoundedJson, projectWireGap, projectionIdentity } from '../adapters/kit-projection-transport.js';

export class OracleProjectionError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function decimal(value, bits) {
  const text = typeof value === 'bigint' ? value.toString() : value;
  if (typeof text !== 'string' || text.length > 78 || !/^(0|[1-9][0-9]*)$/.test(text) ||
      BigInt(text) >= (1n << BigInt(bits)))
    throw new OracleProjectionError('PROJECTION_QUERY_INVALID', 400);
  return text;
}

/** Application SDK: calls Oracle only, never Kit or a chain RPC. */
export function createOracleProjectionClient({ baseUrl, profileId, registerId, verificationProfile, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  const identity = projectionIdentity(registerId, verificationProfile);
  const base = new URL(baseUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) ||
      typeof profileId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(profileId) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
    throw new OracleProjectionError('PROJECTION_CONFIG_INVALID', 400);
  const prefix = base.href.replace(/\/+$/, '');
  return Object.freeze({
    async resolve(tokenId, instant) {
      const token = decimal(tokenId, 256);
      const at = decimal(instant, 64);
      let response;
      let body;
      try {
        response = await fetchImpl(`${prefix}/v1/rwa/projections/${profileId}/tokens/${token}/as-of/${at}`, {
          method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
        });
        body = await readBoundedJson(response);
      } catch {
        throw new OracleProjectionError('ORACLE_PROJECTION_UNAVAILABLE');
      }
      if (response.status !== 200) {
        const allowed = new Set(['PROJECTION_QUERY_INVALID', 'PROJECTION_PROFILE_NOT_FOUND',
          'PROJECTION_INSTANT_NOT_COVERED', 'PROJECTION_NOT_CONFIGURED',
          'PROJECTION_SOURCE_UNAVAILABLE', 'PROJECTION_RESPONSE_INVALID', 'RATE_LIMIT_EXCEEDED']);
        throw new OracleProjectionError(allowed.has(body.errorCode) ? body.errorCode :
          'ORACLE_PROJECTION_UNAVAILABLE', response.status);
      }
      if (body.profileId !== profileId || body.tokenId !== token || body.instant !== at ||
          body.registerId !== identity.registerId || body.verificationProfile !== identity.verificationProfile ||
          body.identityBinding !== 'CONFIGURED_KIT_ENDPOINT' ||
          typeof body.holder !== 'string' || !/^0x[0-9a-f]{40}$/.test(body.holder) ||
          typeof body.final !== 'boolean' || body.openGapScope !== 'CURRENT_SNAPSHOT' ||
          body.usage !== 'POINT_IN_TIME_READ_ONLY' || body.openGap === undefined)
        throw new OracleProjectionError('PROJECTION_RESPONSE_INVALID', 502);
      let openGap;
      try { openGap = projectWireGap(body.openGap, token); }
      catch { throw new OracleProjectionError('PROJECTION_RESPONSE_INVALID', 502); }
      // No aggregate eligibility/finality decision and no ownerOf fallback.
      return { profileId, tokenId: token, instant: at, holder: body.holder,
        ...identity, identityBinding: body.identityBinding,
        final: body.final, openGap,
        openGapScope: body.openGapScope, usage: body.usage };
    },
  });
}
