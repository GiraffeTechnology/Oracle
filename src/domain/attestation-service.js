import { randomUUID, sign, verify } from "node:crypto";
import { canonicalJson, evidenceHash } from "./canonical-json.js";

function signingBytes(envelope) {
  return Buffer.from(canonicalJson(envelope), "utf8");
}

export class AttestationService {
  #issuedNonces = new Set();
  #attestations = new Map();
  #signBytes;
  #verifyBytes;

  constructor({ signerSetId, privateKey, publicKey, revocations, signerPolicy = null, clock = () => new Date() }) {
    if (!signerSetId || !privateKey || !publicKey || !revocations) throw new Error("ATTESTATION_DEPENDENCY_MISSING");
    this.signerSetId = signerSetId;
    this.#signBytes = (bytes) => sign(null, bytes, privateKey);
    this.#verifyBytes = (bytes, signature) => verify(null, bytes, publicKey, signature);
    this.revocations = revocations;
    if (signerPolicy && signerPolicy.record.signerSetId !== signerSetId) throw new Error("SIGNER_POLICY_SET_MISMATCH");
    this.signerPolicy = signerPolicy;
    this.clock = clock;
  }

  activateSignerBackend({ signerSetId: nextSignerSetId, signBytes, verifyBytes, signerPolicy = null }, expectedCurrentSignerSetId) {
    if (typeof nextSignerSetId !== "string" || !nextSignerSetId || typeof expectedCurrentSignerSetId !== "string" || !expectedCurrentSignerSetId || typeof signBytes !== "function" || typeof verifyBytes !== "function") throw new Error("SIGNER_SET_ACTIVATION_INVALID");
    if (this.signerSetId !== expectedCurrentSignerSetId) throw new Error("SIGNER_ROTATION_SOURCE_NOT_ACTIVE");
    if (nextSignerSetId === expectedCurrentSignerSetId) throw new Error("SIGNER_SET_ACTIVATION_INVALID");
    if (!signerPolicy || signerPolicy.record?.signerSetId !== nextSignerSetId) throw new Error("SIGNER_POLICY_REPLACEMENT_REQUIRED");
    signerPolicy.assertActive();
    const challenge = Buffer.from("giraffe-oracle-signer-backend-self-test-v1", "utf8");
    const tamperedChallenge = Buffer.from("giraffe-oracle-signer-backend-self-test-v1-tampered", "utf8");
    let testSignature;
    let valid;
    let tamperedValid;
    try {
      testSignature = signBytes(challenge);
      if (testSignature && typeof testSignature.then === "function") throw new Error("SIGNER_BACKEND_ASYNC_UNSUPPORTED");
      if (!Buffer.isBuffer(testSignature) && !(testSignature instanceof Uint8Array)) throw new Error("SIGNER_BACKEND_RESULT_INVALID");
      valid = verifyBytes(challenge, testSignature);
      tamperedValid = verifyBytes(tamperedChallenge, testSignature);
      if ((valid && typeof valid.then === "function") || (tamperedValid && typeof tamperedValid.then === "function")) throw new Error("SIGNER_BACKEND_ASYNC_UNSUPPORTED");
    } catch (error) {
      if (error?.message === "SIGNER_BACKEND_ASYNC_UNSUPPORTED" || error?.message === "SIGNER_BACKEND_RESULT_INVALID") throw error;
      throw new Error("SIGNER_BACKEND_SELF_TEST_FAILED");
    }
    if (valid !== true || tamperedValid !== false) throw new Error("SIGNER_BACKEND_SELF_TEST_FAILED");
    this.#signBytes = signBytes;
    this.#verifyBytes = verifyBytes;
    this.signerPolicy = signerPolicy;
    this.signerSetId = nextSignerSetId;
    return Object.freeze({ signerSetId: nextSignerSetId, privateMaterialIncluded: false });
  }

  issue({ subject, factType, factValue, sourceAuthority, sourceRecordHash, validForSeconds, nonce, revocationRef = null }) {
    this.signerPolicy?.assertActive();
    const requiredSubject = ["assetId", "chainId", "contract", "tokenId", "purpose"];
    if (!subject || requiredSubject.some((field) => !subject[field]) || !sourceAuthority || !sourceRecordHash || !nonce) {
      throw new Error("ATTESTATION_REQUEST_INVALID");
    }
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
      sourceAuthority,
      sourceRecordHash,
      observedAt: observedAt.toISOString(),
      validFrom: observedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      nonce,
      revocationRef,
      signerSetId: this.signerSetId,
    });
    const signatureBytes = this.#signBytes(signingBytes(envelope));
    if (signatureBytes && typeof signatureBytes.then === "function") throw new Error("SIGNER_BACKEND_ASYNC_UNSUPPORTED");
    if (!Buffer.isBuffer(signatureBytes) && !(signatureBytes instanceof Uint8Array)) throw new Error("SIGNER_BACKEND_RESULT_INVALID");
    const attestation = Object.freeze({
      envelope,
      envelopeHash: evidenceHash(envelope),
      signature: Buffer.from(signatureBytes).toString("base64url"),
    });
    this.#issuedNonces.add(nonce);
    this.#attestations.set(envelope.attestationId, attestation);
    return attestation;
  }

  get(attestationId) {
    return this.#attestations.get(attestationId) ?? null;
  }

  revokeBySubject({ assetId, purpose, reasonHash, revokedAt, authorityId }) {
    if (![assetId, purpose, reasonHash, revokedAt, authorityId].every((value) => typeof value === "string" && value)) {
      throw new Error("ATTESTATION_REVOCATION_SCOPE_INVALID");
    }
    const revoked = [];
    for (const attestation of this.#attestations.values()) {
      if (attestation.envelope.subject.assetId !== assetId || attestation.envelope.subject.purpose !== purpose) continue;
      revoked.push(this.revocations.revoke({ attestationId: attestation.envelope.attestationId, reasonHash, revokedAt, authorityId }));
    }
    return Object.freeze(revoked);
  }

  verify(attestation, { expectedSubject, now = this.clock() } = {}) {
    try { this.signerPolicy?.assertActive(); } catch { return { valid: false, errorCode: "SIGNER_SET_NOT_ACTIVE" }; }
    const { envelope, envelopeHash, signature } = attestation ?? {};
    if (!envelope || !signature || evidenceHash(envelope) !== envelopeHash) return { valid: false, errorCode: "HASH_INVALID" };
    const signatureValid = this.#verifyBytes(signingBytes(envelope), Buffer.from(signature, "base64url"));
    if (signatureValid && typeof signatureValid.then === "function") return { valid: false, errorCode: "SIGNER_BACKEND_ASYNC_UNSUPPORTED" };
    if (signatureValid !== true) {
      return { valid: false, errorCode: "SIGNATURE_INVALID" };
    }
    if (envelope.schemaVersion !== "giraffe-attestation.v1") return { valid: false, errorCode: "SCHEMA_VERSION_UNSUPPORTED" };
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
