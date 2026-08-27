import assert from "node:assert/strict";
import test from "node:test";
import { MySqlOracleRepository } from "../src/adapters/mysql-repository.js";
import { ProtectedSignerAdapter } from "../src/adapters/protected-signer.js";
import { FixedSourceTransportAdapter } from "../src/adapters/fixed-source-transport.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";
import { Authorizer } from "../src/services/authorizer.js";
import { CommandJournal } from "../src/services/command-journal.js";
import { DualControlQueue } from "../src/services/dual-control.js";
import { OracleControlPlane } from "../src/services/oracle-control-plane.js";
import { Outbox } from "../src/services/outbox.js";
import { OutboxDispatcher } from "../src/services/outbox-dispatcher.js";
import { evidenceHash } from "../src/domain/canonical-json.js";

const NOW = new Date("2026-08-24T00:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function evidenceBundle(assetId, assetFingerprintHash = HASH_A, certificateHash = HASH_B, warehouseReceiptHash = HASH_C) {
  return {
    asset: {
      assetId, assetFingerprintHash, wenbaoRegistryRef: `registry-${assetId}`, transferEligibility: "VALID",
      warehouseId: `warehouse-${assetId}`, warehouseReceiptHash, currentCertificateHash: certificateHash,
      currentCertificateVersion: 1, currentOwnerCommitment: HASH_C, encumbranceStatus: "CLEAR",
      oracleStatus: "VALID", updatedAt: NOW.toISOString(),
    },
    certificate: {
      assetId, tokenId: "1", certificateVersion: 1, certificateHash, previousCertificateHash: null,
      wenbaoChangeRef: `initial-${assetId}`, warehouseReceiptHash, effectiveAt: NOW.toISOString(), status: "CURRENT",
    },
    warehouse: {
      assetId, warehouseId: `warehouse-${assetId}`, warehouseReceiptHash, warehouseStatus: "IN_CUSTODY",
      encumbranceStatus: "CLEAR", observedAt: NOW.toISOString(),
    },
  };
}

function controlFixture(clock = () => NOW) {
  const runtime = createSyntheticRuntime({ clock });
  const authorizer = new Authorizer();
  authorizer.registerActor("oracle-a", ["ORACLE_OPERATOR", "SECURITY_OFFICER"]);
  authorizer.registerActor("approver-b", ["APPROVER"]);
  authorizer.registerActor("reader-c", ["READER"]);
  const outbox = new Outbox();
  const control = new OracleControlPlane({ runtime, authorizer, dualControl: new DualControlQueue(), commandJournal: new CommandJournal(), outbox, allowSyntheticEvidence: true, clock });
  return { runtime, authorizer, outbox, control };
}

test("control plane verifies an asset idempotently and rejects unauthorized actor", () => {
  const { control } = controlFixture();
  const command = {
    actorId: "oracle-a",
    idempotencyKey: "verify-001",
    ...evidenceBundle("asset-001"),
    evidenceVersion: 1,
  };
  assert.equal(control.verifyAsset(command).result.status, "VALID");
  assert.equal(control.verifyAsset(command).replayed, true);
  assert.throws(() => control.verifyAsset({ ...command, actorId: "reader-c", idempotencyKey: "verify-002" }), /PERMISSION_DENIED/);
});

test("asset verification replays before mutable source-state checks", () => {
  const { runtime, control } = controlFixture();
  const evidence = evidenceBundle("asset-source-replay");
  const command = { actorId: "oracle-a", idempotencyKey: "verify-source-replay", ...evidence, evidenceVersion: 1 };
  assert.equal(control.verifyAsset(command).replayed, false);
  runtime.sourceRegistry.setActive("synthetic-registry", false);
  runtime.sourceRegistry.setActive("synthetic-certificates", false);
  runtime.sourceRegistry.setActive("synthetic-warehouse", false);
  assert.equal(control.verifyAsset(command).replayed, true);
});

test("registered evidence schemas enforce types patterns enums formats and nullable previous hash", () => {
  const { runtime } = controlFixture();
  const valid = evidenceBundle("asset-schema");
  assert.equal(runtime.schemaRegistry.validate("certificate-record.v1", valid.certificate).previousCertificateHash, null);
  assert.throws(() => runtime.schemaRegistry.validate("asset-record.v1", { ...valid.asset, currentCertificateVersion: "1" }), /PAYLOAD_FIELD_TYPE_INVALID/);
  assert.throws(() => runtime.schemaRegistry.validate("asset-record.v1", { ...valid.asset, assetFingerprintHash: "not-a-hash" }), /PAYLOAD_FIELD_PATTERN_INVALID/);
  assert.throws(() => runtime.schemaRegistry.validate("certificate-record.v1", { ...valid.certificate, status: "ACTIVE" }), /PAYLOAD_FIELD_ENUM_INVALID/);
  assert.throws(() => runtime.schemaRegistry.validate("warehouse-record.v1", { ...valid.warehouse, observedAt: "not-a-date" }), /PAYLOAD_FIELD_FORMAT_INVALID/);
  for (const malformed of ["2024-01-01", "2024-01-01T00:00:00", "2024-02-30T00:00:00Z"]) {
    assert.throws(() => runtime.schemaRegistry.validate("warehouse-record.v1", { ...valid.warehouse, observedAt: malformed }), /PAYLOAD_FIELD_FORMAT_INVALID/);
  }
});

test("asset verification rejects authoritative records whose prerequisites are not valid", () => {
  const { control } = controlFixture();
  const valid = evidenceBundle("asset-invalid-prerequisite");
  for (const [suffix, patch] of [
    ["asset", { asset: { ...valid.asset, oracleStatus: "INVALID" } }],
    ["transfer", { asset: { ...valid.asset, transferEligibility: "REVOKED" } }],
    ["certificate", { certificate: { ...valid.certificate, status: "REVOKED" } }],
    ["warehouse", { warehouse: { ...valid.warehouse, warehouseStatus: "RELEASED" } }],
  ]) assert.throws(() => control.verifyAsset({ actorId: "oracle-a", idempotencyKey: `invalid-prerequisite-${suffix}`, ...valid, ...patch, evidenceVersion: 1 }), /ASSET_EVIDENCE_NOT_VALID/);
});

test("failed asset verification leaves no partial in-memory records", () => {
  const { control, runtime } = controlFixture();
  assert.throws(
    () => {
      const evidence = evidenceBundle("asset-bad");
      return control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-bad", ...evidence, asset: { ...evidence.asset, currentCertificateVersion: 2 }, certificate: { ...evidence.certificate, certificateVersion: 2 }, evidenceVersion: 1 });
    },
    /CERTIFICATE_INITIAL_VERSION_INVALID/,
  );
  assert.equal(runtime.recordStore.getAsset("asset-bad"), null);
  assert.equal(runtime.recordStore.getWarehouse("asset-bad"), null);
});

test("asset verification requires certificate and warehouse evidence for the same asset", () => {
  const { control, runtime } = controlFixture();
  const cross = evidenceBundle("asset-a");
  assert.throws(() => control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-cross-asset", ...cross, certificate: { ...cross.certificate, assetId: "asset-b" }, warehouse: { ...cross.warehouse, assetId: "asset-c" }, evidenceVersion: 1 }), /ASSET_EVIDENCE_ID_MISMATCH/);
  assert.equal(runtime.recordStore.getAsset("asset-a"), null);
  assert.equal(runtime.recordStore.currentCertificate("asset-b"), null);
  assert.equal(runtime.recordStore.getWarehouse("asset-c"), null);
});

test("asset verification rejects contradictory certificate and warehouse summary fields", () => {
  const { control, runtime } = controlFixture();
  const bundle = evidenceBundle("asset-bundle");
  const base = { actorId: "oracle-a", idempotencyKey: "verify-bundle-mismatch", ...bundle, asset: { ...bundle.asset, currentCertificateHash: HASH_A }, evidenceVersion: 1 };
  assert.throws(() => control.verifyAsset(base), /ASSET_EVIDENCE_BUNDLE_MISMATCH/);
  assert.equal(runtime.recordStore.getAsset("asset-bundle"), null);
});

test("asset verification requires every registered evidence schema field", () => {
  const { control, runtime } = controlFixture();
  const evidence = evidenceBundle("asset-incomplete");
  delete evidence.asset.currentOwnerCommitment;
  assert.throws(() => control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-incomplete", ...evidence, evidenceVersion: 1 }), /PAYLOAD_REQUIRED_FIELD_MISSING:currentOwnerCommitment/);
  assert.equal(runtime.recordStore.getAsset("asset-incomplete"), null);
});

test("attestation revocation requires independent approval", () => {
  const { control, runtime } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-001", ...evidenceBundle("asset-001"), evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-001", binding: { assetId: "asset-001", chainId: "test-chain", contract: "contract-001", tokenId: "1" } });
  const issued = control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-001", request: { subject: { assetId: "asset-001", chainId: "test-chain", contract: "contract-001", tokenId: "1", purpose: "transfer-eligibility" }, factType: "TRANSFER_STATUS", factValue: "VALID", sourceAuthority: "synthetic-registry", sourceRecordHash: evidenceHash(runtime.recordStore.getAsset("asset-001")), validForSeconds: 60, nonce: "attestation-nonce-001" } }).result;
  control.requestRevocation({ actorId: "oracle-a", actionId: "revoke-001", attestationId: issued.envelope.attestationId, reasonHash: HASH_C });
  assert.throws(() => control.executeRevocation({ actorId: "oracle-a", actionId: "revoke-001", attestationId: issued.envelope.attestationId, reasonHash: HASH_C }), /APPROVAL_REQUIRED/);
  control.approveAction({ actorId: "approver-b", actionId: "revoke-001" });
  assert.equal(control.executeRevocation({ actorId: "oracle-a", actionId: "revoke-001", attestationId: issued.envelope.attestationId, reasonHash: HASH_C }).attestationId, issued.envelope.attestationId);
});

test("revocation validates reason, is HTTP-idempotent, and rejects conflicting re-revocation", () => {
  const { control, runtime } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-revoke", ...evidenceBundle("asset-revoke"), evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-revoke", binding: { assetId: "asset-revoke", chainId: "test-chain", contract: "contract-001", tokenId: "1" } });
  const issued = control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-revoke", request: { subject: { assetId: "asset-revoke", chainId: "test-chain", contract: "contract-001", tokenId: "1", purpose: "transfer-eligibility" }, factType: "TRANSFER_STATUS", factValue: "VALID", sourceAuthority: "synthetic-registry", sourceRecordHash: evidenceHash(runtime.recordStore.getAsset("asset-revoke")), validForSeconds: 60, nonce: "revoke-nonce" } }).result;
  assert.throws(() => control.requestRevocation({ actorId: "oracle-a", actionId: "invalid-reason", attestationId: issued.envelope.attestationId }), /REVOCATION_REASON_HASH_INVALID/);
  const request = { actorId: "oracle-a", idempotencyKey: "revoke-request-idem", actionId: "revoke-idem", attestationId: issued.envelope.attestationId, reasonHash: HASH_B };
  assert.equal(control.requestRevocation(request).replayed, false);
  assert.equal(control.requestRevocation(request).replayed, true);
  control.approveAction({ actorId: "approver-b", actionId: "revoke-idem" });
  const execute = { actorId: "oracle-a", idempotencyKey: "revoke-execute-idem", actionId: "revoke-idem", attestationId: issued.envelope.attestationId, reasonHash: HASH_B };
  assert.equal(control.executeRevocation(execute).replayed, false);
  assert.equal(control.executeRevocation(execute).replayed, true);
  const auditCount = runtime.auditJournal.list().length;
  assert.throws(() => control.requestRevocation({ actorId: "oracle-a", actionId: "revoke-conflict", attestationId: issued.envelope.attestationId, reasonHash: HASH_C }), /ATTESTATION_ALREADY_REVOKED|ACTION/);
  assert.equal(runtime.auditJournal.list().length, auditCount);
});

test("token binding is one-to-one and idempotent", () => {
  const { control, runtime } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-001", ...evidenceBundle("asset-001"), evidenceVersion: 1 });
  const command = { actorId: "oracle-a", idempotencyKey: "bind-001", binding: { chainId: "test-chain", contract: "contract-001", tokenId: "1", assetId: "asset-001" } };
  assert.equal(control.bindToken(command).result.assetId, "asset-001");
  assert.equal(control.bindToken(command).replayed, true);
  assert.equal(runtime.tokenIndex.byAsset("asset-001").tokenId, "1");
  assert.throws(() => runtime.tokenIndex.bind({ chainId: "test-chain", contract: "contract-001", tokenId: "2", assetId: "asset-001" }), /ASSET_ALREADY_TOKENIZED/);
});

test("attestation service rejects duplicate nonces", () => {
  const { control, runtime } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-001", ...evidenceBundle("asset-001"), evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-001", binding: { assetId: "asset-001", chainId: "test-chain", contract: "contract-001", tokenId: "1" } });
  const request = { subject: { assetId: "asset-001", chainId: "test-chain", contract: "contract-001", tokenId: "1", purpose: "transfer-eligibility" }, factType: "TRANSFER_STATUS", factValue: "VALID", sourceAuthority: "synthetic-registry", sourceRecordHash: evidenceHash(runtime.recordStore.getAsset("asset-001")), validForSeconds: 60, nonce: "same-nonce" };
  control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-001", request });
  assert.throws(() => control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-002", request }), /ATTESTATION_NONCE_REUSED/);
});

test("attestation issuance requires the exact registered token subject", () => {
  const { control, runtime } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-bound", ...evidenceBundle("asset-bound"), evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-bound", binding: { assetId: "asset-bound", chainId: "test-chain", contract: "contract-bound", tokenId: "7" } });
  const base = { subject: { assetId: "asset-bound", chainId: "test-chain", contract: "contract-bound", tokenId: "7", purpose: "transfer-eligibility" }, factType: "TRANSFER_STATUS", factValue: "VALID", sourceAuthority: "synthetic-registry", sourceRecordHash: evidenceHash(runtime.recordStore.getAsset("asset-bound")), validForSeconds: 60, nonce: "bound-nonce" };
  assert.throws(() => control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-wrong-token", request: { ...base, subject: { ...base.subject, tokenId: "8" } } }), /ATTESTATION_TOKEN_BINDING_MISMATCH/);
  assert.equal(control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-bound", request: base }).result.envelope.subject.tokenId, "7");
});

test("attestation issuance requires an active registered source and its verified record hash", () => {
  const { control, runtime } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-source", ...evidenceBundle("asset-source"), evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-source", binding: { assetId: "asset-source", chainId: "test-chain", contract: "contract-source", tokenId: "1" } });
  const base = { subject: { assetId: "asset-source", chainId: "test-chain", contract: "contract-source", tokenId: "1", purpose: "provenance" }, factType: "TRANSFER_STATUS", factValue: "VALID", sourceAuthority: "synthetic-registry", sourceRecordHash: evidenceHash(runtime.recordStore.getAsset("asset-source")), validForSeconds: 60, nonce: "source-valid" };
  assert.throws(() => control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-unknown-source", request: { ...base, sourceAuthority: "unknown-source", nonce: "source-unknown" } }), /SOURCE_NOT_REGISTERED/);
  assert.throws(() => control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-wrong-source-hash", request: { ...base, sourceRecordHash: HASH_B, nonce: "source-wrong" } }), /ATTESTATION_SOURCE_RECORD_MISMATCH/);
  assert.throws(() => control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-wrong-fact", request: { ...base, factValue: "BLOCKED", nonce: "source-wrong-fact" } }), /ATTESTATION_FACT_SOURCE_MISMATCH/);
  assert.equal(control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-source-replay", request: { ...base, nonce: "source-replay" } }).result.envelope.sourceAuthority, "synthetic-registry");
  runtime.sourceRegistry.setActive("synthetic-registry", false);
  assert.equal(control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-source-replay", request: { ...base, nonce: "source-replay" } }).replayed, true);
  assert.throws(() => control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-inactive-source", request: { ...base, nonce: "source-inactive" } }), /SOURCE_INACTIVE/);
});

test("attestation authority must equal the source that authenticated the stored projection", () => {
  const { control, runtime } = controlFixture();
  runtime.sourceRegistry.add({ id: "alternate-registry", displayName: "Alternate Registry", kind: "REGISTRY", keySetId: "alternate-registry-keys", schemaVersions: ["asset-record.v1"], active: true });
  const evidence = evidenceBundle("asset-authority");
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-authority", ...evidence, evidenceSources: { asset: "synthetic-registry", certificate: "synthetic-certificates", warehouse: "synthetic-warehouse" }, evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-authority", binding: { assetId: "asset-authority", chainId: "test-chain", contract: "contract-authority", tokenId: "1" } });
  const request = { subject: { assetId: "asset-authority", chainId: "test-chain", contract: "contract-authority", tokenId: "1", purpose: "provenance" }, factType: "TRANSFER_STATUS", factValue: "VALID", sourceAuthority: "alternate-registry", sourceRecordHash: evidenceHash(runtime.recordStore.getAsset("asset-authority")), validForSeconds: 60, nonce: "authority-mismatch" };
  assert.throws(() => control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-authority-mismatch", request }), /ATTESTATION_SOURCE_AUTHORITY_MISMATCH/);
});

test("outbox dispatcher retries and then publishes", async () => {
  const outbox = new Outbox();
  outbox.enqueue({ eventType: "asset.verified", subjectId: "asset-001", payloadHash: HASH_A, createdAt: NOW.toISOString() });
  let calls = 0;
  const dispatcher = new OutboxDispatcher({ outbox, clock: () => NOW, publisher: { async publish() { calls += 1; if (calls === 1) throw new Error("temporary"); } } });
  assert.equal((await dispatcher.drain())[0].status, "RETRY");
  assert.equal((await dispatcher.drain())[0].status, "PUBLISHED");
  assert.equal(outbox.pending().length, 0);
});

test("outbox forwards exhausted retries to the durable dead-letter publisher", async () => {
  const outbox = new Outbox();
  const event = outbox.enqueue({ eventType: "settlement.refund-required", subjectId: "asset-dead-letter", payloadHash: HASH_A, createdAt: NOW.toISOString() });
  let deadLetters = 0;
  const dispatcher = new OutboxDispatcher({ outbox, maxAttempts: 2, clock: () => NOW, publisher: { async publish() { throw new Error("offline"); }, async publishDeadLetter(candidate) { assert.equal(candidate.eventId, event.eventId); deadLetters += 1; } } });
  assert.equal((await dispatcher.drain())[0].status, "RETRY");
  assert.equal((await dispatcher.drain())[0].status, "RETRY");
  assert.equal((await dispatcher.drain())[0].status, "DEAD_LETTERED");
  assert.equal(deadLetters, 1);
  assert.equal(outbox.pending().length, 0);
});

test("cancelled settlements emit an explicit refund-required notification", () => {
  const { runtime, control, outbox } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-refund", ...evidenceBundle("asset-refund"), evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-refund", binding: { assetId: "asset-refund", chainId: "test-chain", contract: "contract-refund", tokenId: "1" } });
  control.beginSettlement({ actorId: "oracle-a", idempotencyKey: "begin-refund", request: { settlementId: "settlement-refund", assetId: "asset-refund", token: { chainId: "test-chain", contract: "contract-refund", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", externalExecutionRef: "external-refund", oldCertificateHash: HASH_B, warehouseReceiptHash: HASH_C, evidenceVersion: 2 } });
  control.cancelSettlement({ actorId: "oracle-a", idempotencyKey: "cancel-refund", request: { settlementId: "settlement-refund", reasonHash: HASH_A, evidenceVersion: 3 } });
  assert.equal(outbox.pending().filter((event) => event.eventType === "settlement.refund-required").length, 1);
  assert.equal(runtime.settlements.get("settlement-refund").failureReasonHash, HASH_A);
});

test("settlement finalization rejects a non-current replacement certificate", () => {
  const { runtime, control } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-finalize-status", ...evidenceBundle("asset-finalize-status"), evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-finalize-status", binding: { assetId: "asset-finalize-status", chainId: "test-chain", contract: "contract-finalize", tokenId: "1" } });
  const pending = control.beginSettlement({ actorId: "oracle-a", idempotencyKey: "begin-finalize-status", request: { settlementId: "settlement-finalize-status", assetId: "asset-finalize-status", token: { chainId: "test-chain", contract: "contract-finalize", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", externalExecutionRef: "external-finalize", oldCertificateHash: HASH_B, warehouseReceiptHash: HASH_C, evidenceVersion: 2 } }).result;
  const certificate = { assetId: "asset-finalize-status", tokenId: "1", certificateVersion: 2, certificateHash: HASH_A, previousCertificateHash: HASH_B, wenbaoChangeRef: "change-finalize", warehouseReceiptHash: HASH_C, effectiveAt: NOW.toISOString(), status: "REVOKED" };
  assert.throws(() => control.finalizeSettlement({ actorId: "oracle-a", idempotencyKey: "finalize-revoked", request: { settlementId: pending.settlementId, certificate, certificateSourceId: "synthetic-certificates", certificateSourceRecordHash: evidenceHash(certificate), registryChangeRef: "change-finalize", snapshotHash: pending.snapshotHash, warehouseConfirmed: true, ownerBindingConfirmed: true, newOwnerCommitment: HASH_A, evidenceVersion: 3 } }), /SETTLEMENT_CERTIFICATE_NOT_CURRENT/);
  assert.equal(runtime.settlements.get(pending.settlementId).status, "PENDING");
});

test("settlement failure paths reject invalid reasons before mutation", () => {
  const { runtime, control } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-invalid-reason", ...evidenceBundle("asset-invalid-reason"), evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-invalid-reason", binding: { assetId: "asset-invalid-reason", chainId: "test-chain", contract: "contract-invalid", tokenId: "1" } });
  control.beginSettlement({ actorId: "oracle-a", idempotencyKey: "begin-invalid-reason", request: { settlementId: "settlement-invalid-reason", assetId: "asset-invalid-reason", token: { chainId: "test-chain", contract: "contract-invalid", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", externalExecutionRef: "external-invalid", oldCertificateHash: HASH_B, warehouseReceiptHash: HASH_C, evidenceVersion: 2 } });
  assert.throws(() => control.cancelSettlement({ actorId: "oracle-a", idempotencyKey: "cancel-invalid-reason", request: { settlementId: "settlement-invalid-reason", evidenceVersion: 3 } }), /SETTLEMENT_REASON_HASH_INVALID/);
  assert.equal(runtime.settlements.get("settlement-invalid-reason").status, "PENDING");
  assert.equal(runtime.stateEngine.current("asset-invalid-reason"), "TRANSFER_PENDING");
});

test("disputed and timed-out settlements emit deterministic refund notifications", () => {
  let now = NOW;
  const { runtime, control, outbox } = controlFixture(() => now);
  const prepare = (suffix, fingerprint, certificate, receipt) => {
    control.verifyAsset({ actorId: "oracle-a", idempotencyKey: `verify-${suffix}`, ...evidenceBundle(`asset-${suffix}`, fingerprint, certificate, receipt), evidenceVersion: 1 });
    control.bindToken({ actorId: "oracle-a", idempotencyKey: `bind-${suffix}`, binding: { assetId: `asset-${suffix}`, chainId: "test-chain", contract: `contract-${suffix}`, tokenId: "1" } });
    control.beginSettlement({ actorId: "oracle-a", idempotencyKey: `begin-${suffix}`, request: { settlementId: `settlement-${suffix}`, assetId: `asset-${suffix}`, token: { chainId: "test-chain", contract: `contract-${suffix}`, tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", externalExecutionRef: `external-${suffix}`, oldCertificateHash: certificate, warehouseReceiptHash: receipt, evidenceVersion: 2 } });
  };
  prepare("dispute", HASH_A, HASH_B, HASH_C);
  control.disputeSettlement({ actorId: "oracle-a", idempotencyKey: "dispute", request: { settlementId: "settlement-dispute", reasonHash: HASH_A, evidenceVersion: 3 } });
  prepare("timeout", "d".repeat(64), "e".repeat(64), "f".repeat(64));
  now = new Date(NOW.getTime() + 5 * 86400000);
  control.timeoutSettlement({ actorId: "oracle-a", idempotencyKey: "timeout", request: { settlementId: "settlement-timeout", reasonHash: HASH_B, evidenceVersion: 3 } });
  assert.deepEqual(outbox.pending().filter((event) => event.eventType === "settlement.refund-required").map((event) => event.subjectId).sort(), ["asset-dispute", "asset-timeout"]);
  assert.equal(runtime.recordStore.certificateHistory("asset-dispute").length, 1);
  assert.equal(runtime.recordStore.certificateHistory("asset-timeout").length, 1);
});

test("MySQL adapter commits success and rolls back failure", async () => {
  const events = [];
  const connection = { async beginTransaction() { events.push("begin"); }, async commit() { events.push("commit"); }, async rollback() { events.push("rollback"); }, release() { events.push("release"); } };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  assert.equal(await repository.transaction(async () => "ok"), "ok");
  assert.deepEqual(events, ["begin", "commit", "release"]);
  events.length = 0;
  await assert.rejects(() => repository.transaction(async () => { throw new Error("failure"); }), /failure/);
  assert.deepEqual(events, ["begin", "rollback", "release"]);
});

test("MySQL asset upsert rejects unique identity collisions before mutation", async () => {
  let writes = 0;
  const connection = { async execute(sql) { if (sql.startsWith("SELECT")) return [[{ asset_id: "asset-existing" }]]; writes += 1; return [{}]; } };
  const repository = new MySqlOracleRepository({ pool: { getConnection() {} } });
  await assert.rejects(() => repository.upsertAsset(connection, { assetId: "asset-new", assetFingerprintHash: HASH_A, warehouseReceiptHash: HASH_B, currentCertificateHash: HASH_C }), /ASSET_UNIQUE_IDENTITY_CONFLICT/);
  assert.equal(writes, 0);
});

test("MySQL attestation projection stores a SHA-256 fact value hash", async () => {
  let attestationParameters = null;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parameters = []) {
      if (sql.includes("INSERT INTO attestations")) attestationParameters = parameters;
      return [[], []];
    },
  };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  const envelope = { attestationId: "attestation-db", subject: { assetId: "asset-db", chainId: "560048", contract: "test-only", tokenId: "1", purpose: "OWNERSHIP" }, schemaVersion: "giraffe-attestation.v1", factType: "STATUS", factValue: "VALID", sourceAuthority: "registry", sourceRecordHash: HASH_A, observedAt: NOW.toISOString(), nonce: "db-nonce", revocationRef: null, signerSetId: "test-signers", validFrom: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 60000).toISOString() };
  await repository.persistMutation({ method: "issueAttestation", idempotencyKey: "db-attestation", commandHash: HASH_B, input: {}, result: { envelope, envelopeHash: HASH_C, signature: "test-signature" }, auditEvents: [], outboxEvents: [], stateSnapshot: { state: { testOnly: true }, stateHash: HASH_A } });
  assert.equal(attestationParameters[10], evidenceHash("VALID"));
  assert.match(attestationParameters[10], /^[a-f0-9]{64}$/);
});

test("MySQL warehouse projection falls back to the schema-required asset encumbrance", async () => {
  let warehouseParameters = null;
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, parameters = []) {
      if (sql.includes("INSERT INTO warehouse_records")) warehouseParameters = parameters;
      return [[], []];
    },
  };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  const bundle = evidenceBundle("asset-warehouse-fallback");
  delete bundle.warehouse.encumbranceStatus;
  await repository.persistMutation({ method: "verifyAsset", idempotencyKey: "warehouse-fallback", commandHash: HASH_A, input: { ...bundle, evidenceVersion: 1, evidenceSources: { asset: "registry", certificate: "certificates", warehouse: "warehouse" } }, result: { status: "VALID" }, auditEvents: [], outboxEvents: [], stateSnapshot: { state: { schemaVersion: "test" }, stateHash: HASH_B } });
  assert.equal(warehouseParameters[5], "CLEAR");
});

test("MySQL settlement projection preserves distinct terminal timestamps", async () => {
  let settlementParameters = null;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parameters = []) {
      if (sql.includes("INSERT INTO settlements")) settlementParameters = parameters;
      return [[], []];
    },
  };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  const disputedAt = "2026-08-24T01:00:00.000Z";
  const record = { settlementId: "settlement-db", assetId: "asset-db", token: { chainId: "560048", contract: "test-only", tokenId: "1" }, sellerWallet: "seller-test", buyerWallet: "buyer-test", snapshotHash: HASH_A, externalExecutionRef: "test-execution", oldCertificateHash: HASH_B, failureReasonHash: HASH_C, status: "DISPUTED", deadlineAt: "2026-08-27T00:00:00.000Z", startedAt: NOW.toISOString(), disputedAt };
  await repository.persistMutation({ method: "disputeSettlement", idempotencyKey: "db-dispute", commandHash: HASH_B, input: {}, result: record, auditEvents: [], outboxEvents: [], stateSnapshot: { state: { testOnly: true }, stateHash: HASH_A } });
  assert.equal(settlementParameters[17], null);
  assert.equal(settlementParameters[18], disputedAt);
  assert.equal(settlementParameters[19], null);
});

test("command journal deduplicates concurrent async operations and clears failed pending records", async () => {
  const journal = new CommandJournal();
  let calls = 0;
  let resolveOperation;
  const operation = () => {
    calls += 1;
    return new Promise((resolve) => { resolveOperation = resolve; });
  };
  const first = journal.execute("async-001", { type: "async" }, operation);
  const replay = journal.execute("async-001", { type: "async" }, operation);
  assert.equal(calls, 1);
  resolveOperation("stored");
  assert.deepEqual(await first, { commandHash: (await first).commandHash, result: "stored", replayed: false });
  assert.equal((await replay).replayed, true);

  let failedCalls = 0;
  await assert.rejects(() => journal.execute("async-fail", { type: "failure" }, async () => { failedCalls += 1; throw new Error("temporary"); }), /temporary/);
  assert.equal((await journal.execute("async-fail", { type: "failure" }, async () => { failedCalls += 1; return "recovered"; })).result, "recovered");
  assert.equal(failedCalls, 2);
});

test("protected signer enforces local policy before client call", async () => {
  let calls = 0;
  const signer = new ProtectedSignerAdapter({ client: { async signDigest() { calls += 1; return { signature: "synthetic", signerSetId: "set-001" }; }, async getPublicSignerSet() { return { signerSetId: "set-001", publicKeys: ["synthetic"] }; } }, policy: { policyId: "oracle-v1", schemaVersions: ["giraffe-attestation.v1"], purposes: ["transfer-eligibility"], maxTtlSeconds: 300 } });
  await assert.rejects(() => signer.signAttestation({ envelopeHash: HASH_A, schemaVersion: "unknown.v1", purpose: "transfer-eligibility", ttlSeconds: 60 }), /SIGNER_SCHEMA_REJECTED/);
  assert.equal(calls, 0);
  assert.equal((await signer.signAttestation({ envelopeHash: HASH_A, schemaVersion: "giraffe-attestation.v1", purpose: "transfer-eligibility", ttlSeconds: 60 })).signerSetId, "set-001");
});

test("fixed source transport accepts references but no endpoint", async () => {
  const calls = [];
  const adapter = new FixedSourceTransportAdapter({ sourceRegistration: { sourceId: "registry-a" }, transport: { async fetch(value) { calls.push(value); return { ok: true }; }, async health() { return { ok: true }; } } });
  assert.deepEqual(await adapter.fetchByFixedReference("record:001"), { ok: true });
  assert.equal(calls[0].sourceRegistrationId, "registry-a");
  await assert.rejects(() => adapter.fetchByFixedReference("https://example.invalid"), /REFERENCE_INVALID/);
});

test("dead-letter failures do not starve active outbox delivery", async () => {
  const outbox = new Outbox();
  const poison = outbox.enqueue({ eventType: "poison", subjectId: "asset-poison", payloadHash: HASH_A, createdAt: "2026-08-24T00:00:00.000Z" });
  for (let attempt = 0; attempt < 5; attempt += 1) outbox.recordAttempt(poison.eventId);
  const active = outbox.enqueue({ eventType: "active", subjectId: "asset-active", payloadHash: HASH_B, createdAt: "2026-08-24T00:00:01.000Z" });
  const published = [];
  const dispatcher = new OutboxDispatcher({ outbox, publisher: { async publish(event) { published.push(event.eventId); }, async publishDeadLetter() { throw new Error("dead letter unavailable"); } }, clock: () => NOW, maxAttempts: 5 });
  const result = await dispatcher.drain(1);
  assert.deepEqual(published, [active.eventId]);
  assert.deepEqual(result.map(({ status }) => status), ["PUBLISHED", "DEAD_LETTER_RETRY"]);
});

test("MySQL snapshot restore overlays independently committed outbox delivery state", async () => {
  const event = { eventId: "00000000-0000-4000-8000-000000000001", eventType: "test", subjectId: "asset", payloadHash: HASH_A, createdAt: NOW.toISOString(), attempts: 0, publishedAt: null, deadLetteredAt: null, durable: true };
  const storedState = { schemaVersion: "giraffe-production-state.v1", components: { outbox: { events: [event] } }, dualControl: { actions: [] } };
  const pool = {
    async getConnection() { throw new Error("not used"); },
    async execute(sql) {
      if (sql.includes("production_state_snapshots")) return [[{ state_json: JSON.stringify(storedState), state_hash: evidenceHash(storedState) }]];
      if (sql.includes("outbox_events")) return [[{ event_id: event.eventId, attempts: 5, published_at: null, dead_lettered_at: "2026-08-24T00:01:00.000Z" }]];
      throw new Error("unexpected query");
    },
  };
  const restored = await new MySqlOracleRepository({ pool }).loadStateSnapshot();
  assert.equal(restored.state.components.outbox.events[0].attempts, 5);
  assert.equal(restored.state.components.outbox.events[0].deadLetteredAt, "2026-08-24T00:01:00.000Z");
  assert.equal(restored.stateHash, evidenceHash(restored.state));
});
