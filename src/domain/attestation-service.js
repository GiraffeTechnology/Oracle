import { createHash, randomUUID, sign, verify } from "node:crypto";
import { canonicalJson, evidenceHash } from "./canonical-json.js";

function signingDigest(envelope) {
  return createHash("sha256").update(canonicalJson(envelope), "utf8").digest();
}

const SHA256_HEX = /^[a-f0-9]{64}$/i;
function boundedString(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

export class AttestationService {
  #issuedNonces = new Set();
  #attestations = new Map();
  #signBytes;
  #verifyBytes;
  #verifyHistoricalBytes;

  constructor({ signerSetId, privateKey = null, publicKey = null, signBytes = null, verifyBytes = null, verifyHistoricalBytes = null, revocations, signerPolicy = null, environment = "test", clock = () => new Date() }) {
    const keyPairMode = privateKey && publicKey && !signBytes && !verifyBytes;
    const callbackMode = !privateKey && !publicKey && typeof signBytes === "function" && typeof verifyBytes === "function";
    if (!boundedString(signerSetId, 64) || !revocations || (!keyPairMode && !callbackMode)) throw new Error("ATTESTATION_DEPENDENCY_MISSING");
    this.signerSetId = signerSetId;
    this.#signBytes = callbackMode ? signBytes : (bytes) => sign(null, bytes, privateKey);
    const initialVerify = callbackMode ? verifyBytes : (bytes, signature) => verify(null, bytes, publicKey, signature);
    this.#verifyBytes = initialVerify;
    this.#verifyHistoricalBytes = typeof verifyHistoricalBytes === "function"
      ? verifyHistoricalBytes
      : (candidateSignerSetId, bytes, signature) => candidateSignerSetId === signerSetId && initialVerify(bytes, signature);
    this.revocations = revocations;
    if (signerPolicy && signerPolicy.record.signerSetId !== signerSetId) throw new Error("SIGNER_POLICY_SET_MISMATCH");
    this.signerPolicy = signerPolicy;
    this.environment = environment;
    this.clock = clock;
  }

  activateSignerBackend({ signerSetId: nextSignerSetId, signBytes, verifyBytes, signerPolicy = null }, expectedCurrentSignerSetId) {
    if (!boundedString(nextSignerSetId, 64) || !boundedString(expectedCurrentSignerSetId, 64) || typeof signBytes !== "function" || typeof verifyBytes !== "function") throw new Error("SIGNER_SET_ACTIVATION_INVALID");
    if (this.signerSetId !== expectedCurrentSignerSetId) throw new Error("SIGNER_ROTATION_SOURCE_NOT_ACTIVE");
    if (nextSignerSetId === expectedCurrentSignerSetId) throw new Error("SIGNER_SET_ACTIVATION_INVALID");
    if (!signerPolicy || signerPolicy.record?.signerSetId !== nextSignerSetId) throw new Error("SIGNER_POLICY_REPLACEMENT_REQUIRED");
    signerPolicy.assertActive();
    const challenge = createHash("sha256").update("giraffe-oracle-signer-backend-self-test-v1", "utf8").digest();
    const tamperedChallenge = createHash("sha256").update("giraffe-oracle-signer-backend-self-test-v1-tampered", "utf8").digest();
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
    const priorHistoricalVerifier = this.#verifyHistoricalBytes;
    this.#signBytes = signBytes;
    this.#verifyBytes = verifyBytes;
    this.#verifyHistoricalBytes = (candidateSignerSetId, bytes, signature) => candidateSignerSetId === nextSignerSetId
      ? verifyBytes(bytes, signature)
      : priorHistoricalVerifier(candidateSignerSetId, bytes, signature);
    this.signerPolicy = signerPolicy;
    this.signerSetId = nextSignerSetId;
    return Object.freeze({ signerSetId: nextSignerSetId, privateMaterialIncluded: false });
  }

  issue({ subject, factType, factValue, sourceAuthority, sourceRecordHash, validForSeconds, nonce, revocationRef = null }) {
    this.signerPolicy?.assertActive();
    const subjectValid = subject
      && boundedString(subject.assetId, 128)
      && boundedString(subject.chainId, 64)
      && boundedString(subject.contract, 128)
      && boundedString(subject.tokenId, 128)
      && boundedString(subject.purpose, 128);
    if (!boundedString(this.signerSetId, 64) || !subjectValid || !boundedString(factType, 64) || factValue === undefined || !boundedString(sourceAuthority, 64) || !SHA256_HEX.test(sourceRecordHash ?? "") || !boundedString(nonce, 128) || (revocationRef !== null && !boundedString(revocationRef, 256))) {
      throw new Error("ATTESTATION_REQUEST_INVALID");
    }
    if (!Number.isInteger(validForSeconds) || validForSeconds < 1 || validForSeconds > 86400) {
      throw new Error("ATTESTATION_TTL_INVALID");
    }
    if (this.signerPolicy) {
      if (typeof this.signerPolicy.authorizeAttestation !== "function") throw new Error("SIGNER_POLICY_AUTHORIZATION_MISSING");
      this.signerPolicy.authorizeAttestation({ environment: this.environment, schemaVersion: "giraffe-attestation.v1", purpose: subject.purpose, subject: Object.freeze({ ...subject }), validForSeconds, factType });
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
    const signatureBytes = this.#signBytes(signingDigest(envelope));
    if (signatureBytes && typeof signatureBytes.then === "function") throw new Error("SIGNER_BACKEND_ASYNC_UNSUPPORTED");
    if (!Buffer.isBuffer(signatureBytes) && !(signatureBytes instanceof Uint8Array)) throw new Error("SIGNER_BACKEND_RESULT_INVALID");
    const encodedSignature = Buffer.from(signatureBytes).toString("base64url");
    if (encodedSignature.length > 1024) throw new Error("SIGNER_BACKEND_RESULT_INVALID");
    const attestation = Object.freeze({
      envelope,
      envelopeHash: evidenceHash(envelope),
      signature: encodedSignature,
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
    const signatureValid = this.#verifyBytes(signingDigest(envelope), Buffer.from(signature, "base64url"));
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

  exportState() { return Object.freeze({ signerSetId: this.signerSetId, attestations: [...this.#attestations.values()], issuedNonces: [...this.#issuedNonces] }); }
  importState(state, { allowHistoricalSignerSet = false } = {}) {
    if (this.#attestations.size || this.#issuedNonces.size || (!allowHistoricalSignerSet && state?.signerSetId !== this.signerSetId) || !boundedString(state?.signerSetId, 64) || !Array.isArray(state?.attestations) || !Array.isArray(state?.issuedNonces)) throw new Error("ATTESTATION_STATE_IMPORT_REJECTED");
    const nonceSet = new Set(state.issuedNonces);
    const seenIds = new Set();
    for (const attestation of state.attestations) {
      const { envelope, envelopeHash, signature } = attestation ?? {};
      if (!envelope || typeof envelope.attestationId !== "string" || !envelope.attestationId || seenIds.has(envelope.attestationId) || !boundedString(envelope.signerSetId, 64) || evidenceHash(envelope) !== envelopeHash || !nonceSet.has(envelope.nonce) || typeof signature !== "string" || !/^[A-Za-z0-9_-]+$/.test(signature) || Buffer.from(signature, "base64url").length === 0 || this.#verifyHistoricalBytes(envelope.signerSetId, signingDigest(envelope), Buffer.from(signature, "base64url")) !== true) throw new Error("ATTESTATION_STATE_IMPORT_INVALID");
      seenIds.add(envelope.attestationId);
      this.#attestations.set(envelope.attestationId, Object.freeze({ envelope: Object.freeze({ ...envelope, subject: Object.freeze({ ...envelope.subject }) }), envelopeHash, signature }));
    }
    if (seenIds.size !== nonceSet.size) throw new Error("ATTESTATION_STATE_IMPORT_INVALID");
    this.#issuedNonces = nonceSet;
  }
}

