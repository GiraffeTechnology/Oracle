export const OracleStatus = Object.freeze({
  VALID: "VALID",
  INVALID: "INVALID",
  TRANSFER_PENDING: "TRANSFER_PENDING",
  FROZEN: "FROZEN",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  NOT_VERIFIED: "NOT_VERIFIED",
});

export const ORACLE_STATUSES = Object.freeze(Object.values(OracleStatus));

export function isOracleStatus(value) {
  return ORACLE_STATUSES.includes(value);
}

