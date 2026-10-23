import {
  ADDRESS,
  BYTES32,
  ProjectionSourceError,
  assertUint64,
  assertUint256,
} from '../ports/projection-source.js';
import { RECEIPT_BINDING_SCHEMA } from './source-receipt-ingress.js';

const ZERO_HASH = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const BINDING_FIELDS = [
  'schemaId',
  'mintPolicyHash',
  'segmentDigest',
  'requestHash',
  'receiptDocumentHash',
];
const malformed = () => {
  throw new ProjectionSourceError('RECEIPT_SOURCE_MALFORMED', 502);
};
const isHash = (value) => typeof value === 'string' && BYTES32.test(value);
const isAddress = (value) =>
  typeof value === 'string' && ADDRESS.test(value) && value.toLowerCase() !== ZERO_ADDRESS;

/** Expose only a complete, same-block source snapshot. Never synthesize a binding from old reads. */
export async function readReceiptProjection({ source, binding, tokenId, version }) {
  if (typeof source?.receiptSnapshot !== 'function' || !binding)
    throw new ProjectionSourceError('RECEIPT_SOURCE_NOT_CONFIGURED', 503);
  let configured;
  try {
    assertUint256(binding.chainId, 'RECEIPT_SOURCE_BINDING_INVALID');
    if (
      binding.chainId === '0' ||
      !isAddress(binding.contract) ||
      !isAddress(binding.sourceAuthority) ||
      !isHash(binding.registerId) ||
      binding.registerId.toLowerCase() === ZERO_HASH
    )
      throw new Error();
    configured = {
      chainId: binding.chainId,
      contract: binding.contract.toLowerCase(),
      registerId: binding.registerId.toLowerCase(),
      sourceAuthority: binding.sourceAuthority.toLowerCase(),
    };
  } catch {
    throw new ProjectionSourceError('RECEIPT_SOURCE_BINDING_INVALID', 503);
  }
  const snapshot = await source.receiptSnapshot(tokenId, version ?? 'latest');
  if (
    !snapshot ||
    snapshot.tokenId !== tokenId ||
    snapshot.chainId !== configured.chainId ||
    typeof snapshot.contract !== 'string' ||
    snapshot.contract.toLowerCase() !== configured.contract ||
    typeof snapshot.registerId !== 'string' ||
    snapshot.registerId.toLowerCase() !== configured.registerId ||
    typeof snapshot.sourceAuthority !== 'string' ||
    snapshot.sourceAuthority.toLowerCase() !== configured.sourceAuthority
  )
    throw new ProjectionSourceError('RECEIPT_SOURCE_IDENTITY_MISMATCH', 502);
  try {
    if (!isHash(snapshot.block?.hash) || snapshot.block.hash.toLowerCase() === ZERO_HASH)
      malformed();
    const block = {
      number: assertUint256(snapshot.block.number, 'RECEIPT_SOURCE_MALFORMED'),
      hash: snapshot.block.hash.toLowerCase(),
    };
    const value = snapshot.entry;
    if (
      !value ||
      !isAddress(value.holder) ||
      !isHash(value.recordCommitment) ||
      value.recordCommitment.toLowerCase() === ZERO_HASH ||
      !isHash(value.previousCommitment) ||
      !isHash(value.registryReference)
    )
      malformed();
    const entry = {
      recordCommitment: value.recordCommitment.toLowerCase(),
      previousCommitment: value.previousCommitment.toLowerCase(),
      registryReference: value.registryReference.toLowerCase(),
      holder: value.holder.toLowerCase(),
      version: assertUint64(value.version, 'RECEIPT_SOURCE_MALFORMED'),
      effectiveAt: assertUint64(value.effectiveAt, 'RECEIPT_SOURCE_MALFORMED'),
      supersededAt: assertUint64(value.supersededAt, 'RECEIPT_SOURCE_MALFORMED'),
    };
    if (
      entry.version === '0' ||
      (version !== undefined && version !== entry.version) ||
      (entry.supersededAt !== '0' && BigInt(entry.supersededAt) <= BigInt(entry.effectiveAt))
    )
      malformed();
    if (!isHash(snapshot.mintPolicyHash) || snapshot.mintPolicyHash.toLowerCase() === ZERO_HASH)
      throw new ProjectionSourceError('RECEIPT_POLICY_UNAVAILABLE', 503);
    const mintPolicyHash = snapshot.mintPolicyHash.toLowerCase();
    if (
      !snapshot.receiptBinding ||
      BINDING_FIELDS.some((field) => !isHash(snapshot.receiptBinding[field]))
    )
      malformed();
    const receiptBinding = Object.fromEntries(
      BINDING_FIELDS.map((field) => [field, snapshot.receiptBinding[field].toLowerCase()]),
    );
    const absent = BINDING_FIELDS.every((field) => receiptBinding[field] === ZERO_HASH);
    if (
      !absent &&
      (receiptBinding.schemaId !== RECEIPT_BINDING_SCHEMA ||
        receiptBinding.mintPolicyHash !== mintPolicyHash ||
        BINDING_FIELDS.some((field) => receiptBinding[field] === ZERO_HASH))
    )
      malformed();
    return {
      tokenId,
      source: configured,
      block,
      entry,
      mintPolicyHash,
      receiptBinding,
      receiptAvailable: !absent,
    };
  } catch (error) {
    if (error instanceof ProjectionSourceError && error.errorCode === 'RECEIPT_POLICY_UNAVAILABLE')
      throw error;
    malformed();
  }
}
