import { ADDRESS, BYTES32, ProjectionSourceError, assertUint64, assertUint256 } from '../ports/projection-source.js';
import { readReceiptProjection } from './receipt-projection-response.js';

export const APPLICATION_PROJECTION_PREFIX = '/v1/oracle/projection';
const ROUTE = new RegExp(`^${APPLICATION_PROJECTION_PREFIX}/([^/]+)(?:/(entry/current|entry/version/[^/]+|entry/as-of/[^/]+|holder/as-of/[^/]+|finality/as-of/[^/]+|position|receipt/current|receipt/version/[^/]+))?$`);
const refusal = (status, errorCode) => ({ status, body: { ok: false, errorCode } });

/** Read-only application boundary. Holder, finality and position never substitute for each other. */
export function createApplicationProjectionApi({ projectionSource, projectionBinding, receiptProjectionSource, receiptProjectionBinding, positionSource } = {}) {
  // Snapshot server configuration rather than retaining a mutable caller object.
  const binding = projectionBinding ? Object.freeze({ ...projectionBinding }) : null;
  const receiptBinding = receiptProjectionBinding ? Object.freeze({ ...receiptProjectionBinding }) : null;
  async function handle(method, pathname) {
    if (pathname !== APPLICATION_PROJECTION_PREFIX && !pathname.startsWith(`${APPLICATION_PROJECTION_PREFIX}/`)) return null;
    if (method !== 'GET') return refusal(405, 'PROJECTION_READ_ONLY');
    const match = ROUTE.exec(pathname);
    if (!match) return null;
    try {
      const tokenId = assertUint256(match[1], 'TOKEN_ID_INVALID');
      const tail = match[2];
      if (tail?.startsWith('receipt/')) {
        const version = tail.startsWith('receipt/version/') ? assertUint64(tail.slice('receipt/version/'.length), 'VERSION_INVALID') : undefined;
        if (version === '0') return refusal(400, 'VERSION_INVALID');
        return { status: 200, body: await readReceiptProjection({ source: receiptProjectionSource, binding: receiptBinding, tokenId, version }) };
      }
      const version = tail?.startsWith('entry/version/') ? assertUint64(tail.slice('entry/version/'.length), 'VERSION_INVALID') : undefined;
      const instant = tail?.includes('/as-of/') ? assertUint64(tail.split('/as-of/')[1], 'INSTANT_INVALID') : undefined;
      if (!projectionSource || !binding) return refusal(503, 'PROJECTION_SOURCE_NOT_CONFIGURED');
      try {
        assertUint256(binding.chainId, 'PROJECTION_BINDING_INVALID');
        if (binding.chainId === '0' || !ADDRESS.test(binding.contract) || !BYTES32.test(binding.registerId)) throw new Error();
      } catch { return refusal(503, 'PROJECTION_BINDING_INVALID'); }
      const registerId = await projectionSource.registerId(tokenId);
      if (typeof registerId !== 'string' || !BYTES32.test(registerId)) return refusal(502, 'PROJECTION_SOURCE_MALFORMED');
      if (registerId.toLowerCase() !== binding.registerId.toLowerCase()) return refusal(502, 'PROJECTION_SOURCE_IDENTITY_MISMATCH');
      const source = { chainId: binding.chainId, contract: binding.contract.toLowerCase(), registerId: registerId.toLowerCase() };
      const success = (fields) => ({ status: 200, body: { tokenId, source, ...fields } });
      if (tail === undefined) return success({ registerId: source.registerId, entryCount: await projectionSource.entryCount(tokenId) });
      if (tail === 'entry/current') return success({ entry: await projectionSource.currentEntry(tokenId) });
      if (version !== undefined) return success({ entry: await projectionSource.entryAt(tokenId, version) });
      if (tail.startsWith('entry/as-of/')) return success({ instant, entry: await projectionSource.entryAsOf(tokenId, instant) });
      if (tail.startsWith('holder/as-of/')) return success({ instant, holder: await projectionSource.holderAsOf(tokenId, instant) });
      if (tail.startsWith('finality/as-of/')) {
        const final = await projectionSource.isFinalAsOf(tokenId, instant);
        if (typeof final !== 'boolean') return refusal(502, 'PROJECTION_SOURCE_MALFORMED');
        return success({ instant, final });
      }
      if (tail === 'position') {
        let owner = null;
        if (positionSource?.ownerOf) {
          try { owner = await positionSource.ownerOf(tokenId); } catch { return refusal(503, 'POSITION_SOURCE_UNAVAILABLE'); }
          if (typeof owner !== 'string' || !ADDRESS.test(owner)) return refusal(502, 'POSITION_SOURCE_MALFORMED');
        }
        return success({ tradeablePosition: owner, positionSource: 'erc-721', note: owner === null ? 'not read' : 'the tradeable position is not the confirmed holder' });
      }
      return null;
    } catch (error) {
      if (error instanceof ProjectionSourceError) return refusal(error.status, error.errorCode);
      // A provider failure must not escape to the process shutdown coordinator.
      return refusal(503, 'PROJECTION_SOURCE_UNAVAILABLE');
    }
  }
  return { handle, prefix: APPLICATION_PROJECTION_PREFIX };
}

