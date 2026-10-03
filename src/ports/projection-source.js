/**
 * Oracle's read-only port for the ERC8415-Kit temporal projection surface.
 * Applications consume Oracle only. This port exposes no admission, settlement,
 * payment, custody, release or refund operation. Holder, finality and ERC-721
 * position remain separate facts. Decimal strings preserve integer precision.
 *
 * @typedef {object} ProjectionEntry
 * @property {string} version uint64
 * @property {string} holder
 * @property {string} effectiveAt uint64
 * @property {string} supersededAt uint64; zero on the latest entry
 * @property {string} recordCommitment
 * @property {string} previousCommitment
 * @property {string} registryReference a locator, never the record itself
 *
 * @typedef {object} ProjectionSource
 * @property {(tokenId: string) => Promise<string>} registerId
 * @property {(tokenId: string) => Promise<string>} entryCount
 * @property {(tokenId: string) => Promise<ProjectionEntry>} currentEntry
 * @property {(tokenId: string, version: string) => Promise<ProjectionEntry>} entryAt
 * @property {(tokenId: string, instant: string) => Promise<ProjectionEntry>} entryAsOf
 * @property {(tokenId: string, instant: string) => Promise<string>} holderAsOf
 * @property {(tokenId: string, instant: string) => Promise<boolean>} isFinalAsOf
 */
export class ProjectionSourceError extends Error {
  constructor(errorCode, status, message) {
    super(message ?? errorCode);
    this.name = 'ProjectionSourceError';
    this.errorCode = errorCode;
    this.status = status;
  }
}

export const UINT64_DECIMAL = /^(0|[1-9][0-9]{0,19})$/;
export const UINT256_DECIMAL = /^(0|[1-9][0-9]{0,77})$/;
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export function assertUint64(value, errorCode) {
  return assertInteger(value, UINT64_DECIMAL, 64n, errorCode);
}

export function assertUint256(value, errorCode) {
  return assertInteger(value, UINT256_DECIMAL, 256n, errorCode);
}

function assertInteger(value, pattern, bits, errorCode) {
  if (typeof value !== 'string' || !pattern.test(value) || BigInt(value) >= 2n ** bits) {
    throw new ProjectionSourceError(errorCode, 400);
  }
  return value;
}
