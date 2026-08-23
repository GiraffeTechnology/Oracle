/**
 * ORACLE-002: the query result vocabulary is closed. A caller must never see a status
 * outside this list, and an unknown or unavailable input resolves to `NOT_VERIFIED`
 * rather than an optimistic answer (fail closed, ORACLE-003).
 */
export const ORACLE_STATUSES = [
  'VALID',
  'INVALID',
  'TRANSFER_PENDING',
  'FROZEN',
  'REVOKED',
  'EXPIRED',
  'REVIEW_REQUIRED',
  'NOT_VERIFIED',
] as const;

export type OracleStatus = (typeof ORACLE_STATUSES)[number];

/** The status returned whenever an authoritative source is missing, stale or in conflict. */
export const FAIL_CLOSED_STATUS: OracleStatus = 'NOT_VERIFIED';

/**
 * Statuses that block a downstream protocol from treating the asset as transferable.
 * `VALID` is the only status that clears a transfer gate; everything else blocks it.
 */
export const TRANSFER_BLOCKING_STATUSES: readonly OracleStatus[] = ORACLE_STATUSES.filter(
  (status) => status !== 'VALID',
);

const STATUS_DESCRIPTIONS: Record<OracleStatus, string> = {
  VALID: 'Authoritative sources agree and the attestation is signed, unexpired and not revoked.',
  INVALID: 'An authoritative source contradicts the claimed fact.',
  TRANSFER_PENDING: 'A T+0 snapshot exists and registry change plus certificate reissue are open.',
  FROZEN: 'Registry, warehouse, judicial or dispute hold blocks transfer and redemption.',
  REVOKED: 'A previously issued attestation was withdrawn and must not be consumed.',
  EXPIRED: 'The attestation validity window has elapsed and it must be re-requested.',
  REVIEW_REQUIRED: 'Manual authority review is required before any further state transition.',
  NOT_VERIFIED: 'No authoritative confirmation is available; the oracle fails closed.',
};

export function isOracleStatus(value: unknown): value is OracleStatus {
  return typeof value === 'string' && (ORACLE_STATUSES as readonly string[]).includes(value);
}

export function describeOracleStatus(status: OracleStatus): string {
  return STATUS_DESCRIPTIONS[status];
}

export function blocksTransfer(status: OracleStatus): boolean {
  return status !== 'VALID';
}

export type OracleStatusDescriptor = {
  status: OracleStatus;
  description: string;
  blocksTransfer: boolean;
};

export function listOracleStatuses(): OracleStatusDescriptor[] {
  return ORACLE_STATUSES.map((status) => ({
    status,
    description: describeOracleStatus(status),
    blocksTransfer: blocksTransfer(status),
  }));
}
