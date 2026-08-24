export class SignerSetPolicy {
  constructor({ signerSetId, threshold, signers, status = "ACTIVE" }) {
    if (!signerSetId || !Number.isInteger(threshold) || !Array.isArray(signers) || new Set(signers).size !== signers.length || threshold < 1 || threshold > signers.length) throw new Error("SIGNER_POLICY_INVALID");
    if (!new Set(["ACTIVE", "RETIRED", "REVOKED"]).has(status)) throw new Error("SIGNER_POLICY_STATUS_INVALID");
    this.record = Object.freeze({ signerSetId, threshold, signers: Object.freeze([...signers].sort()), status });
  }
  authorize(approvals) {
    this.assertActive();
    const accepted = new Set((approvals ?? []).filter((signer) => this.record.signers.includes(signer)));
    if (accepted.size < this.record.threshold) throw new Error("SIGNER_THRESHOLD_NOT_MET");
    return true;
  }
  assertActive() {
    if (this.record.status !== "ACTIVE") throw new Error("SIGNER_SET_NOT_ACTIVE");
    return true;
  }
}

