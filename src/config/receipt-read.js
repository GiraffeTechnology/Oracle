import { EvmReceiptReadSource, normalizeReceiptReadBinding } from '../adapters/evm-receipt-read-source.js';

/** Optional configuration from the existing hash-pinned deployment module only. */
export async function assembleReceiptRead({ receiptReadConfiguration, resolver, guardRead, runInScope = (operation) => operation() }) {
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
    expectedRuntimeCode, minConfirmations, guardRead });
  return Object.freeze({ receiptProjectionSource: Object.freeze({ receiptSnapshot: (...args) => runInScope(() => source.receiptSnapshot(...args)) }) });
}
