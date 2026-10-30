import { ProjectionSourceError } from '../ports/projection-source.js';
import { EvmReceiptReadSource, normalizeReceiptReadBinding } from '../adapters/evm-receipt-read-source.js';

/** Optional configuration from the existing hash-pinned deployment module only. */
export async function assembleReceiptRead({ receiptReadConfiguration, resolver, guardRead, runInScope = (operation) => operation(), timeoutMs = 10000 }) {
  if (receiptReadConfiguration == null) return Object.freeze({ receiptProjectionSource: null });
  const profile = receiptReadConfiguration;
  const keys = 'expectedRuntimeCode,minConfirmations,profileId,rpcRef,target';
  if (typeof profile !== 'object' || Object.keys(profile).sort().join(',') !== keys || profile.profileId !== 'oracle-receipt-read.v1' || !/^deployment:\/\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+$/.test(profile.rpcRef ?? '') || typeof resolver?.resolve !== 'function') throw new Error('RECEIPT_READ_CONFIGURATION_INVALID');
  const binding = normalizeReceiptReadBinding(profile.target);
  // Pin the deployment values before asynchronous capability resolution. A
  // mutable export must not replace the reviewed code/depth while it is awaited.
  const expectedRuntimeCode = profile.expectedRuntimeCode;
  const minConfirmations = profile.minConfirmations;
  const source = new EvmReceiptReadSource({ rpc: await resolver.resolve(profile.rpcRef, 'receipt-rpc'), binding,
    expectedRuntimeCode, minConfirmations, guardRead, timeoutMs });
  const receiptSnapshot = async (...args) => {
    let timer;
    try {
      // Respond on time while the original scope continues tracking unfinished
      // transport work for drain. A response deadline does not cancel that work.
      return await Promise.race([
        runInScope(() => source.receiptSnapshot(...args)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new ProjectionSourceError('RECEIPT_SOURCE_UNAVAILABLE', 503)), timeoutMs);
        }),
      ]);
    } finally { clearTimeout(timer); }
  };
  return Object.freeze({ receiptProjectionSource: Object.freeze({ receiptSnapshot }) });
}
