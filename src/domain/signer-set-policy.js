export class SignerSetPolicy {
  constructor({ signerSetId, threshold, signers, status = "ACTIVE", environment = "test", schemaVersions = ["giraffe-attestation.v1"], purposes = null, maxTtlSeconds = 86400 }) {
    if (!signerSetId || !Number.isInteger(threshold) || !Array.isArray(signers) || new Set(signers).size !== signers.length || threshold < 1 || threshold > signers.length) throw new Error("SIGNER_POLICY_INVALID");
    if (!new Set(["ACTIVE", "RETIRED", "REVOKED"]).has(status)) throw new Error("SIGNER_POLICY_STATUS_INVALID");
    if (!["test", "production"].includes(environment) || !Array.isArray(schemaVersions) || !schemaVersions.length || !Number.isInteger(maxTtlSeconds) || maxTtlSeconds < 1 || maxTtlSeconds > 86400 || (purposes !== null && (!Array.isArray(purposes) || !purposes.length))) throw new Error("SIGNER_POLICY_CONSTRAINT_INVALID");
    this.record = Object.freeze({ signerSetId, threshold, signers: Object.freeze([...signers].sort()), status, environment, schemaVersions: Object.freeze([...new Set(schemaVersions)].sort()), purposes: purposes === null ? null : Object.freeze([...new Set(purposes)].sort()), maxTtlSeconds });
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
  authorizeAttestation({ environment, schemaVersion, purpose, subject, validForSeconds }) {
    this.assertActive();
    if (environment !== this.record.environment) throw new Error("SIGNER_POLICY_ENVIRONMENT_REJECTED");
    if (!this.record.schemaVersions.includes(schemaVersion)) throw new Error("SIGNER_POLICY_SCHEMA_REJECTED");
    if (this.record.purposes && !this.record.purposes.includes(purpose)) throw new Error("SIGNER_POLICY_PURPOSE_REJECTED");
    if (!Number.isInteger(validForSeconds) || validForSeconds < 1 || validForSeconds > this.record.maxTtlSeconds) throw new Error("SIGNER_POLICY_TTL_REJECTED");
    if (!subject || ["assetId", "chainId", "contract", "tokenId", "purpose"].some((field) => typeof subject[field] !== "string" || !subject[field])) throw new Error("SIGNER_POLICY_SUBJECT_REJECTED");
    return true;
  }
}
