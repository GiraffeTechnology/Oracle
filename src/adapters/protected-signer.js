export class ProtectedSignerAdapter {
  constructor({ client, policy }) {
    if (!client || typeof client.signDigest !== "function" || !policy) throw new Error("PROTECTED_SIGNER_INVALID");
    this.client = client;
    this.policy = Object.freeze({ ...policy });
  }

  async signAttestation({ envelopeHash, schemaVersion, purpose, ttlSeconds }) {
    if (!this.policy.schemaVersions.includes(schemaVersion)) throw new Error("SIGNER_SCHEMA_REJECTED");
    if (!this.policy.purposes.includes(purpose)) throw new Error("SIGNER_PURPOSE_REJECTED");
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > this.policy.maxTtlSeconds) {
      throw new Error("SIGNER_TTL_REJECTED");
    }
    const result = await this.client.signDigest({ envelopeHash, policyId: this.policy.policyId });
    if (!result?.signature || !result?.signerSetId) throw new Error("SIGNER_RESPONSE_INVALID");
    return Object.freeze({ signature: result.signature, signerSetId: result.signerSetId });
  }

  async publicSignerSet() {
    const result = await this.client.getPublicSignerSet({ policyId: this.policy.policyId });
    if (!result?.signerSetId || !result?.publicKeys) throw new Error("SIGNER_SET_INVALID");
    return result;
  }
}

