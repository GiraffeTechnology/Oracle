import assert from "node:assert/strict";
import test from "node:test";

import { OracleStatus } from "../src/domain/oracle-status.js";
import { RecordStore } from "../src/domain/record-store.js";
import { StateEngine } from "../src/domain/state-engine.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const NOW = new Date("2026-08-25T00:00:00.000Z");

function preparedRuntime(assetId = "asset-1") {
  const runtime = createSyntheticRuntime({ clock: () => NOW });
  runtime.recordStore.putAsset({ assetId, assetFingerprintHash: A });
  runtime.recordStore.appendCertificate({ assetId, certificateHash: B, certificateVersion: 1 });
  runtime.recordStore.putWarehouse({ assetId, warehouseReceiptHash: C });
  runtime.tokenIndex.bind({ assetId, chainId: "test-chain", contract: "test-contract", tokenId: "1" });
  runtime.stateEngine.transition({ subjectId: assetId, to: OracleStatus.VALID, reasonHash: A, evidenceVersion: 1, occurredAt: NOW.toISOString() });
  return runtime;
}

function begin(runtime, overrides = {}) {
  return runtime.settlements.begin({
    settlementId: "settlement-1",
    assetId: "asset-1",
    token: { chainId: "test-chain", contract: "test-contract", tokenId: "1" },
    sellerWallet: "seller",
    buyerWallet: "buyer",
    externalExecutionRef: "external-1",
    snapshotHash: D,
    oldCertificateHash: B,
    warehouseReceiptHash: C,
    deadlineAt: "2026-08-26T00:00:00.000Z",
    actorId: "operator",
    evidenceVersion: 2,
    ...overrides,
  });
}

test("state transitions reject omitted NaN fractional and non-positive evidence versions", () => {
  const states = new StateEngine();
  for (const evidenceVersion of [undefined, Number.NaN, 1.5, 0, -1]) {
    assert.throws(() => states.transition({ subjectId: "asset", to: OracleStatus.VALID, reasonHash: A, evidenceVersion, occurredAt: NOW.toISOString() }), /EVIDENCE_VERSION_INVALID/);
  }
});

test("settlement rejects missing and malformed deadlines", () => {
  for (const deadlineAt of [undefined, "not-a-date"]) {
    const runtime = preparedRuntime();
    assert.throws(() => begin(runtime, { deadlineAt }), /SETTLEMENT_DEADLINE_INVALID/);
    assert.equal(runtime.stateEngine.current("asset-1"), OracleStatus.VALID);
  }
});

test("settlement certificate must belong to the settlement asset", () => {
  const runtime = preparedRuntime();
  begin(runtime);
  assert.throws(() => runtime.settlements.finalize({
    settlementId: "settlement-1",
    certificate: { assetId: "asset-2", certificateHash: A, previousCertificateHash: B, certificateVersion: 2, wenbaoChangeRef: "change-1", warehouseReceiptHash: C },
    registryChangeRef: "change-1",
    warehouseConfirmed: true,
    ownerBindingConfirmed: true,
    actorId: "registry",
    evidenceVersion: 3,
  }), /SETTLEMENT_CERTIFICATE_ASSET_MISMATCH/);
  assert.equal(runtime.recordStore.certificateHistory("asset-2").length, 0);
  assert.equal(runtime.settlements.get("settlement-1").status, "PENDING");
});

test("failed finalization cannot append a certificate before state validation", () => {
  const runtime = preparedRuntime();
  begin(runtime);
  const before = runtime.recordStore.certificateHistory("asset-1");
  assert.throws(() => runtime.settlements.finalize({
    settlementId: "settlement-1",
    certificate: { assetId: "asset-1", certificateHash: A, previousCertificateHash: B, certificateVersion: 2, wenbaoChangeRef: "change-1", warehouseReceiptHash: C },
    registryChangeRef: "change-1",
    warehouseConfirmed: true,
    ownerBindingConfirmed: true,
    actorId: "registry",
    evidenceVersion: 2,
  }), /EVIDENCE_VERSION_NOT_INCREASING/);
  assert.deepEqual(runtime.recordStore.certificateHistory("asset-1"), before);
  assert.equal(runtime.settlements.get("settlement-1").status, "PENDING");
});

test("settlement begin revokes prior transfer eligibility but not unrelated attestations", () => {
  const runtime = preparedRuntime();
  const common = { assetId: "asset-1", chainId: "test-chain", contract: "test-contract", tokenId: "1" };
  const transfer = runtime.attestations.issue({ subject: { ...common, purpose: "transfer-eligibility" }, factType: "TRANSFER_STATUS", factValue: "VALID", sourceAuthority: "synthetic-registry", sourceRecordHash: A, validForSeconds: 60, nonce: "transfer-before" });
  const provenance = runtime.attestations.issue({ subject: { ...common, purpose: "provenance" }, factType: "PROVENANCE", factValue: "VALID", sourceAuthority: "synthetic-registry", sourceRecordHash: A, validForSeconds: 60, nonce: "provenance-before" });
  begin(runtime);
  assert.deepEqual(runtime.attestations.verify(transfer), { valid: false, errorCode: "REVOKED" });
  assert.deepEqual(runtime.attestations.verify(provenance), { valid: true, errorCode: null });
});

test("asset fingerprints are globally unique across asset identifiers", () => {
  const store = new RecordStore();
  store.putAsset({ assetId: "asset-1", assetFingerprintHash: A });
  assert.throws(() => store.putAsset({ assetId: "asset-2", assetFingerprintHash: A }), /ASSET_FINGERPRINT_ALREADY_CLAIMED/);
});
