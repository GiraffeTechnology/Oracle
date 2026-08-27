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
import { AttestationService } from "../src/domain/attestation-service.js";
import { RevocationRegistry } from "../src/domain/revocation-registry.js";

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

test("authorizer rejects actor identifiers wider than the audit projection", () => {
  const authorizer = new Authorizer();
  assert.throws(() => authorizer.registerActor("x".repeat(65), ["ORACLE_OPERATOR"]), /ACTOR_REGISTRATION_INVALID/);
  assert.throws(() => authorizer.require("x".repeat(65), "asset:verify"), /ACTOR_ID_INVALID/);
});

test("authoritative re-verification supersedes the previous current certificate", () => {
  const { runtime, control } = controlFixture();
  const first = evidenceBundle("asset-reverify");
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-reverify-1", ...first, evidenceVersion: 1 });
  runtime.stateEngine.transition({ subjectId: "asset-reverify", to: "TRANSFER_PENDING", reasonHash: HASH_B, evidenceVersion: 2, occurredAt: NOW.toISOString() });
  runtime.stateEngine.transition({ subjectId: "asset-reverify", to: "REVIEW_REQUIRED", reasonHash: HASH_C, evidenceVersion: 3, occurredAt: NOW.toISOString() });
  const second = evidenceBundle("asset-reverify");
  second.asset.currentCertificateHash = HASH_A;
  second.asset.currentCertificateVersion = 2;
  second.certificate = { ...second.certificate, certificateHash: HASH_A, certificateVersion: 2, previousCertificateHash: HASH_B, wenbaoChangeRef: "change-reverify" };
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-reverify-2", ...second, evidenceVersion: 4 });
  const history = runtime.recordStore.certificateHistory("asset-reverify");
  assert.deepEqual(history.map(({ status }) => status), ["SUPERSEDED", "CURRENT"]);
  assert.equal(history[0].supersededAt, second.certificate.effectiveAt);
});
test("asset re-verification is rejected while its settlement is pending", () => {
  const { runtime, control } = controlFixture();
  const first = evidenceBundle("asset-pending-reverify");
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "pending-reverify-initial", ...first, evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "pending-reverify-bind", binding: { assetId: first.asset.assetId, chainId: "560048", contract: "test-only", tokenId: "1" } });
  const pending = control.beginSettlement({ actorId: "oracle-a", idempotencyKey: "pending-reverify-begin", request: { settlementId: "settlement-pending-reverify", assetId: first.asset.assetId, token: { chainId: "560048", contract: "test-only", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", externalExecutionRef: "test-only", oldCertificateHash: HASH_B, warehouseReceiptHash: HASH_C, evidenceVersion: 2 } }).result;
  const replacement = evidenceBundle(first.asset.assetId);
  replacement.asset.currentCertificateHash = HASH_A;
  replacement.asset.currentCertificateVersion = 2;
  replacement.certificate = { ...replacement.certificate, certificateHash: HASH_A, certificateVersion: 2, previousCertificateHash: HASH_B, wenbaoChangeRef: "change-pending-reverify" };
  assert.throws(() => control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "pending-reverify-refused", ...replacement, evidenceVersion: 3 }), /ASSET_REVERIFICATION_SETTLEMENT_PENDING/);
  assert.equal(runtime.settlements.get(pending.settlementId).status, "PENDING");
  assert.equal(runtime.stateEngine.current(first.asset.assetId), "TRANSFER_PENDING");
  assert.equal(runtime.recordStore.certificateHistory(first.asset.assetId).length, 1);
  const cancelled = control.cancelSettlement({ actorId: "oracle-a", idempotencyKey: "pending-reverify-cancel", request: { settlementId: pending.settlementId, reasonHash: HASH_A, evidenceVersion: 3 } }).result;
  assert.equal(cancelled.status, "CANCELLED");
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
  for (const outside of ["1969-12-31T23:59:59Z", "2040-01-01T00:00:00Z"]) {
    assert.throws(() => runtime.schemaRegistry.validate("asset-record.v1", { ...valid.asset, updatedAt: outside }), /PAYLOAD_FIELD_PERSISTENCE_RANGE_INVALID/);
    assert.throws(() => runtime.schemaRegistry.validate("certificate-record.v1", { ...valid.certificate, effectiveAt: outside }), /PAYLOAD_FIELD_PERSISTENCE_RANGE_INVALID/);
    assert.throws(() => runtime.schemaRegistry.validate("warehouse-record.v1", { ...valid.warehouse, observedAt: outside }), /PAYLOAD_FIELD_PERSISTENCE_RANGE_INVALID/);
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
  const evidence = evidenceBundle("asset-bound");
  evidence.certificate = { ...evidence.certificate, tokenId: "7" };
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-bound", ...evidence, evidenceVersion: 1 });
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

test("attestation persistence bounds are enforced before the signer is called", () => {
  let signerCalls = 0;
  const service = new AttestationService({
    signerSetId: "test-signers",
    signBytes() { signerCalls += 1; return Buffer.alloc(64); },
    verifyBytes() { return true; },
    revocations: new RevocationRegistry(),
    clock: () => NOW,
  });
  const base = { subject: { assetId: "asset", chainId: "560048", contract: "test-only", tokenId: "1", purpose: "OWNERSHIP" }, factType: "STATUS", factValue: "VALID", sourceAuthority: "registry", sourceRecordHash: HASH_A, validForSeconds: 60, nonce: "valid" };
  for (const request of [
    { ...base, subject: { ...base.subject, purpose: "p".repeat(129) } },
    { ...base, subject: { ...base.subject, contract: "c".repeat(129) } },
    { ...base, subject: { ...base.subject, tokenId: "t".repeat(129) } },
    { ...base, nonce: "n".repeat(129) },
    { ...base, revocationRef: "r".repeat(257) },
    { ...base, sourceAuthority: "s".repeat(65) },
    { ...base, sourceRecordHash: "not-a-hash" },
  ]) assert.throws(() => service.issue(request), /ATTESTATION_REQUEST_INVALID/);
  assert.equal(signerCalls, 0);
  assert.equal(service.issue(base).envelope.nonce, "valid");
  assert.equal(signerCalls, 1);
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
      if (sql.startsWith("UPDATE assets SET oracle_status=")) return [{ affectedRows: 1 }, []];
      return [[], []];
    },
  };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  const disputedAt = "2026-08-24T01:00:00.000Z";
  const record = { settlementId: "settlement-db", assetId: "asset-db", token: { chainId: "560048", contract: "test-only", tokenId: "1" }, sellerWallet: "seller-test", buyerWallet: "buyer-test", snapshotHash: HASH_A, externalExecutionRef: "test-execution", oldCertificateHash: HASH_B, failureReasonHash: HASH_C, status: "DISPUTED", deadlineAt: "2026-08-27T00:00:00.000Z", startedAt: NOW.toISOString(), disputedAt };
  await repository.persistMutation({ method: "disputeSettlement", idempotencyKey: "db-dispute", commandHash: HASH_B, input: { request: { evidenceVersion: 3 } }, result: record, auditEvents: [], outboxEvents: [], stateSnapshot: { state: { testOnly: true }, stateHash: HASH_A } });
  assert.equal(settlementParameters[17], null);
  assert.equal(settlementParameters[18], disputedAt);
  assert.equal(settlementParameters[19], null);
});

test("MySQL re-verification supersedes exactly one previous current certificate", async () => {
  const statements = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, parameters = []) {
      statements.push({ sql, parameters });
      if (sql.startsWith("SELECT asset_id FROM assets")) return [[], []];
      if (sql.includes("UPDATE certificate_versions SET certificate_status='SUPERSEDED'")) return [{ affectedRows: 1 }, []];
      return [[], []];
    },
  };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  const bundle = evidenceBundle("asset-db-reverify");
  bundle.asset.currentCertificateHash = HASH_A;
  bundle.asset.currentCertificateVersion = 2;
  bundle.certificate = { ...bundle.certificate, certificateHash: HASH_A, certificateVersion: 2, previousCertificateHash: HASH_B, wenbaoChangeRef: "change-db-reverify" };
  await repository.persistMutation({ method: "verifyAsset", idempotencyKey: "db-reverify", commandHash: HASH_A, input: { ...bundle, evidenceVersion: 2, evidenceSources: { asset: "registry", certificate: "certificates", warehouse: "warehouse" } }, result: { status: "VALID" }, auditEvents: [], outboxEvents: [], stateSnapshot: { state: { testOnly: true }, stateHash: HASH_B } });
  const supersede = statements.findIndex(({ sql }) => sql.includes("UPDATE certificate_versions SET certificate_status='SUPERSEDED'"));
  const replacement = statements.findIndex(({ sql }) => sql.includes("INSERT INTO certificate_versions"));
  assert.equal(supersede >= 0, true);
  assert.equal(replacement > supersede, true);
});
test("MySQL finalization supersedes the old certificate before inserting the replacement", async () => {
  const statements = [];
  const connection = { async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, async execute(sql, parameters = []) { statements.push({ sql, parameters }); return [sql.includes("UPDATE certificate_versions SET certificate_status='SUPERSEDED'") || sql.startsWith("UPDATE assets SET") ? { affectedRows: 1 } : [], []]; } };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  const certificate = { assetId: "asset-db", tokenId: "1", certificateVersion: 2, certificateHash: HASH_C, previousCertificateHash: HASH_B, wenbaoChangeRef: "change-db", warehouseReceiptHash: HASH_A, effectiveAt: NOW.toISOString(), status: "CURRENT" };
  const record = { settlementId: "settlement-final", assetId: "asset-db", token: { chainId: "560048", contract: "test-only", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", snapshotHash: HASH_A, externalExecutionRef: "execution", oldCertificateHash: HASH_B, newCertificateHash: HASH_C, registryChangeRef: "change-db", status: "FINALIZED", deadlineAt: "2026-08-27T00:00:00.000Z", startedAt: NOW.toISOString(), finalizedAt: NOW.toISOString() };
  await repository.persistMutation({ method: "finalizeSettlement", idempotencyKey: "db-finalize", commandHash: HASH_A, input: { request: { certificate, asset: { currentOwnerCommitment: HASH_C, encumbranceStatus: "CLEAR" }, warehouse: { assetId: "asset-db", warehouseId: "warehouse-db", warehouseReceiptHash: HASH_A, warehouseStatus: "IN_CUSTODY", holderCommitment: HASH_C, encumbranceStatus: "CLEAR", observedAt: NOW.toISOString() }, evidenceSources: { certificate: "certificate-authority", warehouse: "warehouse-authority" }, evidenceVersion: 3 } }, result: record, auditEvents: [], outboxEvents: [], stateSnapshot: { state: { testOnly: true }, stateHash: HASH_B } });
  const supersede = statements.findIndex(({ sql }) => sql.includes("UPDATE certificate_versions SET certificate_status='SUPERSEDED'"));
  const replacement = statements.findIndex(({ sql }) => sql.includes("INSERT INTO certificate_versions"));
  assert.equal(supersede >= 0, true);
  assert.equal(replacement > supersede, true);
  assert.deepEqual(statements[supersede].parameters, [NOW.toISOString(), "asset-db", HASH_B]);
  assert.equal(statements[replacement].parameters.at(-1), "certificate-authority");
  assert.equal(statements.find(({ sql }) => sql.startsWith("UPDATE assets SET current_certificate_hash=")).parameters[2], HASH_C);
  const warehouseProjection = statements.find(({ sql }) => sql.startsWith("INSERT INTO warehouse_records"));
  assert.equal(warehouseProjection.parameters[4], HASH_C);
  assert.equal(warehouseProjection.parameters.at(-1), "warehouse-authority");
});

test("MySQL finalization rolls back when the current certificate cannot be superseded", async () => {
  let rolledBack = false;
  let executeCount = 0;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() { rolledBack = true; },
    release() {},
    async execute(sql, parameters = []) {
      executeCount += 1;
      if (sql.includes("UPDATE certificate_versions SET certificate_status='SUPERSEDED'")) return [{ affectedRows: 0 }, []];
      return [[], []];
    },
  };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  const certificate = { assetId: "asset-db", tokenId: "1", certificateVersion: 2, certificateHash: HASH_C, previousCertificateHash: HASH_B, wenbaoChangeRef: "change-db", warehouseReceiptHash: HASH_A, effectiveAt: NOW.toISOString(), status: "CURRENT" };
  const record = { settlementId: "settlement-final-conflict", assetId: "asset-db", token: { chainId: "560048", contract: "test-only", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", snapshotHash: HASH_A, externalExecutionRef: "execution", oldCertificateHash: HASH_B, newCertificateHash: HASH_C, registryChangeRef: "change-db", status: "FINALIZED", deadlineAt: "2026-08-27T00:00:00.000Z", startedAt: NOW.toISOString(), finalizedAt: NOW.toISOString() };
  await assert.rejects(() => repository.persistMutation({ method: "finalizeSettlement", idempotencyKey: "db-finalize-conflict", commandHash: HASH_A, input: { request: { certificate, certificateSourceId: "certificate-authority", newOwnerCommitment: HASH_C, evidenceVersion: 3 } }, result: record, auditEvents: [], outboxEvents: [], stateSnapshot: { state: { testOnly: true }, stateHash: HASH_B } }), /CERTIFICATE_SUPERSEDE_CONFLICT/);
  assert.equal(rolledBack, true);
  assert.equal(executeCount, 3);
});

test("command journal deduplicates concurrent async operations and clears failed pending records", async () => {
  const journal = new CommandJournal();
  assert.throws(() => journal.execute("i".repeat(129), { type: "oversized" }, () => "never"), /COMMAND_INVALID/);
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
  assert.deepEqual(await adapter.fetchByFixedReference("registry/assets/001"), { ok: true });
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

test("publisher failures are counted only after a real publish attempt", async () => {
  const outbox = new Outbox();
  const event = outbox.enqueue({ eventType: "test", subjectId: "asset-order", payloadHash: HASH_A, createdAt: NOW.toISOString() });
  const order = [];
  const dispatcher = new OutboxDispatcher({
    outbox,
    publisher: { async publish() { order.push("publish"); throw new Error("offline"); } },
    deliveryStore: { async recordOutboxAttempt(_eventId, attempts) { order.push(`attempt:${attempts}`); } },
    clock: () => NOW,
  });
  assert.deepEqual(await dispatcher.drain(), [{ eventId: event.eventId, status: "RETRY" }]);
  assert.deepEqual(order, ["publish", "attempt:1"]);
  assert.equal(outbox.list()[0].attempts, 1);
});

test("delivery-state retry scheduling lets newer active events progress", async () => {
  const outbox = new Outbox();
  const first = outbox.enqueue({ eventType: "first", subjectId: "asset-first", payloadHash: HASH_A, createdAt: "2026-08-24T00:00:00.000Z" });
  const second = outbox.enqueue({ eventType: "second", subjectId: "asset-second", payloadHash: HASH_B, createdAt: "2026-08-24T00:00:01.000Z" });
  const published = [];
  const dispatcher = new OutboxDispatcher({
    outbox,
    publisher: { async publish(event) { published.push(event.eventId); } },
    deliveryStore: {
      async markOutboxPublished(eventId) { if (eventId === first.eventId) throw new Error("state unavailable"); },
      async recordOutboxDeliveryStateAttempt() {},
    },
    clock: () => NOW,
  });
  assert.equal((await dispatcher.drain(1))[0].status, "DELIVERY_STATE_RETRY");
  assert.equal((await dispatcher.drain(1))[0].status, "PUBLISHED");
  assert.deepEqual(published, [first.eventId, second.eventId]);
  assert.equal(outbox.list()[0].deliveryStateAttempts, 1);
});
test("dead-letter retry scheduling is fair across exhausted events", async () => {
  const outbox = new Outbox();
  const first = outbox.enqueue({ eventType: "first", subjectId: "asset-first", payloadHash: HASH_A, createdAt: "2026-08-24T00:00:00.000Z" });
  const second = outbox.enqueue({ eventType: "second", subjectId: "asset-second", payloadHash: HASH_B, createdAt: "2026-08-24T00:00:01.000Z" });
  for (const event of [first, second]) for (let attempt = 0; attempt < 5; attempt += 1) outbox.recordAttempt(event.eventId);
  const attempted = [];
  const dispatcher = new OutboxDispatcher({ outbox, maxAttempts: 5, publisher: { async publishDeadLetter(event) { attempted.push(event.eventId); throw new Error("offline"); } }, clock: () => NOW });
  assert.equal((await dispatcher.drain(1))[0].status, "DEAD_LETTER_RETRY");
  assert.equal((await dispatcher.drain(1))[0].status, "DEAD_LETTER_RETRY");
  assert.deepEqual(attempted, [first.eventId, second.eventId]);
  assert.deepEqual(outbox.list().map(({ deadLetterAttempts }) => deadLetterAttempts), [1, 1]);
});

test("MySQL snapshot restore overlays independently committed outbox delivery state", async () => {
  const event = { eventId: "00000000-0000-4000-8000-000000000001", eventType: "test", subjectId: "asset", payloadHash: HASH_A, createdAt: NOW.toISOString(), attempts: 0, publishedAt: null, deadLetteredAt: null, durable: true };
  const storedState = { schemaVersion: "giraffe-production-state.v1", components: { outbox: { events: [event] } }, dualControl: { actions: [] } };
  const pool = {
    async getConnection() { throw new Error("not used"); },
    async execute(sql, parameters = []) {
      if (sql.includes("production_state_snapshots")) return [[{ state_json: JSON.stringify(storedState), state_hash: evidenceHash(storedState) }]];
      if (sql.includes("outbox_events")) return [[{ event_id: event.eventId, attempts: 5, published_at: null, dead_lettered_at: "2026-08-24T00:01:00.000Z", dead_letter_attempts: 3, dead_letter_state_attempts: 4, delivery_state_attempts: 2 }]];
      throw new Error("unexpected query");
    },
  };
  const restored = await new MySqlOracleRepository({ pool }).loadStateSnapshot();
  assert.equal(restored.state.components.outbox.events[0].attempts, 5);
  assert.equal(restored.state.components.outbox.events[0].deadLetterAttempts, 3);
  assert.equal(restored.state.components.outbox.events[0].deadLetterStateAttempts, 4);
  assert.equal(restored.state.components.outbox.events[0].deadLetteredAt, "2026-08-24T00:01:00.000Z");
  assert.equal(restored.stateHash, evidenceHash(restored.state));
});



test("an initial certificate rejects a non-null predecessor before runtime mutation", () => {
  const { runtime, control } = controlFixture();
  const bundle = evidenceBundle("asset-initial-predecessor");
  bundle.certificate = { ...bundle.certificate, previousCertificateHash: HASH_A };
  assert.throws(() => control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "initial-predecessor", ...bundle, evidenceVersion: 1 }), /CERTIFICATE_INITIAL_VERSION_INVALID/);
  assert.equal(runtime.recordStore.getAsset("asset-initial-predecessor"), null);
});

test("MySQL outbox delivery updates reject missing or stale rows", async () => {
  let rolledBack = 0;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() { rolledBack += 1; },
    release() {},
    async execute() { return [{ affectedRows: 0 }, []]; },
  };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  const calls = [
    () => repository.recordOutboxAttempt("event", 1),
    () => repository.recordOutboxDeliveryStateAttempt("event", 1),
    () => repository.recordOutboxDeadLetterAttempt("event", 1),
    () => repository.recordOutboxDeadLetterStateAttempt("event", 1),
    () => repository.markOutboxPublished("event", NOW.toISOString()),
    () => repository.markOutboxDeadLettered("event", NOW.toISOString()),
  ];
  for (const call of calls) await assert.rejects(call, /OUTBOX_DELIVERY_UPDATE_CONFLICT/);
  assert.equal(rolledBack, calls.length);
});

test("dead-letter acknowledgement failures rotate independently across exhausted events", async () => {
  const outbox = new Outbox();
  const first = outbox.enqueue({ eventType: "first", subjectId: "asset-first-ack", payloadHash: HASH_A, createdAt: "2026-08-24T00:00:00.000Z" });
  const second = outbox.enqueue({ eventType: "second", subjectId: "asset-second-ack", payloadHash: HASH_B, createdAt: "2026-08-24T00:00:01.000Z" });
  for (const event of [first, second]) for (let attempt = 0; attempt < 5; attempt += 1) outbox.recordAttempt(event.eventId);
  const attempted = [];
  const dispatcher = new OutboxDispatcher({
    outbox,
    maxAttempts: 5,
    publisher: { async publishDeadLetter(event) { attempted.push(event.eventId); } },
    deliveryStore: {
      async markOutboxDeadLettered(eventId) { if (eventId === first.eventId) throw new Error("state unavailable"); },
      async recordOutboxDeadLetterStateAttempt() {},
    },
    clock: () => NOW,
  });
  assert.equal((await dispatcher.drain(1))[0].status, "DEAD_LETTER_STATE_RETRY");
  assert.equal((await dispatcher.drain(1))[0].status, "DEAD_LETTERED");
  assert.deepEqual(attempted, [first.eventId, second.eventId]);
  assert.deepEqual(outbox.list().map(({ deadLetterStateAttempts }) => deadLetterStateAttempts), [1, 0]);
});

test("MySQL settlement transitions atomically project the runtime asset status", async () => {
  const statements = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parameters = []) {
      statements.push({ sql, parameters });
      if (sql.startsWith("UPDATE assets SET oracle_status=")) return [{ affectedRows: 1 }, []];
      return [[], []];
    },
  };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  const cases = [
    ["beginSettlement", "PENDING", "startedAt", "TRANSFER_PENDING"],
    ["cancelSettlement", "CANCELLED", "cancelledAt", "REVIEW_REQUIRED"],
    ["disputeSettlement", "DISPUTED", "disputedAt", "REVIEW_REQUIRED"],
    ["timeoutSettlement", "TIMED_OUT", "timedOutAt", "REVIEW_REQUIRED"],
  ];
  for (const [method, status, timestampField, expectedStatus] of cases) {
    const timestamp = NOW.toISOString();
    const record = { settlementId: "settlement-" + method, assetId: "asset-" + method, token: { chainId: "560048", contract: "test-only", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", snapshotHash: HASH_A, externalExecutionRef: "execution", oldCertificateHash: HASH_B, status, deadlineAt: "2026-08-30T00:00:00.000Z", startedAt: timestamp, [timestampField]: timestamp };
    await repository.persistMutation({ method, idempotencyKey: "project-" + method, commandHash: HASH_C, input: { request: { evidenceVersion: 2 } }, result: record, auditEvents: [], outboxEvents: [], stateSnapshot: { state: { testOnly: true }, stateHash: HASH_A } });
    const projection = statements.filter(({ sql }) => sql.startsWith("UPDATE assets SET oracle_status=")).at(-1);
    assert.deepEqual(projection.parameters, [expectedStatus, 2, timestamp, record.assetId]);
  }
});
test("MySQL outbox updates accept only verified idempotent persisted state", async () => {
  const publishedAt = NOW.toISOString();
  const rowsBySelect = {
    attempts: { attempts: 3, published_at: null, dead_lettered_at: null },
    delivery_state_attempts: { delivery_state_attempts: 2, published_at: null, dead_lettered_at: null },
    dead_letter_attempts: { dead_letter_attempts: 4, published_at: null, dead_lettered_at: null },
    dead_letter_state_attempts: { dead_letter_state_attempts: 5, published_at: null, dead_lettered_at: null },
    published_at: { published_at: publishedAt, dead_lettered_at: null },
    dead_lettered_at: { published_at: null, dead_lettered_at: publishedAt },
  };
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, parameters = []) {
      if (sql.startsWith("UPDATE")) return [{ affectedRows: 0 }, []];
      const field = sql.startsWith("SELECT published_at, dead_lettered_at") ? (parameters[0] === "dead-event" ? "dead_lettered_at" : "published_at") : Object.keys(rowsBySelect).find((candidate) => sql.startsWith("SELECT " + candidate));
      return [[rowsBySelect[field]], []];
    },
  };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  assert.equal((await repository.recordOutboxAttempt("event", 3)).idempotent, true);
  assert.equal((await repository.recordOutboxDeliveryStateAttempt("event", 2)).idempotent, true);
  assert.equal((await repository.recordOutboxDeadLetterAttempt("event", 4)).idempotent, true);
  assert.equal((await repository.recordOutboxDeadLetterStateAttempt("event", 5)).idempotent, true);
  assert.equal((await repository.markOutboxPublished("event", publishedAt)).idempotent, true);
  assert.equal((await repository.markOutboxDeadLettered("dead-event", publishedAt)).idempotent, true);
});

test("failed durable attempt counters rotate both active and dead-letter lanes in memory", async () => {
  const activeOutbox = new Outbox();
  const activeFirst = activeOutbox.enqueue({ eventType: "first", subjectId: "active-first", payloadHash: HASH_A, createdAt: "2026-08-24T00:00:00.000Z" });
  const activeSecond = activeOutbox.enqueue({ eventType: "second", subjectId: "active-second", payloadHash: HASH_B, createdAt: "2026-08-24T00:00:01.000Z" });
  const activeAttempts = [];
  const activeDispatcher = new OutboxDispatcher({
    outbox: activeOutbox,
    publisher: { async publish(event) { activeAttempts.push(event.eventId); throw new Error("offline"); } },
    deliveryStore: { async recordOutboxAttempt() { throw new Error("db unavailable"); }, async recordOutboxDeliveryStateAttempt() { throw new Error("db unavailable"); } },
  });
  assert.equal((await activeDispatcher.drain(1))[0].status, "DELIVERY_STATE_RETRY");
  assert.equal((await activeDispatcher.drain(1))[0].status, "DELIVERY_STATE_RETRY");
  assert.deepEqual(activeAttempts, [activeFirst.eventId, activeSecond.eventId]);

  const deadOutbox = new Outbox();
  const deadFirst = deadOutbox.enqueue({ eventType: "first", subjectId: "dead-first", payloadHash: HASH_A, createdAt: "2026-08-24T00:00:00.000Z" });
  const deadSecond = deadOutbox.enqueue({ eventType: "second", subjectId: "dead-second", payloadHash: HASH_B, createdAt: "2026-08-24T00:00:01.000Z" });
  for (const event of [deadFirst, deadSecond]) for (let attempt = 0; attempt < 5; attempt += 1) deadOutbox.recordAttempt(event.eventId);
  const deadAttempts = [];
  const deadDispatcher = new OutboxDispatcher({
    outbox: deadOutbox,
    maxAttempts: 5,
    publisher: { async publishDeadLetter(event) { deadAttempts.push(event.eventId); throw new Error("offline"); } },
    deliveryStore: { async recordOutboxDeadLetterAttempt() { throw new Error("db unavailable"); }, async recordOutboxDeadLetterStateAttempt() { throw new Error("db unavailable"); } },
  });
  assert.equal((await deadDispatcher.drain(1))[0].status, "DEAD_LETTER_STATE_RETRY");
  assert.equal((await deadDispatcher.drain(1))[0].status, "DEAD_LETTER_STATE_RETRY");
  assert.deepEqual(deadAttempts, [deadFirst.eventId, deadSecond.eventId]);
});
test("out-of-range MySQL timestamps are rejected before asset runtime mutation", () => {
  const { runtime, control } = controlFixture();
  const bundle = evidenceBundle("asset-time-range");
  bundle.asset.updatedAt = "2040-01-01T00:00:00Z";
  bundle.certificate.effectiveAt = "2040-01-01T00:00:00Z";
  bundle.warehouse.observedAt = "2040-01-01T00:00:00Z";
  assert.throws(() => control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "time-range", ...bundle, evidenceVersion: 1 }), /PAYLOAD_FIELD_PERSISTENCE_RANGE_INVALID/);
  assert.equal(runtime.recordStore.getAsset("asset-time-range"), null);
  assert.equal(runtime.stateEngine.current("asset-time-range"), "NOT_VERIFIED");
});

test("MySQL persists implicit settlement revocations in the command transaction", async () => {
  const statements = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, parameters = []) {
      statements.push({ sql, parameters });
      if (sql.startsWith("UPDATE assets SET oracle_status=")) return [{ affectedRows: 1 }, []];
      return [[], []];
    },
  };
  const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
  const revokedAt = NOW.toISOString();
  const revocation = { attestationId: "00000000-0000-4000-8000-000000000099", reasonHash: HASH_A, authorityId: "oracle-a", revokedAt };
  const record = { settlementId: "settlement-revoke-db", assetId: "asset-revoke-db", token: { chainId: "560048", contract: "test-only", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", snapshotHash: HASH_A, externalExecutionRef: "execution", oldCertificateHash: HASH_B, status: "PENDING", deadlineAt: "2026-08-30T00:00:00.000Z", startedAt: revokedAt };
  await repository.persistMutation({ method: "beginSettlement", idempotencyKey: "settlement-revoke-db", commandHash: HASH_C, input: { request: { evidenceVersion: 2 } }, result: record, auditEvents: [], outboxEvents: [], revocations: [revocation], stateSnapshot: { state: { testOnly: true }, stateHash: HASH_B } });
  const insertion = statements.find(({ sql }) => sql.startsWith("INSERT INTO revocations"));
  assert.deepEqual(insertion.parameters, [revocation.attestationId, HASH_A, "oracle-a", revokedAt]);
});
test("certificate supersededAt is range-bounded and forbidden on CURRENT evidence before mutation", () => {
  const { runtime, control } = controlFixture();
  const outOfRange = evidenceBundle("asset-superseded-range");
  outOfRange.certificate.supersededAt = "2040-01-01T00:00:00Z";
  assert.throws(() => runtime.schemaRegistry.validate("certificate-record.v1", outOfRange.certificate), /PAYLOAD_FIELD_PERSISTENCE_RANGE_INVALID:supersededAt/);
  const current = evidenceBundle("asset-current-superseded");
  current.certificate.supersededAt = NOW.toISOString();
  assert.throws(() => control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "current-superseded", ...current, evidenceVersion: 1 }), /CERTIFICATE_CURRENT_SUPERSEDED_AT_INVALID/);
  assert.equal(runtime.recordStore.getAsset("asset-current-superseded"), null);
});

test("MySQL asset re-verification updates mutable classification and warehouse projections", async () => {
  let upsert = null;
  const connection = {
    async execute(sql, parameters = []) {
      if (sql.startsWith("SELECT asset_id")) return [[], []];
      if (sql.includes("INSERT INTO assets")) upsert = { sql, parameters };
      return [{ affectedRows: 1 }, []];
    },
  };
  const repository = new MySqlOracleRepository({ pool: { getConnection() {} } });
  await repository.upsertAsset(connection, { assetId: "asset-mutable", assetFingerprintHash: HASH_A, wenbaoRegistryRef: "registry", classificationCode: "CERAMIC", transferEligibility: "VALID", warehouseId: "warehouse-new", warehouseReceiptHash: HASH_B, currentCertificateHash: HASH_C, currentCertificateVersion: 2, currentOwnerCommitment: HASH_A, encumbranceStatus: "CLEAR", oracleStatus: "VALID", evidenceVersion: 2, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), sourceAuthority: "registry" });
  assert.match(upsert.sql, /classification_code = VALUES\(classification_code\)/);
  assert.match(upsert.sql, /warehouse_id = VALUES\(warehouse_id\)/);
  assert.equal(upsert.parameters[3], "CERAMIC");
  assert.equal(upsert.parameters[5], "warehouse-new");
});

test("MySQL source disable rejects an absent relational projection and accepts verified inactive state", async () => {
  const run = async (verificationRows) => {
    const events = [];
    const connection = {
      async beginTransaction() { events.push("begin"); },
      async commit() { events.push("commit"); },
      async rollback() { events.push("rollback"); },
      release() { events.push("release"); },
      async execute(sql) {
        if (sql.startsWith("UPDATE source_authorities")) return [{ affectedRows: 0 }, []];
        if (sql.startsWith("SELECT active FROM source_authorities")) return [verificationRows, []];
        return [[], []];
      },
    };
    const repository = new MySqlOracleRepository({ pool: { async getConnection() { return connection; } } });
    const operation = repository.persistMutation({ method: "executeSourceDisable", idempotencyKey: "disable-source", commandHash: HASH_A, input: { sourceId: "registry" }, result: { active: false }, auditEvents: [], outboxEvents: [], stateSnapshot: { state: { testOnly: true }, stateHash: HASH_B } });
    return { operation, events };
  };
  const missing = await run([]);
  await assert.rejects(missing.operation, /SOURCE_PROJECTION_CONFLICT/);
  assert.deepEqual(missing.events, ["begin", "rollback", "release"]);
  const inactive = await run([{ active: 0 }]);
  assert.equal((await inactive.operation).persisted, true);
  assert.deepEqual(inactive.events, ["begin", "commit", "release"]);
});
test("token binding must match the current certificate token identifier", () => {
  const { control, runtime } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-token-certificate", ...evidenceBundle("asset-token-certificate"), evidenceVersion: 1 });
  assert.throws(() => control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-token-certificate", binding: { assetId: "asset-token-certificate", chainId: "560048", contract: "test-only", tokenId: "2" } }), /TOKEN_BINDING_CERTIFICATE_MISMATCH/);
  assert.equal(runtime.tokenIndex.byAsset("asset-token-certificate"), null);
});

test("settlement transitions update the in-memory asset status projection", () => {
  const { control, runtime } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-status-projection", ...evidenceBundle("asset-status-projection"), evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-status-projection", binding: { assetId: "asset-status-projection", chainId: "test-chain", contract: "contract-status-projection", tokenId: "1" } });
  control.beginSettlement({ actorId: "oracle-a", idempotencyKey: "begin-status-projection", request: { settlementId: "settlement-status-projection", assetId: "asset-status-projection", token: { chainId: "test-chain", contract: "contract-status-projection", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", externalExecutionRef: "external", oldCertificateHash: HASH_B, warehouseReceiptHash: HASH_C, evidenceVersion: 2 } });
  assert.equal(runtime.recordStore.getAsset("asset-status-projection").oracleStatus, "TRANSFER_PENDING");
  assert.equal(runtime.recordStore.getAsset("asset-status-projection").evidenceVersion, 2);
  control.cancelSettlement({ actorId: "oracle-a", idempotencyKey: "cancel-status-projection", request: { settlementId: "settlement-status-projection", reasonHash: HASH_A, evidenceVersion: 3 } });
  assert.equal(runtime.recordStore.getAsset("asset-status-projection").oracleStatus, "REVIEW_REQUIRED");
  assert.equal(runtime.recordStore.getAsset("asset-status-projection").evidenceVersion, 3);
});
test("re-verification cannot change the token identifier of an existing binding", () => {
  const { control, runtime } = controlFixture();
  const initial = evidenceBundle("asset-reverify-token");
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-reverify-token-1", ...initial, evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-reverify-token", binding: { assetId: "asset-reverify-token", chainId: "560048", contract: "test-only", tokenId: "1" } });
  runtime.stateEngine.transition({ subjectId: "asset-reverify-token", to: "TRANSFER_PENDING", reasonHash: HASH_A, evidenceVersion: 2, occurredAt: NOW.toISOString() });
  runtime.stateEngine.transition({ subjectId: "asset-reverify-token", to: "REVIEW_REQUIRED", reasonHash: HASH_B, evidenceVersion: 3, occurredAt: NOW.toISOString() });
  const replacement = evidenceBundle("asset-reverify-token");
  replacement.asset.currentCertificateHash = HASH_A;
  replacement.asset.currentCertificateVersion = 2;
  replacement.certificate = { ...replacement.certificate, tokenId: "2", certificateHash: HASH_A, certificateVersion: 2, previousCertificateHash: HASH_B, wenbaoChangeRef: "change-token" };
  assert.throws(() => control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-reverify-token-2", ...replacement, evidenceVersion: 4 }), /CERTIFICATE_TOKEN_BINDING_MISMATCH/);
  assert.equal(runtime.recordStore.currentCertificate("asset-reverify-token").tokenId, "1");
  assert.equal(runtime.tokenIndex.byAsset("asset-reverify-token").tokenId, "1");
});
test("settlement finalization rejects a CURRENT certificate carrying supersededAt", () => {
  const { runtime, control } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-finalize-superseded", ...evidenceBundle("asset-finalize-superseded"), evidenceVersion: 1 });
  control.bindToken({ actorId: "oracle-a", idempotencyKey: "bind-finalize-superseded", binding: { assetId: "asset-finalize-superseded", chainId: "test-chain", contract: "contract-finalize-superseded", tokenId: "1" } });
  const pending = control.beginSettlement({ actorId: "oracle-a", idempotencyKey: "begin-finalize-superseded", request: { settlementId: "settlement-finalize-superseded", assetId: "asset-finalize-superseded", token: { chainId: "test-chain", contract: "contract-finalize-superseded", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", externalExecutionRef: "external", oldCertificateHash: HASH_B, warehouseReceiptHash: HASH_C, evidenceVersion: 2 } }).result;
  const certificate = { assetId: "asset-finalize-superseded", tokenId: "1", certificateVersion: 2, certificateHash: HASH_A, previousCertificateHash: HASH_B, wenbaoChangeRef: "change-finalize-superseded", warehouseReceiptHash: HASH_C, effectiveAt: NOW.toISOString(), supersededAt: NOW.toISOString(), status: "CURRENT" };
  assert.throws(() => control.finalizeSettlement({ actorId: "oracle-a", idempotencyKey: "finalize-superseded-current", request: { settlementId: pending.settlementId, certificate, certificateSourceId: "synthetic-certificates", certificateSourceRecordHash: evidenceHash(certificate), registryChangeRef: "change-finalize-superseded", snapshotHash: pending.snapshotHash, warehouseConfirmed: true, ownerBindingConfirmed: true, newOwnerCommitment: HASH_A, evidenceVersion: 3 } }), /CERTIFICATE_CURRENT_SUPERSEDED_AT_INVALID/);
  assert.equal(runtime.settlements.get(pending.settlementId).status, "PENDING");
  assert.equal(runtime.recordStore.currentCertificate("asset-finalize-superseded").certificateVersion, 1);
});