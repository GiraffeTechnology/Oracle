import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { SyntheticAuthorityAdapter } from "../src/adapters/synthetic-authority.js";
import { AttestationService } from "../src/domain/attestation-service.js";
import { AuditJournal } from "../src/domain/audit-journal.js";
import { canonicalJson, evidenceHash } from "../src/domain/canonical-json.js";
import { OracleStatus } from "../src/domain/oracle-status.js";
import { RecordStore } from "../src/domain/record-store.js";
import { RevocationRegistry } from "../src/domain/revocation-registry.js";
import { createDefaultSchemaRegistry } from "../src/domain/schema-registry.js";
import { SourceRegistry } from "../src/domain/source-registry.js";
import { StateEngine } from "../src/domain/state-engine.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";
import { requireValidOracleAttestation } from "../src/sdk/verifier.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const NOW = new Date("2026-08-24T00:00:00.000Z");

test("canonical JSON and evidence hashes ignore object insertion order", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.equal(evidenceHash({ b: 2, a: 1 }), evidenceHash({ a: 1, b: 2 }));
  assert.notEqual(evidenceHash({ a: 1 }), evidenceHash({ a: 2 }));
});

test("schema registry rejects extra fields and strips sensitive public fields", () => {
  const schemas = createDefaultSchemaRegistry();
  const payload = schemas.validate("asset-record.v1", {
    assetId: "asset-001",
    assetFingerprintHash: HASH_A,
    registryRef: "registry-001",
    ownerCommitment: HASH_B,
  });
  assert.equal(schemas.publicProjection("asset-record.v1", payload).ownerCommitment, undefined);
  assert.throws(
    () => schemas.validate("asset-record.v1", { ...payload, marketPrice: 12 }),
    /PAYLOAD_FIELD_NOT_ALLOWED:marketPrice/,
  );
});

test("synthetic adapter enforces source and schema allowlists", () => {
  const sources = new SourceRegistry([{ id: "synthetic-registry", displayName: "Synthetic Registry", kind: "REGISTRY", keySetId: "synthetic-keys", schemaVersions: ["asset-record.v1"], active: true }]);
  const adapter = new SyntheticAuthorityAdapter({ sourceId: "synthetic-registry", schemaRegistry: createDefaultSchemaRegistry(), sourceRegistry: sources });
  const result = adapter.ingest({ schemaVersion: "asset-record.v1", payload: { assetId: "asset-001", assetFingerprintHash: HASH_A, registryRef: "registry-001" } });
  assert.equal(result.sourceRecordHash.length, 64);
  assert.throws(() => adapter.ingest({ schemaVersion: "asset-record.v2", payload: {} }), /SOURCE_SCHEMA_NOT_ALLOWED/);
});

test("record store maintains append-only certificate versions", () => {
  const store = new RecordStore();
  store.putAsset({ assetId: "asset-001", assetFingerprintHash: HASH_A });
  store.appendCertificate({ assetId: "asset-001", certificateHash: HASH_B, certificateVersion: 1 });
  store.appendCertificate({ assetId: "asset-001", certificateHash: HASH_C, previousCertificateHash: HASH_B, certificateVersion: 2 });
  assert.equal(store.certificateHistory("asset-001").length, 2);
  assert.throws(
    () => store.appendCertificate({ assetId: "asset-001", certificateHash: HASH_A, previousCertificateHash: HASH_B, certificateVersion: 3 }),
    /CERTIFICATE_PREVIOUS_HASH_INVALID/,
  );
});

test("state engine rejects illegal and non-increasing transitions", () => {
  const states = new StateEngine();
  assert.throws(
    () => states.transition({ subjectId: "asset-001", to: OracleStatus.TRANSFER_PENDING, reasonHash: HASH_A, evidenceVersion: 1, occurredAt: NOW.toISOString() }),
    /STATE_TRANSITION_REJECTED/,
  );
  states.transition({ subjectId: "asset-001", to: OracleStatus.VALID, reasonHash: HASH_A, evidenceVersion: 1, occurredAt: NOW.toISOString() });
  assert.throws(
    () => states.transition({ subjectId: "asset-001", to: OracleStatus.FROZEN, reasonHash: HASH_B, evidenceVersion: 1, occurredAt: NOW.toISOString() }),
    /EVIDENCE_VERSION_NOT_INCREASING/,
  );
});

test("audit journal forms a verifiable append-only hash chain", () => {
  const journal = new AuditJournal();
  journal.append({ type: "asset.verified", subjectId: "asset-001", payloadHash: HASH_A, actorId: "synthetic-registry", occurredAt: NOW.toISOString() });
  journal.append({ type: "asset.frozen", subjectId: "asset-001", payloadHash: HASH_B, actorId: "synthetic-warehouse", occurredAt: NOW.toISOString() });
  assert.equal(journal.verify(), true);
  assert.equal(journal.list()[1].previousHash, journal.list()[0].eventHash);
});

test("attestation is subject-bound, expires and can be revoked", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const revocations = new RevocationRegistry();
  const service = new AttestationService({ signerSetId: "synthetic-signers", privateKey, publicKey, revocations, clock: () => NOW });
  const attestation = service.issue({
    subject: { assetId: "asset-001", chainId: "test-chain", contract: "synthetic-contract", tokenId: "1", purpose: "transfer-eligibility" },
    factType: "TRANSFER_STATUS",
    factValue: OracleStatus.VALID,
    sourceRecordHash: HASH_A,
    validForSeconds: 60,
    nonce: "nonce-001",
  });
  assert.equal(requireValidOracleAttestation(service, attestation, { assetId: "asset-001", purpose: "transfer-eligibility" }, NOW).attestationId, attestation.envelope.attestationId);
  assert.deepEqual(service.verify(attestation, { expectedSubject: { assetId: "asset-002" }, now: NOW }), { valid: false, errorCode: "SUBJECT_MISMATCH" });
  assert.deepEqual(service.verify(attestation, { now: new Date(NOW.getTime() + 60000) }), { valid: false, errorCode: "NOT_CURRENT" });
  revocations.revoke({ attestationId: attestation.envelope.attestationId, reasonHash: HASH_B, revokedAt: NOW.toISOString(), authorityId: "synthetic-oracle" });
  assert.deepEqual(service.verify(attestation, { now: NOW }), { valid: false, errorCode: "REVOKED" });
});

test("settlement requires complete evidence and upgrades the certificate", () => {
  const clock = () => NOW;
  const runtime = createSyntheticRuntime({ clock });
  runtime.recordStore.putAsset({ assetId: "asset-001", assetFingerprintHash: HASH_A, registryRef: "registry-001" });
  runtime.recordStore.appendCertificate({ assetId: "asset-001", certificateHash: HASH_B, certificateVersion: 1 });
  runtime.recordStore.putWarehouse({ assetId: "asset-001", warehouseReceiptHash: HASH_A, warehouseStatus: "HELD" });
  runtime.stateEngine.transition({ subjectId: "asset-001", to: OracleStatus.VALID, reasonHash: HASH_A, evidenceVersion: 1, occurredAt: NOW.toISOString() });
  runtime.settlements.begin({ settlementId: "settlement-001", assetId: "asset-001", snapshotHash: HASH_C, deadlineAt: new Date(NOW.getTime() + 86400000).toISOString(), actorId: "synthetic-market", evidenceVersion: 2 });
  assert.equal(runtime.stateEngine.current("asset-001"), OracleStatus.TRANSFER_PENDING);
  assert.throws(
    () => runtime.settlements.finalize({ settlementId: "settlement-001", certificate: {}, registryChangeRef: null, warehouseConfirmed: false, actorId: "synthetic-registry", evidenceVersion: 3 }),
    /SETTLEMENT_CONFIRMATION_INCOMPLETE/,
  );
  runtime.settlements.finalize({ settlementId: "settlement-001", certificate: { assetId: "asset-001", certificateHash: HASH_C, previousCertificateHash: HASH_B, certificateVersion: 2 }, registryChangeRef: "change-001", warehouseConfirmed: true, actorId: "synthetic-registry", evidenceVersion: 3 });
  assert.equal(runtime.stateEngine.current("asset-001"), OracleStatus.VALID);
  assert.equal(runtime.recordStore.currentCertificate("asset-001").certificateVersion, 2);
  assert.equal(runtime.auditJournal.verify(), true);
});
