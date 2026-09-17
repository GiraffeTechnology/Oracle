/**
 * The ERC8415-Kit v2.0 temporal projection surface, as Oracle consumes it.
 *
 * Oracle owns the ERC-8415 integration boundary and consumes the Kit for
 * reusable projection infrastructure. A consuming application reaches Oracle's
 * application-facing API only, and never this port or the Kit behind it.
 *
 * This port is read-only by construction. There is no admit, no settle, no
 * begin, no cancel: the authorized surface is the temporal projection, and no
 * settlement engine, payment, custody, release or refund workflow is in scope.
 * A source that offered a write path could not satisfy this shape.
 *
 * Every instant and version is a decimal string at the boundary, never a JSON
 * number: uint64 exceeds what a double holds exactly, and a rounded instant
 * resolves to the wrong entry.
 *
 * @typedef {object} ProjectionEntry
 * @property {string} version
 * @property {string} holder
 * @property {string} effectiveAt
 * @property {string} supersededAt zero on the latest entry
 * @property {string} recordCommitment
 * @property {string} previousCommitment
 * @property {string} registryReference a locator, never the record itself
 *
 * @typedef {object} ProjectionSource
 * @property {() => Promise<string>} registerId
 * @property {(tokenId: string) => Promise<string>} entryCount
 * @property {(tokenId: string) => Promise<ProjectionEntry>} currentEntry
 * @property {(tokenId: string, version: string) => Promise<ProjectionEntry>} entryAt
 * @property {(tokenId: string, instant: string) => Promise<ProjectionEntry>} entryAsOf
 * @property {(tokenId: string, instant: string) => Promise<string>} holderAsOf
 * @property {(tokenId: string, instant: string) => Promise<boolean>} isFinalAsOf
 */

/** A projection read that refused, carrying why rather than a substituted answer. */
export class ProjectionSourceError extends Error {
  /** @param {string} errorCode @param {number} status @param {string} [message] */
  constructor(errorCode, status, message) {
    super(message ?? errorCode);
    this.name = "ProjectionSourceError";
    this.errorCode = errorCode;
    this.status = status;
  }
}

/** Instants, versions and token ids cross this boundary as uint64 decimal strings. */
export const UINT64_DECIMAL = /^(0|[1-9][0-9]{0,19})$/;

export function assertUint64(value, errorCode) {
  if (typeof value !== "string" || !UINT64_DECIMAL.test(value) || BigInt(value) > (2n ** 64n - 1n)) {
    throw new ProjectionSourceError(errorCode, 400);
  }
  return value;
}
