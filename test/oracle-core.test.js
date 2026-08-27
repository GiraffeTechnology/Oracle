import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
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

function completeAssetPayload(assetId = "asset-001") {
  return {
    assetId,
    wenbaoRegistryRef: "registry-001",
    assetFingerprintHash: HASH_A,
    classificationCode: "synthetic-artwork",
    transferEligibility: "VALID",
    warehouseId: "synthetic-warehouse",
    warehouseReceiptHash: HASH_B,
    currentCertificateHash: HASH_C,
    currentCertificateVersion: 1,
    currentOwnerCommitment: HASH_B,
    encumbranceStatus: "CLEAR",
    oracleStatus: "VALID",
    updatedAt: NOW.toISOString(),
  };
}

test("canonical JSON and evidence hashes ignore object insertion order", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.equal(evidenceHash({ b: 2, a: 1 }), evidenceHash({ a: 1, b: 2 }));
  assert.notEqual(evidenceHash({ a: 1 }), evidenceHash({ a: 2 }));
});

test("schema registry rejects extra fields and strips sensitive public fields", () => {
  const schemas = createDefaultSchemaRegistry();
  const payload = schemas.validate("asset-record.v1", completeAssetPayload());
  assert.equal(schemas.publicProjection("asset-record.v1", payload).currentOwnerCommitment, undefined);
  assert.equal(schemas.publicProjection("asset-record.v1", payload).warehouseId, undefined);
  assert.throws(
    () => schemas.validate("asset-record.v1", { ...payload, marketPrice: 12 }),
    /PAYLOAD_FIELD_NOT_ALLOWED:marketPrice/,
  );
});

test("synthetic adapter enforces source and schema allowlists", () => {
  const sources = new SourceRegistry([{ id: "synthetic-registry", displayName: "Synthetic Registry", kind: "REGISTRY", keySetId: "synthetic-keys", schemaVersions: ["asset-record.v1"], active: true }]);
  const adapter = new SyntheticAuthorityAdapter({ sourceId: "synthetic-registry", schemaRegistry: createDefaultSchemaRegistry(), sourceRegistry: sources });
  const result = adapter.ingest({ schemaVersion: "asset-record.v1", payload: completeAssetPayload() });
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
    sourceAuthority: "synthetic-registry",
    sourceRecordHash: HASH_A,
    validForSeconds: 60,
    nonce: "nonce-001",
  });
  assert.equal(requireValidOracleAttestation(service, attestation, { assetId: "asset-001", chainId: "test-chain", contract: "synthetic-contract", tokenId: "1", purpose: "transfer-eligibility" }, NOW).attestationId, attestation.envelope.attestationId);
  assert.deepEqual(service.verify(attestation, { expectedSubject: { assetId: "asset-002" }, now: NOW }), { valid: false, errorCode: "SUBJECT_MISMATCH" });
  const unsupportedEnvelope = { ...attestation.envelope, schemaVersion: "giraffe-attestation.v999" };
  const unsupported = {
    envelope: unsupportedEnvelope,
    envelopeHash: evidenceHash(unsupportedEnvelope),
    signature: sign(null, createHash("sha256").update(canonicalJson(unsupportedEnvelope), "utf8").digest(), privateKey).toString("base64url"),
  };
  assert.deepEqual(service.verify(unsupported, { now: NOW }), { valid: false, errorCode: "SCHEMA_VERSION_UNSUPPORTED" });
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
  runtime.tokenIndex.bind({ chainId: "test-chain", contract: "contract-001", tokenId: "1", assetId: "asset-001" });
  assert.throws(() => runtime.settlements.begin({ settlementId: "settlement-too-long", assetId: "asset-001", token: { chainId: "test-chain", contract: "contract-001", tokenId: "1" }, sellerWallet: "s".repeat(129), buyerWallet: "buyer-wallet", externalExecutionRef: "external-execution-001", oldCertificateHash: HASH_B, warehouseReceiptHash: HASH_A, actorId: "synthetic-market", evidenceVersion: 2 }), /SETTLEMENT_SNAPSHOT_INCOMPLETE/);
  assert.equal(runtime.stateEngine.current("asset-001"), OracleStatus.VALID);
  assert.throws(() => runtime.settlements.begin({ settlementId: "settlement-actor-too-long", assetId: "asset-001", token: { chainId: "test-chain", contract: "contract-001", tokenId: "1" }, sellerWallet: "seller-wallet", buyerWallet: "buyer-wallet", externalExecutionRef: "external-execution-001", oldCertificateHash: HASH_B, warehouseReceiptHash: HASH_A, actorId: "a".repeat(65), evidenceVersion: 2 }), /SETTLEMENT_ACTOR_INVALID/);
  assert.equal(runtime.stateEngine.current("asset-001"), OracleStatus.VALID);
  const pending = runtime.settlements.begin({ settlementId: "settlement-001", assetId: "asset-001", token: { chainId: "test-chain", contract: "contract-001", tokenId: "1" }, sellerWallet: "seller-wallet", buyerWallet: "buyer-wallet", externalExecutionRef: "external-execution-001", oldCertificateHash: HASH_B, warehouseReceiptHash: HASH_A, actorId: "synthetic-market", evidenceVersion: 2 });
  assert.equal(pending.businessCalendarRef, "synthetic://calendar/wenbao-v1");
  assert.equal(pending.targetBusinessDays, 3);
  assert.equal(pending.snapshotHash.length, 64);
  assert.equal(runtime.stateEngine.current("asset-001"), OracleStatus.TRANSFER_PENDING);
  assert.throws(
    () => runtime.settlements.finalize({ settlementId: "settlement-001", certificate: {}, registryChangeRef: null, warehouseConfirmed: false, actorId: "synthetic-registry", evidenceVersion: 3 }),
    /SETTLEMENT_CONFIRMATION_INCOMPLETE/,
  );
  assert.throws(() => runtime.settlements.finalize({ settlementId: "settlement-001", certificate: { assetId: "asset-001", tokenId: "1", certificateHash: HASH_C, previousCertificateHash: HASH_B, certificateVersion: 2, wenbaoChangeRef: "change-001", warehouseReceiptHash: HASH_A }, certificateProvenance: { sourceId: "synthetic-certificates", schemaVersion: "certificate-record.v1" }, registryChangeRef: "change-001", snapshotHash: pending.snapshotHash, warehouseConfirmed: true, ownerBindingConfirmed: true, newOwnerCommitment: HASH_B, actorId: "a".repeat(65), evidenceVersion: 3 }), /SETTLEMENT_ACTOR_INVALID/);
  assert.equal(runtime.recordStore.certificateHistory("asset-001").length, 1);
  runtime.settlements.finalize({ settlementId: "settlement-001", certificate: { assetId: "asset-001", tokenId: "1", certificateHash: HASH_C, previousCertificateHash: HASH_B, certificateVersion: 2, wenbaoChangeRef: "change-001", warehouseReceiptHash: HASH_A }, certificateProvenance: { sourceId: "synthetic-certificates", schemaVersion: "certificate-record.v1" }, registryChangeRef: "change-001", snapshotHash: pending.snapshotHash, warehouseConfirmed: true, ownerBindingConfirmed: true, newOwnerCommitment: HASH_B, actorId: "synthetic-registry", evidenceVersion: 3 });
  assert.equal(runtime.recordStore.getAsset("asset-001").currentCertificateHash, HASH_C);
  assert.equal(runtime.recordStore.getAsset("asset-001").currentCertificateVersion, 2);
  assert.equal(runtime.recordStore.getAsset("asset-001").currentOwnerCommitment, HASH_B);
  assert.equal(runtime.stateEngine.current("asset-001"), OracleStatus.VALID);
  assert.equal(runtime.recordStore.currentCertificate("asset-001").certificateVersion, 2);
  assert.deepEqual(runtime.recordStore.certificateHistory("asset-001").map(({ status }) => status), ["SUPERSEDED", "CURRENT"]);
  assert.equal(runtime.recordStore.certificateHistory("asset-001")[0].supersededAt, NOW.toISOString());
  assert.equal(runtime.auditJournal.verify(), true);
});

test("settlement records the Oracle-generated versioned T+3 deadline", () => {
  const runtime = createSyntheticRuntime({ clock: () => NOW });
  runtime.recordStore.putAsset({ assetId: "asset-calendar", assetFingerprintHash: HASH_A });
  runtime.recordStore.appendCertificate({ assetId: "asset-calendar", certificateHash: HASH_B, certificateVersion: 1 });
  runtime.recordStore.putWarehouse({ assetId: "asset-calendar", warehouseReceiptHash: HASH_C });
  runtime.stateEngine.transition({ subjectId: "asset-calendar", to: OracleStatus.VALID, reasonHash: HASH_A, evidenceVersion: 1, occurredAt: NOW.toISOString() });
  runtime.tokenIndex.bind({ chainId: "test-chain", contract: "calendar-contract", tokenId: "1", assetId: "asset-calendar" });
  const settlement = runtime.settlements.begin({ settlementId: "calendar-deadline", assetId: "asset-calendar", token: { chainId: "test-chain", contract: "calendar-contract", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", externalExecutionRef: "execution", oldCertificateHash: HASH_B, warehouseReceiptHash: HASH_C, actorId: "operator", evidenceVersion: 2 });
  assert.equal(settlement.deadlineAt, "2026-08-27T00:00:00.000Z");
  assert.equal(settlement.businessCalendarRef, "synthetic://calendar/wenbao-v1");
});



