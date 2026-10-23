import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createKitProjectionTransport, ProjectionTransportError, projectionIdentity } from './kit-projection-transport.js';

export const KIT_COMMIT = 'f2da4f543dfdb033c32f018a25b5cfb3540fd3df';
const SDK_SHA256 = 'c33085c183c0b58a81b4846c184076688e6c577f1cfb88c5a83ea2cd8f931133';
const ADDRESS = /^0x[0-9a-f]{40}$/;
const BYTES32 = /^0x[0-9a-f]{64}$/;
const UINT64_MAX = (1n << 64n) - 1n;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);

export class ProjectionReadError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function uint(value, bits) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78)
    throw new ProjectionReadError('PROJECTION_QUERY_INVALID', 400);
  const number = BigInt(value);
  if (number >= (1n << BigInt(bits))) throw new ProjectionReadError('PROJECTION_QUERY_INVALID', 400);
  return number;
}

function publicGap(gap, tokenId) {
  if (gap === null) return null;
  if (!gap || gap.tokenId !== tokenId || gap.status !== 'OPEN' ||
      !matches(ADDRESS, gap.initiator) || !matches(ADDRESS, gap.expectedHolder) ||
      !matches(BYTES32, gap.settlementId) || !matches(BYTES32, gap.snapshotHash) ||
      typeof gap.openedAt !== 'bigint' || gap.openedAt < 0n || gap.openedAt > UINT64_MAX ||
      typeof gap.deadline !== 'bigint' || gap.deadline < 0n || gap.deadline > UINT64_MAX)
    throw new ProjectionReadError('PROJECTION_RESPONSE_INVALID', 502);
  // Explicit projection only: never pass through extra upstream fields.
  return {
    settlementId: gap.settlementId, tokenId: gap.tokenId.toString(),
    initiator: gap.initiator, expectedHolder: gap.expectedHolder,
    snapshotHash: gap.snapshotHash, openedAt: gap.openedAt.toString(),
    deadline: gap.deadline.toString(), status: gap.status,
  };
}

/** Oracle's application boundary. It never derives finality or reads ownerOf. */
export function createProjectionReader({ client, profileId, registerId, verificationProfile }) {
  const identity = projectionIdentity(registerId, verificationProfile);
  if (!client || typeof client.resolve !== 'function' ||
      typeof profileId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(profileId))
    throw new Error('PROJECTION_CONFIG_INVALID');
  return Object.freeze({
    async resolve(requestedProfile, token, instant) {
      if (requestedProfile !== profileId) throw new ProjectionReadError('PROJECTION_PROFILE_NOT_FOUND', 404);
      const tokenId = uint(token, 256);
      const at = uint(instant, 64);
      let result;
      try {
        // One Kit snapshot, not three racing reads. No retries or response cache.
        result = await client.resolve(tokenId, at);
      } catch (error) {
        if (error instanceof ProjectionTransportError)
          throw new ProjectionReadError('PROJECTION_RESPONSE_INVALID', 502);
        if (error?.status === 404 && error?.code === 'INSTANT_NOT_COVERED')
          throw new ProjectionReadError('PROJECTION_INSTANT_NOT_COVERED', 404);
        throw new ProjectionReadError('PROJECTION_SOURCE_UNAVAILABLE', 503);
      }
      if (!result || !matches(ADDRESS, result.holder) || typeof result.final !== 'boolean')
        throw new ProjectionReadError('PROJECTION_RESPONSE_INVALID', 502);
      return {
        profileId, tokenId: tokenId.toString(), instant: at.toString(),
        ...identity, identityBinding: 'CONFIGURED_KIT_ENDPOINT',
        holder: result.holder, final: result.final,
        openGap: publicGap(result.openGap, tokenId),
        // Kit resolve returns the currently open gap, not reconstructed gap history.
        openGapScope: 'CURRENT_SNAPSHOT',
        usage: 'POINT_IN_TIME_READ_ONLY',
      };
    },
  });
}

/** Load the upstream SDK in place. No copy, install, transpilation or Kit write. */
export async function loadKitProjectionReader({ kitRoot, baseUrl, apiKey, profileId, registerId, verificationProfile }) {
  const identity = projectionIdentity(registerId, verificationProfile);
  if (typeof kitRoot !== 'string' || !isAbsolute(kitRoot) || typeof baseUrl !== 'string')
    throw new Error('PROJECTION_CONFIG_INVALID');
  const url = new URL(baseUrl);
  if (url.search || url.hash || url.username || url.password)
    throw new Error('PROJECTION_CONFIG_INVALID');
  const sdkPath = join(kitRoot, 'sdk', 'js', 'client.ts');
  // Windows checkout line endings do not change the audited SDK source.
  const source = (await readFile(sdkPath, 'utf8')).replaceAll('\r\n', '\n');
  if (createHash('sha256').update(source).digest('hex') !== SDK_SHA256)
    throw new Error('PROJECTION_SDK_PIN_MISMATCH');
  const { ProjectionClient } = await import(pathToFileURL(sdkPath).href);
  const client = new ProjectionClient({ baseUrl, apiKey, timeoutMs: 10000,
    fetch: createKitProjectionTransport(globalThis.fetch, identity) });
  return createProjectionReader({ client, profileId, ...identity });
}
