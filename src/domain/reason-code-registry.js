const DEFAULT_CODES = Object.freeze({
  SOURCE_CONFLICT: "REVIEW_REQUIRED",
  SOURCE_OFFLINE: "FROZEN",
  CERTIFICATE_REVOKED: "REVOKED",
  ATTESTATION_EXPIRED: "EXPIRED",
  SETTLEMENT_STARTED: "TRANSFER_PENDING",
});

export class ReasonCodeRegistry {
  constructor(codes = DEFAULT_CODES) { this.codes = Object.freeze({ ...codes }); }
  require(code, expectedStatus) {
    if (!this.codes[code]) throw new Error("REASON_CODE_UNKNOWN");
    if (expectedStatus && this.codes[code] !== expectedStatus) throw new Error("REASON_STATUS_MISMATCH");
    return Object.freeze({ code, status: this.codes[code] });
  }
  list() { return Object.freeze({ ...this.codes }); }
}

