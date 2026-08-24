import { randomUUID, sign, verify } from "node:crypto";
import { canonicalJson, evidenceHash } from "./canonical-json.js";

function signingBytes(envelope) {
  return Buffer.from(canonicalJson(envelope), "utf8");
}

export class AttestationService {
  #issuedNonces = new Set();
  #attestations = new Map();

  constructor({ signerSetId, privateKey, publicKey, revocations, signerPolicy = null, clock = () => new Date() }) {
    if (!signerSetId || !privateKey || !publicKey || !revocations) throw new Error("ATTESTATION_DEPENDENCY_MISSING");
    this.signerSetId = signerSetId;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.revocations = revocations;
    if (signerPolicy && signerPolicy.record.signerSetId !== signerSetId) throw new Error("SIGNER_POLICY_SET_MISMATCH");
    this.signerPolicy = signerPolicy;
    this.clock = clock;
  }

  issue({ subject, factType, factValue, sourceRecordHash, validForSeconds, nonce }) {
    this.signerPolicy?.assertActive();
    if (!subject?.assetId || !subject.purpose || !sourceRecordHash || !nonce) throw new Error("ATTESTATION_REQUEST_INVALID");
    if (!Number.isInteger(validForSeconds) || validForSeconds < 1 || validForSeconds > 86400) {
      throw new Error("ATTESTATION_TTL_INVALID");
    }
    if (this.#issuedNonces.has(nonce)) throw new Error("ATTESTATION_NONCE_REUSED");
    const observedAt = this.clock();
    const expiresAt = new Date(observedAt.getTime() + validForSeconds * 1000);
    const envelope = Object.freeze({
      schemaVersion: "giraffe-attestation.v1",
      attestationId: randomUUID(),
      subject: Object.freeze({ ...subject }),
      factType,
      factValue,
      sourceRecordHash,
      observedAt: observedAt.toISOString(),
      validFrom: observedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      nonce,
      signerSetId: this.signerSetId,
    });
    const attestation = Object.freeze({
      envelope,
      envelopeHash: evidenceHash(envelope),
      signature: sign(null, signingBytes(envelope), this.privateKey).toString("base64url"),
    });
    this.#issuedNonces.add(nonce);
    this.#attestations.set(envelope.attestationId, attestation);
    return attestation;
  }

  get(attestationId) {
    return this.#attestations.get(attestationId) ?? null;
  }

  verify(attestation, { expectedSubject, now = this.clock() } = {}) {
    try { this.signerPolicy?.assertActive(); } catch { return { valid: false, errorCode: "SIGNER_SET_NOT_ACTIVE" }; }
    const { envelope, envelopeHash, signature } = attestation ?? {};
    if (!envelope || !signature || evidenceHash(envelope) !== envelopeHash) return { valid: false, errorCode: "HASH_INVALID" };
    if (!verify(null, signingBytes(envelope), this.publicKey, Buffer.from(signature, "base64url"))) {
      return { valid: false, errorCode: "SIGNATURE_INVALID" };
    }
    if (this.revocations.isRevoked(envelope.attestationId)) return { valid: false, errorCode: "REVOKED" };
    if (now < new Date(envelope.validFrom) || now >= new Date(envelope.expiresAt)) {
      return { valid: false, errorCode: "NOT_CURRENT" };
    }
    if (expectedSubject) {
      for (const [key, value] of Object.entries(expectedSubject)) {
        if (envelope.subject[key] !== value) return { valid: false, errorCode: "SUBJECT_MISMATCH" };
      }
    }
    return { valid: true, errorCode: null };
  }
}

