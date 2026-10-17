import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleProductionApplication } from "../src/config/production-assembly.js";
import { loadPinnedDeploymentModule } from "../src/config/production-bootstrap.js";
import { loadL2DeploymentProfile } from "../src/config/deployment-profile.js";
import { loadProtocolProfile } from "../src/protocol/protocol-profile.js";
import { evidenceHash } from "../src/domain/canonical-json.js";
import { SignerSetPolicy } from "../src/domain/signer-set-policy.js";
import { RevocationRegistry } from "../src/domain/revocation-registry.js";
import { AttestationService } from "../src/domain/attestation-service.js";
import { DurableOracleControlPlane } from "../src/services/durable-control-plane.js";
import { captureProductionState, restoreProductionState } from "../src/services/production-state.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";
import { DualControlQueue } from "../src/services/dual-control.js";
import { createApp } from "../src/app.js";
import { SourceRegistry } from "../src/domain/source-registry.js";

const NOW = new Date("2026-08-27T00:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function records(assetId) {
  return {
    asset: { assetId, assetFingerprintHash: HASH_A, wenbaoRegistryRef: "registry-001", transferEligibility: "VALID", warehouseId: "warehouse-001", warehouseReceiptHash: HASH_C, currentCertificateHash: HASH_B, currentCertificateVersion: 1, currentOwnerCommitment: HASH_C, encumbranceStatus: "CLEAR", oracleStatus: "VALID", updatedAt: NOW.toISOString() },
    certificate: { assetId, tokenId: "1", certificateVersion: 1, certificateHash: HASH_B, previousCertificateHash: null, wenbaoChangeRef: "initial-001", warehouseReceiptHash: HASH_C, effectiveAt: NOW.toISOString(), status: "CURRENT" },
    warehouse: { assetId, warehouseId: "warehouse-001", warehouseReceiptHash: HASH_C, warehouseStatus: "IN_CUSTODY", encumbranceStatus: "CLEAR", observedAt: NOW.toISOString() },
  };
}

async function productionFixture({ failPersistence = false, initialSnapshot = null, persistenceGate = null, omitSignerPolicy = false, rejectAlerts = false, rejectAlertCodes = [], rejectDeadLetterSubjects = [], externalWritesEnabled = true, clock = () => NOW } = {}) {
  const [l2Profile, l3Profile] = await Promise.all([loadL2DeploymentProfile("config/l2.production.json"), loadProtocolProfile("config/l3.protocol.wd-0.1.1.json")]);
  const evidence = records("asset-production");
  const sourceById = new Map(l2Profile.sources.map((source) => [source.sourceId, source]));
  const recordBySource = { "authoritative-registry": evidence.asset, "authoritative-certificate": evidence.certificate, "authoritative-warehouse": evidence.warehouse };
  const unavailableSources = new Set();
  const persisted = [];
  const published = [];
  const deadLetters = [];
  const deliveryUpdates = [];
  const alerts = [];
  const alertState = { reject: rejectAlerts === true, rejectCodes: new Set(rejectAlertCodes) };
  let adminIdentity = { actorId: "production-operator", roles: ["ORACLE_OPERATOR"] };
  let authenticationFails = false;
  let commandReads = 0;
  let commandReadFails = false;
  let sourceFetches = 0;
  let markPersistStarted;
  const persistStarted = new Promise((resolve) => { markPersistStarted = resolve; });
  const commands = new Map();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const repository = {
    async loadStateSnapshot() { return initialSnapshot; },
    async getCommand(key) { commandReads += 1; if (commandReadFails) throw new Error("synthetic-private-read-detail"); return commands.get(key) ?? null; },
    async recordOutboxAttempt(eventId, attempts) { deliveryUpdates.push({ type: "attempt", eventId, attempts }); },
    async recordOutboxDeliveryStateAttempt(eventId, attempts) { deliveryUpdates.push({ type: "delivery-state-attempt", eventId, attempts }); },
    async recordOutboxDeadLetterAttempt(eventId, attempts) { deliveryUpdates.push({ type: "dead-letter-attempt", eventId, attempts }); },
    async recordOutboxDeadLetterStateAttempt(eventId, attempts) { deliveryUpdates.push({ type: "dead-letter-state-attempt", eventId, attempts }); },
    async markOutboxPublished(eventId, publishedAt) { deliveryUpdates.push({ type: "published", eventId, publishedAt }); },
    async markOutboxDeadLettered(eventId, deadLetteredAt) { deliveryUpdates.push({ type: "dead-lettered", eventId, deadLetteredAt }); },
    async persistMutation(value) {
      markPersistStarted();
      if (persistenceGate) await persistenceGate;
      if (failPersistence) throw new Error("db unavailable");
      persisted.push(value);
      commands.set(value.idempotencyKey, { commandHash: value.commandHash, status: "COMPLETED", result: value.result });
    },
    async persistRecoveryState(value) {
      if (failPersistence) throw new Error("db unavailable");
      persisted.push(value);
      commands.set(value.idempotencyKey, { commandHash: value.commandHash, status: "PENDING", result: null });
    },
  };
  const resolver = {
    async resolve(reference, kind) {
      if (kind === "repository") return repository;
      if (kind === "signer") return { signerSetId: "production-test-signers", ...(omitSignerPolicy ? {} : { signerPolicy: new SignerSetPolicy({ signerSetId: "production-test-signers", threshold: 1, signers: ["production-test-signer"], environment: "production" }) }), signBytes: (bytes) => sign(null, bytes, privateKey), verifyBytes: (bytes, signature) => verify(null, bytes, publicKey, signature), verifyHistoricalBytes: (signerSetId, bytes, signature) => signerSetId === "production-test-signers" && verify(null, bytes, publicKey, signature), async rotate() { throw new Error("NOT_USED"); }, async reconcile() { throw new Error("NOT_USED"); }, async activateRuntime() { throw new Error("NOT_USED"); } };
      if (kind === "source") {
        const source = l2Profile.sources.find(({ transportRef }) => transportRef === reference);
        return { async fetchByFixedReference() { sourceFetches += 1; if (unavailableSources.has(source.sourceId)) throw new Error("SOURCE_UNAVAILABLE"); const record = recordBySource[source.sourceId]; return { authenticated: true, sourceId: source.sourceId, schemaVersion: source.schemaVersions[0], record, recordHash: evidenceHash(record) }; } };
      }
      if (kind === "admin-authenticator") return { async authenticate(request) { if (authenticationFails) throw new Error("synthetic-private-auth-detail"); return typeof adminIdentity === "function" ? adminIdentity(request) : adminIdentity; } };
      if (kind === "event-publisher") return { async publish(event) { published.push(event); }, async publishDeadLetter(event) { if (rejectDeadLetterSubjects.includes(event.subjectId)) throw new Error("dead-letter unavailable"); deadLetters.push(event); } };
      if (kind === "monitoring") return { async checkReadiness() { return { ok: true }; } };
      if (kind === "alerting") return { async reportFailure(code) { alerts.push({ type: "failure", code }); if (alertState.reject || alertState.rejectCodes.has(code)) throw new Error("alert unavailable"); }, async reportEvent(code) { alerts.push({ type: "event", code }); if (alertState.reject || alertState.rejectCodes.has(code)) throw new Error("alert unavailable"); } };
      return { kind, sourceById };
    },
  };
  const assembly = await assembleProductionApplication({
    config: { environment: "production", externalWritesEnabled }, l2Profile, l3Profile, resolver,
    settlementConfiguration: { profileId: "giraffe-settlement/production-v1", businessCalendarRef: "wenbao-production-v1", targetBusinessDays: 3, timeZone: "Asia/Shanghai", holidays: [] },
    clock,
  });
  await assembly.authenticateAdmin({ headers: {} });
  return { assembly, persisted, published, deadLetters, deliveryUpdates, alerts, persistStarted, getSourceFetches: () => sourceFetches, setSourceRecord(sourceId, record) { recordBySource[sourceId] = record; }, setSourceUnavailable(sourceId, unavailable = true) { if (unavailable) unavailableSources.add(sourceId); else unavailableSources.delete(sourceId); }, setRejectAlerts(value) { alertState.reject = value === true; }, setRejectAlertCodes(codes) { alertState.rejectCodes = new Set(codes); }, setAdminIdentity(value) { adminIdentity = value; }, failAuthentication() { authenticationFails = true; }, getCommandReads: () => commandReads, setCommand(key, value) { commands.set(key, value); }, failCommandRead() { commandReadFails = true; } };
}

test("production operator recovery uses public assembly authentication and never resumes a compromised runtime", async () => {
  const f = await productionFixture({ failPersistence: true, externalWritesEnabled: false });
  const input = { idempotencyKey: "recovery-production", evidenceReferences: { warehouse: "record:warehouse-001", asset: "record:asset-001", certificate: "record:certificate-001" }, evidenceVersion: 1 };
  await assert.rejects(() => f.assembly.controlPlane.verifyAsset({ ...input, actorId: "production-operator" }), /MYSQL_DURABILITY_FAILURE/);
  assert.equal(f.assembly.runtime.operationalState.compromised, true);
  const read = (value = input, method = "verifyAsset") => f.assembly.inspectCommandRecovery({ headers: {} }, method, value);
  assert.deepEqual(await read(), { status: "UNRESOLVED", writeResumptionAllowed: false });
  const hash = evidenceHash({ method: "verifyAsset", input: { actorId: "production-operator", ...input } });
  f.setCommand(input.idempotencyKey, { commandHash: hash, status: "COMPLETED", result: { detail: "synthetic-private-result" } });
  assert.deepEqual(await read({ ...input, ignoredByVerifyWrapper: true }), { status: "COMPLETED_OBSERVED", writeResumptionAllowed: false });
  assert.equal((await read({ ...input, evidenceVersion: 2 })).status, "CONFLICT");
  f.setCommand(input.idempotencyKey, { commandHash: hash, status: "PENDING" });
  assert.equal((await read()).status, "UNRESOLVED");
  await assert.rejects(() => read(input, "unlisted"), /COMMAND_METHOD_INVALID/);
  await assert.rejects(() => read({ ...input, actorId: "production-operator" }), /RECOVERY_INPUT_INVALID/);
  await assert.rejects(() => read({ ...input, actorId: "forged-operator" }), /RECOVERY_INPUT_INVALID/);
  const reads = f.getCommandReads();
  f.setAdminIdentity(null);
  await assert.rejects(read, /ADMIN_AUTHENTICATION_REQUIRED/);
  f.setAdminIdentity({ actorId: "production-operator", roles: ["READER"] });
  await assert.rejects(read, /PERMISSION_DENIED/);
  assert.equal(f.getCommandReads(), reads);
  f.setAdminIdentity({ actorId: "production-operator", roles: ["ORACLE_OPERATOR"] });
  assert.equal((await read()).status, "UNRESOLVED");
  f.failCommandRead();
  await assert.rejects(read, { message: "MYSQL_RECOVERY_READ_FAILED" });
  f.failAuthentication();
  await assert.rejects(read, { message: "ADMIN_AUTHENTICATION_REQUIRED" });
  assert.equal(f.getSourceFetches(), 3);
  assert.equal(f.persisted.length, 0);
  assert.equal(f.assembly.runtime.operationalState.compromised, true);
  await assert.rejects(() => f.assembly.controlPlane.verifyAsset({ ...input, actorId: "production-operator" }), /DURABLE_STATE_COMPROMISED/);
});

test("production recovery delegates both arguments and preserves finalized-command canonical identity", async (t) => {
  const f = await productionFixture({ externalWritesEnabled: false });
  const input = { idempotencyKey: "recovery-finalization", request: { evidenceVersion: 3, warehouseReference: "record:warehouse-final", settlementId: "settlement-recovery", snapshotHash: HASH_A, certificateReference: "record:certificate-final", assetReference: "record:asset-final" } };
  f.setCommand(input.idempotencyKey, { commandHash: evidenceHash({ method: "finalizeSettlement", input: { actorId: "production-operator", ...input } }), status: "COMPLETED", result: { detail: "synthetic-private-result" } });
  assert.deepEqual(await f.assembly.inspectCommandRecovery({ headers: {} }, "finalizeSettlement", { ...input, ignoredByFinalizeWrapper: true }), { status: "COMPLETED_OBSERVED", writeResumptionAllowed: false });
  await assert.rejects(() => f.assembly.inspectCommandRecovery({ headers: {} }, "finalizeSettlement", { ...input, request: { ...input.request, warehouseConfirmed: true } }), /AUTHORITATIVE_FINALIZATION_INPUT_INVALID/);
  assert.equal(f.getSourceFetches(), 0);
  assert.equal(f.persisted.length, 0);
  const app = createApp({ config: { environment: "production", externalWritesEnabled: false }, ...f.assembly });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${app.address().port}/v1/rwa/admin/assets/verify`, { method: "POST" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).errorCode, "ADMIN_WRITES_DISABLED");
});

test("production recovery isolates same-actor concurrent role snapshots", async () => {
  const f = await productionFixture({ externalWritesEnabled: false });
  f.assembly.runtime.operationalState.compromised = true;
  const input = { idempotencyKey: "concurrent-recovery", evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" }, evidenceVersion: 1 };
  for (const roles of [["READER", "ORACLE_OPERATOR"], ["ORACLE_OPERATOR", "READER"]]) {
    // Both server authentications complete before their continuations. The old
    // shared actor table allowed the last identity to govern both observations.
    f.setAdminIdentity((request) => ({ actorId: "production-operator", roles: [request.serverAuthenticatedRole] }));
    const reads = f.getCommandReads();
    const results = await Promise.allSettled(roles.map((role) => f.assembly.inspectCommandRecovery({ serverAuthenticatedRole: role }, "verifyAsset", input)));
    for (const [index, role] of roles.entries()) {
      if (role === "READER") {
        assert.equal(results[index].status, "rejected");
        assert.equal(results[index].reason.message, "PERMISSION_DENIED:asset:verify");
      } else {
        assert.equal(results[index].status, "fulfilled");
        assert.deepEqual(results[index].value, { status: "UNRESOLVED", writeResumptionAllowed: false });
      }
    }
    assert.equal(f.getCommandReads(), reads + 1);
  }
  assert.equal(f.assembly.runtime.operationalState.compromised, true);
  assert.equal(f.getSourceFetches(), 0);
  assert.equal(f.persisted.length, 0);
});

test("production audit recovery rejects injected capabilities and uses request-local server authorization", async () => {
  const f = await productionFixture({ externalWritesEnabled: false });
  f.assembly.runtime.auditJournal.append({ type: "synthetic.recovery", subjectId: "synthetic", payloadHash: HASH_A, actorId: "production-operator", occurredAt: NOW.toISOString() });
  f.assembly.runtime.operationalState.compromised = true;
  const input = { idempotencyKey: "audit-recovery", purpose: "internal-reconciliation" };
  const commandHash = evidenceHash({ method: "exportAudit", input: { ...input, actorId: "production-operator" } });
  f.setCommand(input.idempotencyKey, { commandHash, status: "COMPLETED", result: { privateResult: "must-not-return" } });
  let injectedCalls = 0;
  const injected = { authorizeExport() { injectedCalls += 1; return true; } };
  const read = (value = input) => f.assembly.inspectCommandRecovery({ headers: {} }, "exportAudit", value);
  f.setAdminIdentity({ actorId: "production-operator", roles: ["READER"] });
  await assert.rejects(() => read({ ...input, adminOperations: injected }), { message: "RECOVERY_INPUT_INVALID" });
  await assert.rejects(() => read(Object.assign(Object.create({ adminOperations: injected }), input)), { message: "RECOVERY_INPUT_INVALID" });
  await assert.rejects(read, { message: "PERMISSION_DENIED:audit:export" });
  assert.equal(f.getCommandReads(), 0);
  assert.equal(injectedCalls, 0);
  f.setAdminIdentity({ actorId: "production-operator", roles: ["AUDITOR"] });
  await assert.rejects(() => read({ ...input, adminOperations: injected }), { message: "RECOVERY_INPUT_INVALID" });
  await assert.rejects(() => read({ ...input, purpose: "unapproved" }), { message: "EXPORT_PURPOSE_INVALID" });
  assert.equal(f.getCommandReads(), 0);
  assert.deepEqual(await read(), { status: "COMPLETED_OBSERVED", writeResumptionAllowed: false });
  f.setAdminIdentity((request) => ({ actorId: "production-operator", roles: [request.serverAuthenticatedRole] }));
  const results = await Promise.allSettled(["READER", "AUDITOR"].map((role) => f.assembly.inspectCommandRecovery({ serverAuthenticatedRole: role }, "exportAudit", input)));
  assert.equal(results[0].status, "rejected");
  assert.equal(results[0].reason.message, "PERMISSION_DENIED:audit:export");
  assert.deepEqual(results[1], { status: "fulfilled", value: { status: "COMPLETED_OBSERVED", writeResumptionAllowed: false } });
  assert.equal(f.getCommandReads(), 2);
  assert.equal(f.assembly.runtime.auditJournal.list().length, 1);
  assert.equal(f.assembly.runtime.operationalState.compromised, true);
  assert.equal(f.getSourceFetches(), 0);
  assert.equal(f.persisted.length, 0);
});

test("production assembly fetches three authenticated sources and persists the authoritative mutation", async () => {
  const { assembly, persisted, published, deliveryUpdates, getSourceFetches } = await productionFixture();
  const command = { actorId: "production-operator", idempotencyKey: "production-verify-001", evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" }, evidenceVersion: 1 };
  const result = await assembly.controlPlane.verifyAsset(command);
  assert.equal(result.result.status, "VALID");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].method, "verifyAsset");
  assert.equal(persisted[0].auditEvents.length, 1);
  assert.equal(persisted[0].outboxEvents.length, 1);
  assert.match(persisted[0].stateSnapshot.stateHash, /^[a-f0-9]{64}$/);
  assert.equal((await assembly.controlPlane.verifyAsset(command)).replayed, true);
  assert.equal(getSourceFetches(), 3);
  assert.deepEqual(await assembly.outboxDispatcher.drain(), [{ eventId: assembly.runtime.outbox.list()[0].eventId, status: "PUBLISHED" }]);
  assert.equal(published.length, 1);
  assert.deepEqual(deliveryUpdates.map(({ type }) => type), ["published"]);
  assert.deepEqual(await assembly.readinessCheck(), { ok: true });
});

test("production finalization derives confirmations from all authenticated sources and emits certificate supersession", async () => {
  const { assembly, setSourceRecord, getSourceFetches } = await productionFixture();
  await assembly.controlPlane.verifyAsset({ actorId: "production-operator", idempotencyKey: "production-finalize-verify", evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" }, evidenceVersion: 1 });
  await assembly.controlPlane.bindToken({ actorId: "production-operator", idempotencyKey: "production-finalize-bind", binding: { assetId: "asset-production", chainId: "560048", contract: "test-only", tokenId: "1" } });
  const pending = (await assembly.controlPlane.beginSettlement({ actorId: "production-operator", idempotencyKey: "production-finalize-begin", request: { settlementId: "production-settlement", assetId: "asset-production", token: { chainId: "560048", contract: "test-only", tokenId: "1" }, sellerWallet: "seller", buyerWallet: "buyer", externalExecutionRef: "external-production", oldCertificateHash: HASH_B, warehouseReceiptHash: HASH_C, evidenceVersion: 2 } })).result;
  const next = records("asset-production");
  next.asset.currentCertificateHash = HASH_A;
  next.asset.currentCertificateVersion = 2;
  next.asset.currentOwnerCommitment = HASH_B;
  const buyerCommitment = evidenceHash({ schemaVersion: "giraffe-settlement-buyer-commitment.v1", settlementId: pending.settlementId, buyerWallet: pending.buyerWallet });
  const settlementScope = { settlementId: pending.settlementId, settlementSnapshotHash: pending.snapshotHash, settlementBuyerCommitment: buyerCommitment };
  Object.assign(next.asset, settlementScope);
  Object.assign(next.certificate, settlementScope);
  Object.assign(next.warehouse, settlementScope, { holderCommitment: HASH_B });
  next.certificate = { ...next.certificate, certificateVersion: 2, certificateHash: HASH_A, previousCertificateHash: HASH_B, wenbaoChangeRef: "change-production" };
  setSourceRecord("authoritative-registry", next.asset);
  setSourceRecord("authoritative-certificate", next.certificate);
  setSourceRecord("authoritative-warehouse", next.warehouse);
  const references = { assetReference: "record:asset-final", certificateReference: "record:certificate-final", warehouseReference: "record:warehouse-final" };
  await assert.rejects(() => assembly.controlPlane.finalizeSettlement({ actorId: "production-operator", idempotencyKey: "production-finalize-injected", request: { settlementId: pending.settlementId, snapshotHash: pending.snapshotHash, evidenceVersion: 3, ...references, warehouseConfirmed: true } }), /AUTHORITATIVE_FINALIZATION_INPUT_INVALID/);
  setSourceRecord("authoritative-warehouse", { ...next.warehouse, holderCommitment: HASH_A });
  await assert.rejects(() => assembly.controlPlane.finalizeSettlement({ actorId: "production-operator", idempotencyKey: "production-finalize-holder-mismatch", request: { settlementId: pending.settlementId, snapshotHash: pending.snapshotHash, evidenceVersion: 3, ...references } }), /SETTLEMENT_HOLDER_CONFIRMATION_MISMATCH/);
  setSourceRecord("authoritative-warehouse", next.warehouse);
  setSourceRecord("authoritative-certificate", { ...next.certificate, settlementId: "different-settlement" });
  await assert.rejects(() => assembly.controlPlane.finalizeSettlement({ actorId: "production-operator", idempotencyKey: "production-finalize-scope-mismatch", request: { settlementId: pending.settlementId, snapshotHash: pending.snapshotHash, evidenceVersion: 3, ...references } }), /SETTLEMENT_SCOPE_EVIDENCE_MISMATCH/);
  setSourceRecord("authoritative-certificate", next.certificate);
  setSourceRecord("authoritative-registry", { ...next.asset, warehouseId: "warehouse-replaced" });
  setSourceRecord("authoritative-warehouse", { ...next.warehouse, warehouseId: "warehouse-replaced" });
  await assert.rejects(() => assembly.controlPlane.finalizeSettlement({ actorId: "production-operator", idempotencyKey: "production-finalize-warehouse-replaced", request: { settlementId: pending.settlementId, snapshotHash: pending.snapshotHash, evidenceVersion: 3, ...references } }), /SETTLEMENT_WAREHOUSE_EVIDENCE_MISMATCH/);
  setSourceRecord("authoritative-registry", next.asset);
  setSourceRecord("authoritative-warehouse", next.warehouse);
  const finalized = await assembly.controlPlane.finalizeSettlement({ actorId: "production-operator", idempotencyKey: "production-finalize-complete", request: { settlementId: pending.settlementId, snapshotHash: pending.snapshotHash, evidenceVersion: 3, ...references } });
  assert.equal(finalized.result.status, "FINALIZED");
  assert.equal(assembly.runtime.recordStore.getAsset("asset-production").currentOwnerCommitment, HASH_B);
  assert.equal(assembly.runtime.recordStore.getWarehouse("asset-production").holderCommitment, HASH_B);
  assert.equal(assembly.runtime.recordStore.provenance("WAREHOUSE", "asset-production").sourceId, "authoritative-warehouse");
  assert.equal(getSourceFetches(), 15);
  const events = assembly.runtime.outbox.list().filter(({ subjectId }) => subjectId === "asset-production").map(({ eventType }) => eventType);
  assert.ok(events.includes("certificate.superseded"));
  assert.ok(events.includes("settlement.finalized"));
});
test("Stage D synthetic market event survives one Oracle certificate-reissue recovery drill idempotently", async () => {
  const { assembly, setSourceRecord, persisted, published } = await productionFixture();

  await assembly.controlPlane.verifyAsset({
    actorId: "production-operator",
    idempotencyKey: "stage-d-verify",
    evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" },
    evidenceVersion: 1,
  });
  await assembly.controlPlane.bindToken({
    actorId: "production-operator",
    idempotencyKey: "stage-d-bind",
    binding: { assetId: "asset-production", chainId: "560048", contract: "test-only", tokenId: "1" },
  });

  // This externalExecutionRef is a synthetic external-market trigger only; no market,
  // counterparty, funds, or chain transaction is invoked by this drill.
  const begin = {
    actorId: "production-operator",
    idempotencyKey: "stage-d-market-event",
    request: {
      settlementId: "stage-d-settlement",
      assetId: "asset-production",
      token: { chainId: "560048", contract: "test-only", tokenId: "1" },
      sellerWallet: "seller-test",
      buyerWallet: "buyer-test",
      externalExecutionRef: "synthetic-market-event-001",
      oldCertificateHash: HASH_B,
      warehouseReceiptHash: HASH_C,
      evidenceVersion: 2,
    },
  };
  const pending = await assembly.controlPlane.beginSettlement(begin);
  const pendingReplay = await assembly.controlPlane.beginSettlement(begin);
  assert.equal(pending.result.status, "PENDING");
  assert.equal(pendingReplay.replayed, true);
  assert.equal(pendingReplay.result.snapshotHash, pending.result.snapshotHash);

  const next = records("asset-production");
  next.asset.currentCertificateHash = HASH_A;
  next.asset.currentCertificateVersion = 2;
  next.asset.currentOwnerCommitment = HASH_B;
  const buyerCommitment = evidenceHash({
    schemaVersion: "giraffe-settlement-buyer-commitment.v1",
    settlementId: pending.result.settlementId,
    buyerWallet: pending.result.buyerWallet,
  });
  const scope = {
    settlementId: pending.result.settlementId,
    settlementSnapshotHash: pending.result.snapshotHash,
    settlementBuyerCommitment: buyerCommitment,
  };
  Object.assign(next.asset, scope);
  Object.assign(next.certificate, scope, {
    certificateVersion: 2,
    certificateHash: HASH_A,
    previousCertificateHash: HASH_B,
    wenbaoChangeRef: "synthetic-registry-change-001",
  });
  Object.assign(next.warehouse, scope, { holderCommitment: HASH_B });
  setSourceRecord("authoritative-registry", next.asset);
  setSourceRecord("authoritative-certificate", next.certificate);
  setSourceRecord("authoritative-warehouse", next.warehouse);

  const finalize = {
    actorId: "production-operator",
    idempotencyKey: "stage-d-finalize",
    request: {
      settlementId: pending.result.settlementId,
      snapshotHash: pending.result.snapshotHash,
      evidenceVersion: 3,
      assetReference: "record:stage-d-asset",
      certificateReference: "record:stage-d-certificate",
      warehouseReference: "record:stage-d-warehouse",
    },
  };
  const completed = await assembly.controlPlane.finalizeSettlement(finalize);
  const completedReplay = await assembly.controlPlane.finalizeSettlement(finalize);

  assert.equal(completed.result.status, "FINALIZED");
  assert.equal(completedReplay.replayed, true);
  assert.equal(completedReplay.result.newCertificateHash, HASH_A);
  assert.equal(assembly.runtime.recordStore.currentCertificate("asset-production").certificateVersion, 2);
  assert.equal(assembly.runtime.recordStore.currentCertificate("asset-production").previousCertificateHash, HASH_B);
  assert.equal(assembly.runtime.stateEngine.current("asset-production"), "VALID");
  assert.equal(assembly.runtime.settlements.get("stage-d-settlement").status, "FINALIZED");
  assert.equal(persisted.filter(({ method }) => method === "finalizeSettlement").length, 1);

  const settlementEvents = assembly.runtime.outbox.list()
    .filter(({ subjectId }) => subjectId === "asset-production")
    .map(({ eventType }) => eventType);
  assert.equal(settlementEvents.filter((type) => type === "settlement.started").length, 1);
  assert.equal(settlementEvents.filter((type) => type === "certificate.superseded").length, 1);
  assert.equal(settlementEvents.filter((type) => type === "settlement.finalized").length, 1);

  await assembly.outboxDispatcher.drain();
  assert.equal(published.filter(({ subjectId, eventType }) =>
    subjectId === "asset-production" && ["settlement.started", "certificate.superseded", "settlement.finalized"].includes(eventType),
  ).length, 3, "each lifecycle event is published exactly once");
  assert.equal(assembly.runtime.auditJournal.verify(), true);
});

test("Stage D source interruption fails settlement closed and recovers with the same command identity", async () => {
  const { assembly, setSourceRecord, setSourceUnavailable, persisted } = await productionFixture();

  await assembly.controlPlane.verifyAsset({
    actorId: "production-operator",
    idempotencyKey: "stage-d-outage-verify",
    evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" },
    evidenceVersion: 1,
  });
  await assembly.controlPlane.bindToken({
    actorId: "production-operator",
    idempotencyKey: "stage-d-outage-bind",
    binding: { assetId: "asset-production", chainId: "560048", contract: "test-only", tokenId: "1" },
  });
  const pending = await assembly.controlPlane.beginSettlement({
    actorId: "production-operator",
    idempotencyKey: "stage-d-outage-begin",
    request: {
      settlementId: "stage-d-outage-settlement",
      assetId: "asset-production",
      token: { chainId: "560048", contract: "test-only", tokenId: "1" },
      sellerWallet: "seller-test",
      buyerWallet: "buyer-test",
      externalExecutionRef: "synthetic-market-event-outage",
      oldCertificateHash: HASH_B,
      warehouseReceiptHash: HASH_C,
      evidenceVersion: 2,
    },
  });

  const next = records("asset-production");
  next.asset.currentCertificateHash = HASH_A;
  next.asset.currentCertificateVersion = 2;
  next.asset.currentOwnerCommitment = HASH_B;
  const buyerCommitment = evidenceHash({
    schemaVersion: "giraffe-settlement-buyer-commitment.v1",
    settlementId: pending.result.settlementId,
    buyerWallet: pending.result.buyerWallet,
  });
  const scope = {
    settlementId: pending.result.settlementId,
    settlementSnapshotHash: pending.result.snapshotHash,
    settlementBuyerCommitment: buyerCommitment,
  };
  Object.assign(next.asset, scope);
  Object.assign(next.certificate, scope, {
    certificateVersion: 2,
    certificateHash: HASH_A,
    previousCertificateHash: HASH_B,
    wenbaoChangeRef: "synthetic-registry-change-after-outage",
  });
  Object.assign(next.warehouse, scope, { holderCommitment: HASH_B });
  setSourceRecord("authoritative-registry", next.asset);
  setSourceRecord("authoritative-certificate", next.certificate);
  setSourceRecord("authoritative-warehouse", next.warehouse);

  const finalize = {
    actorId: "production-operator",
    idempotencyKey: "stage-d-outage-finalize",
    request: {
      settlementId: pending.result.settlementId,
      snapshotHash: pending.result.snapshotHash,
      evidenceVersion: 3,
      assetReference: "record:stage-d-outage-asset",
      certificateReference: "record:stage-d-outage-certificate",
      warehouseReference: "record:stage-d-outage-warehouse",
    },
  };
  setSourceUnavailable("authoritative-certificate");
  await assert.rejects(() => assembly.controlPlane.finalizeSettlement(finalize), /SOURCE_UNAVAILABLE/);
  assert.equal(assembly.runtime.settlements.get(pending.result.settlementId).status, "PENDING");
  assert.equal(assembly.runtime.recordStore.currentCertificate("asset-production").certificateVersion, 1);
  assert.equal(assembly.runtime.stateEngine.current("asset-production"), "TRANSFER_PENDING");
  assert.equal(persisted.filter(({ method }) => method === "finalizeSettlement").length, 0);
  assert.equal(assembly.runtime.auditJournal.list().some(({ type }) => type === "settlement.finalized"), false);

  setSourceUnavailable("authoritative-certificate", false);
  const recovered = await assembly.controlPlane.finalizeSettlement(finalize);
  assert.equal(recovered.result.status, "FINALIZED");
  assert.equal(recovered.replayed, false);
  assert.equal(assembly.runtime.recordStore.currentCertificate("asset-production").certificateVersion, 2);
  assert.equal(assembly.runtime.stateEngine.current("asset-production"), "VALID");
  assert.equal(persisted.filter(({ method }) => method === "finalizeSettlement").length, 1);
  assert.equal(assembly.runtime.auditJournal.verify(), true);
});

test("Stage D timeout stays non-final and timeout replay cannot reissue a certificate", async () => {
  let now = NOW;
  const { assembly, persisted } = await productionFixture({ clock: () => now });
  await assembly.controlPlane.verifyAsset({
    actorId: "production-operator",
    idempotencyKey: "stage-d-timeout-verify",
    evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" },
    evidenceVersion: 1,
  });
  await assembly.controlPlane.bindToken({
    actorId: "production-operator",
    idempotencyKey: "stage-d-timeout-bind",
    binding: { assetId: "asset-production", chainId: "560048", contract: "test-only", tokenId: "1" },
  });

  const begin = {
    actorId: "production-operator",
    idempotencyKey: "stage-d-timeout-begin",
    request: {
      settlementId: "stage-d-timeout-settlement",
      assetId: "asset-production",
      token: { chainId: "560048", contract: "test-only", tokenId: "1" },
      sellerWallet: "seller-test",
      buyerWallet: "buyer-test",
      externalExecutionRef: "synthetic-timeout-trigger-001",
      oldCertificateHash: HASH_B,
      warehouseReceiptHash: HASH_C,
      evidenceVersion: 2,
    },
  };
  const pending = await assembly.controlPlane.beginSettlement(begin);
  assert.equal(pending.result.status, "PENDING");
  assert.equal(assembly.runtime.recordStore.currentCertificate("asset-production").certificateVersion, 1);

  now = new Date(new Date(pending.result.deadlineAt).getTime() + 1);
  const timeout = {
    actorId: "production-operator",
    idempotencyKey: "stage-d-timeout-command",
    request: { settlementId: pending.result.settlementId, reasonHash: HASH_A, evidenceVersion: 3 },
  };
  const timedOut = await assembly.controlPlane.timeoutSettlement(timeout);
  const replay = await assembly.controlPlane.timeoutSettlement(timeout);

  assert.equal(timedOut.result.status, "TIMED_OUT");
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.status, "TIMED_OUT");
  assert.equal(assembly.runtime.settlements.get("stage-d-timeout-settlement").status, "TIMED_OUT");
  assert.equal(assembly.runtime.stateEngine.current("asset-production"), "REVIEW_REQUIRED");
  assert.equal(assembly.runtime.recordStore.currentCertificate("asset-production").certificateHash, HASH_B);
  assert.equal(assembly.runtime.recordStore.currentCertificate("asset-production").certificateVersion, 1);
  assert.equal(persisted.filter(({ method }) => method === "timeoutSettlement").length, 1);
  assert.equal(assembly.runtime.auditJournal.list().filter(({ type }) => type === "settlement.timed-out").length, 1);
  assert.equal(assembly.runtime.auditJournal.verify(), true);
});

test("async alert rejection is awaited and makes production readiness fail closed", async () => {
  const { assembly } = await productionFixture({ rejectAlerts: true });
  const event = assembly.runtime.outbox.enqueue({ eventType: "test", subjectId: "asset-alert", payloadHash: HASH_A, createdAt: NOW.toISOString() });
  assembly.runtime.outbox.markDurable(event.eventId);
  for (let attempt = 0; attempt < 5; attempt += 1) assembly.runtime.outbox.recordAttempt(event.eventId);
  assembly.startBackgroundWorkers({ intervalMs: 100 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(assembly.runtime.operationalState.alertingFailed, true);
  assert.deepEqual(await assembly.readinessCheck(), { ok: false });
});

test("a later successful alert callback restores readiness", async () => {
  const { assembly, setRejectAlerts } = await productionFixture({ rejectAlerts: true });
  const first = assembly.runtime.outbox.enqueue({ eventType: "test", subjectId: "asset-alert-fail", payloadHash: HASH_A, createdAt: NOW.toISOString() });
  assembly.runtime.outbox.markDurable(first.eventId);
  for (let attempt = 0; attempt < 5; attempt += 1) assembly.runtime.outbox.recordAttempt(first.eventId);
  const worker = assembly.startBackgroundWorkers({ intervalMs: 100 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(assembly.runtime.operationalState.alertingFailed, true);
  setRejectAlerts(false);
  const second = assembly.runtime.outbox.enqueue({ eventType: "test", subjectId: "asset-alert-recover", payloadHash: HASH_B, createdAt: new Date(NOW.getTime() + 1).toISOString() });
  assembly.runtime.outbox.markDurable(second.eventId);
  for (let attempt = 0; attempt < 5; attempt += 1) assembly.runtime.outbox.recordAttempt(second.eventId);
  await new Promise((resolve) => setTimeout(resolve, 150));
  worker.stop();
  assert.equal(assembly.runtime.operationalState.alertingFailed, false);
  assert.deepEqual(await assembly.readinessCheck(), { ok: true });
});
test("production rejects caller records and becomes unavailable after durability failure", async () => {
  const { assembly } = await productionFixture({ failPersistence: true });
  await assert.rejects(() => assembly.controlPlane.verifyAsset({ actorId: "production-operator", idempotencyKey: "production-verify-fail", evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" }, evidenceVersion: 1 }), /MYSQL_DURABILITY_FAILURE/);
  assert.equal(assembly.runtime.operationalState.compromised, true);
  await assert.rejects(() => assembly.controlPlane.bindToken({ actorId: "production-operator", idempotencyKey: "production-after-fail", binding: { assetId: "asset-production", chainId: "hoodi", contract: "contract-test", tokenId: "1" } }), /DURABLE_STATE_COMPROMISED/);
  await assert.rejects(() => assembly.controlPlane.verifyAsset({ actorId: "production-operator", idempotencyKey: "caller-records", asset: records("asset-x").asset, evidenceVersion: 1 }), /AUTHORITATIVE_REFERENCES_REQUIRED|AUTHORITATIVE_REFERENCE_INVALID/);
});

test("production restarts from the hash-verified authoritative state snapshot", async () => {
  const first = await productionFixture();
  await first.assembly.controlPlane.verifyAsset({ actorId: "production-operator", idempotencyKey: "production-restore-source", evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" }, evidenceVersion: 1 });
  const snapshot = first.persisted[0].stateSnapshot;
  const restored = await productionFixture({ initialSnapshot: snapshot });
  assert.equal(restored.assembly.runtime.recordStore.getAsset("asset-production").oracleStatus, "VALID");
  assert.equal(restored.assembly.runtime.auditJournal.verify(), true);
  await assert.rejects(() => productionFixture({ initialSnapshot: { ...snapshot, stateHash: HASH_A } }), /PRODUCTION_STATE_SNAPSHOT_INVALID/);
});

test("startup restores an approved ambiguous rotation under the active destination signer", () => {
  const sourceRuntime = createSyntheticRuntime({ clock: () => NOW });
  const sourceDualControl = new DualControlQueue();
  sourceDualControl.request({ actionId: "startup-rotation", actionType: "SIGNER_ROTATE", subjectId: "synthetic-oracle-signers->destination-signers", payloadHash: HASH_A, requestedBy: "security-a", requestedAt: NOW.toISOString() });
  sourceDualControl.approve("startup-rotation", { approvedBy: "approver-b", approvedAt: NOW.toISOString() });
  const snapshot = captureProductionState(sourceRuntime, sourceDualControl);

  const destinationRuntime = createSyntheticRuntime({ clock: () => NOW });
  const destinationKeys = generateKeyPairSync("ed25519");
  const destinationPolicy = new SignerSetPolicy({ signerSetId: "destination-signers", threshold: 1, signers: ["destination"], environment: "test" });
  destinationRuntime.attestations.activateSignerBackend({ signerSetId: "destination-signers", signBytes: (bytes) => sign(null, bytes, destinationKeys.privateKey), verifyBytes: (bytes, signature) => verify(null, bytes, destinationKeys.publicKey, signature), signerPolicy: destinationPolicy }, "synthetic-oracle-signers");
  const destinationDualControl = new DualControlQueue();
  assert.equal(restoreProductionState(destinationRuntime, destinationDualControl, snapshot), true);
  assert.equal(destinationRuntime.attestations.signerSetId, "destination-signers");
  assert.equal(destinationRuntime.operationalState.signerRecoveryRequired, true);
  assert.equal(destinationDualControl.list()[0].status, "RECOVERY_REQUIRED");
  assert.equal(destinationDualControl.list()[0].errorCode, "SIGNER_ROTATION_STARTUP_RECONCILIATION_REQUIRED");
});

test("deployment module loader requires an absolute regular file and exact SHA-256", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "giraffe-oracle-deployment-"));
  const modulePath = path.join(directory, "deployment.mjs");
  const bytes = Buffer.from("export const settlementConfiguration={profileId:'giraffe-settlement/production-v1'};export async function createDeploymentResolver(){return {resolve(){}}}\n", "utf8");
  await writeFile(modulePath, bytes, { flag: "wx", mode: 0o600 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal((await loadPinnedDeploymentModule({ modulePath, expectedSha256: sha256 })).moduleSha256, sha256);
  await assert.rejects(() => loadPinnedDeploymentModule({ modulePath, expectedSha256: HASH_A }), /HASH_MISMATCH/);
  await assert.rejects(() => loadPinnedDeploymentModule({ modulePath: "deployment.mjs", expectedSha256: sha256 }), /PIN_REQUIRED/);
});

test("production bootstrap requires a matching active signer policy", async () => {
  await assert.rejects(() => productionFixture({ omitSignerPolicy: true }), /PRODUCTION_SIGNER_POLICY_INVALID/);
});

test("overlapping durable commands do not resolve before the shared commit", async () => {
  let releasePersistence;
  const persistenceGate = new Promise((resolve) => { releasePersistence = resolve; });
  const { assembly, persisted, persistStarted } = await productionFixture({ persistenceGate });
  const command = { actorId: "production-operator", idempotencyKey: "production-overlap", evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" }, evidenceVersion: 1 };
  const first = assembly.controlPlane.verifyAsset(command);
  await persistStarted;
  assert.equal(assembly.runtime.outbox.pending().length, 0);
  let secondResolved = false;
  const second = assembly.controlPlane.verifyAsset(command).then((value) => { secondResolved = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondResolved, false);
  releasePersistence();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.result.status, "VALID");
  assert.equal(secondResult.replayed, true);
  assert.equal(persisted.length, 1);
  assert.equal(assembly.runtime.outbox.pending().length, 1);
});

test("overlapping durable commands all reject when the shared commit fails", async () => {
  let releasePersistence;
  const persistenceGate = new Promise((resolve) => { releasePersistence = resolve; });
  const { assembly, persistStarted } = await productionFixture({ persistenceGate, failPersistence: true });
  const command = { actorId: "production-operator", idempotencyKey: "production-overlap-fail", evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" }, evidenceVersion: 1 };
  const first = assembly.controlPlane.verifyAsset(command);
  await persistStarted;
  const second = assembly.controlPlane.verifyAsset(command);
  releasePersistence();
  const settled = await Promise.allSettled([first, second]);
  assert.deepEqual(settled.map(({ status }) => status), ["rejected", "rejected"]);
  assert.equal(settled.every(({ reason }) => reason.message === "MYSQL_DURABILITY_FAILURE"), true);
});

test("different durable writes serialize runtime mutation with snapshot persistence", async () => {
  let releasePersistence;
  const persistenceGate = new Promise((resolve) => { releasePersistence = resolve; });
  const { assembly, persistStarted } = await productionFixture({ persistenceGate });
  const verification = assembly.controlPlane.verifyAsset({ actorId: "production-operator", idempotencyKey: "production-serialized-verify", evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" }, evidenceVersion: 1 });
  await persistStarted;
  const binding = assembly.controlPlane.bindToken({ actorId: "production-operator", idempotencyKey: "production-serialized-bind", binding: { assetId: "asset-production", chainId: "560048", contract: "test-only-contract", tokenId: "1" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(assembly.runtime.tokenIndex.byAsset("asset-production"), null);
  releasePersistence();
  await Promise.all([verification, binding]);
  assert.equal(assembly.runtime.tokenIndex.byAsset("asset-production").tokenId, "1");
});

test("queued writes are cancelled after the preceding durable commit fails", async () => {
  let releasePersistence;
  const persistenceGate = new Promise((resolve) => { releasePersistence = resolve; });
  const { assembly, persistStarted } = await productionFixture({ persistenceGate, failPersistence: true });
  const verification = assembly.controlPlane.verifyAsset({ actorId: "production-operator", idempotencyKey: "production-poison-verify", evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" }, evidenceVersion: 1 });
  await persistStarted;
  const binding = assembly.controlPlane.bindToken({ actorId: "production-operator", idempotencyKey: "production-poison-bind", binding: { assetId: "asset-production", chainId: "560048", contract: "test-only-contract", tokenId: "2" } });
  releasePersistence();
  const [first, second] = await Promise.allSettled([verification, binding]);
  assert.equal(first.reason.message, "MYSQL_DURABILITY_FAILURE");
  assert.equal(second.reason.message, "DURABLE_STATE_COMPROMISED");
  assert.equal(assembly.runtime.tokenIndex.byAsset("asset-production"), null);
});

test("durable audit replay rechecks current export authorization", async () => {
  const command = { actorId: "former-auditor", idempotencyKey: "durable-export", purpose: "regulatory-audit", adminOperations: { authorizeExport() { throw new Error("PERMISSION_DENIED:audit:export"); } } };
  const { adminOperations: _capability, ...serializable } = command;
  const commandHash = evidenceHash({ method: "exportAudit", input: serializable });
  const durable = new DurableOracleControlPlane({
    controlPlane: { authorizeCommand() { throw new Error("PERMISSION_DENIED:audit:export"); }, exportAudit() { throw new Error("SHOULD_NOT_EXECUTE"); } },
    repository: { async getCommand() { return { commandHash, status: "COMPLETED", result: { exportId: "prior" } }; }, async persistMutation() {} },
    runtime: { operationalState: { compromised: false }, auditJournal: { list() { return []; } }, outbox: { list() { return []; } } },
    dualControl: {},
  });
  await assert.rejects(() => durable.exportAudit(command), /PERMISSION_DENIED:audit:export/);
});

test("every durable replay rechecks the actor's current command authorization", async () => {
  const command = { actorId: "former-operator", idempotencyKey: "durable-bind", binding: { assetId: "asset", chainId: "560048", contract: "test-only", tokenId: "1" } };
  const commandHash = evidenceHash({ method: "bindToken", input: command });
  const durable = new DurableOracleControlPlane({
    controlPlane: { authorizeCommand() { throw new Error("PERMISSION_DENIED:token:bind"); }, bindToken() { throw new Error("SHOULD_NOT_EXECUTE"); } },
    repository: { async getCommand() { return { commandHash, status: "COMPLETED", result: { assetId: "asset" } }; }, async persistMutation() {} },
    runtime: { operationalState: { compromised: false }, auditJournal: { list() { return []; } }, outbox: { list() { return []; } } },
    dualControl: {},
  });
  await assert.rejects(() => durable.bindToken(command), /PERMISSION_DENIED:token:bind/);
});

test("production readiness fails closed when the deployment health boundary is unavailable", async () => {
  const server = createApp({ config: { environment: "production", externalWritesEnabled: true }, sourceRegistry: new SourceRegistry(), readinessCheck: async () => ({ ok: false }) });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const response = await fetch(`http://localhost:${server.address().port}/readyz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, errorCode: "PRODUCTION_DEPENDENCIES_UNAVAILABLE" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("signer policy receives and enforces attestation context before signing", () => {
  const keys = generateKeyPairSync("ed25519");
  const policy = new SignerSetPolicy({ signerSetId: "context-signers", threshold: 1, signers: ["context"], environment: "production", purposes: ["OWNERSHIP"], maxTtlSeconds: 60 });
  const service = new AttestationService({ signerSetId: "context-signers", privateKey: keys.privateKey, publicKey: keys.publicKey, signerPolicy: policy, environment: "production", revocations: new RevocationRegistry(), clock: () => NOW });
  const base = { subject: { assetId: "asset-context", chainId: "560048", contract: "test-only", tokenId: "1", purpose: "OWNERSHIP" }, factType: "STATUS", factValue: "VALID", sourceAuthority: "registry", sourceRecordHash: HASH_A, validForSeconds: 60, nonce: "context-ok" };
  assert.equal(service.issue(base).envelope.signerSetId, "context-signers");
  assert.throws(() => service.issue({ ...base, subject: { ...base.subject, purpose: "LENDING" }, nonce: "context-purpose" }), /SIGNER_POLICY_PURPOSE_REJECTED/);
  assert.throws(() => service.issue({ ...base, validForSeconds: 61, nonce: "context-ttl" }), /SIGNER_POLICY_TTL_REJECTED/);
});

test("attestation signer-set identifiers are bounded before signing or activation", () => {
  const keys = generateKeyPairSync("ed25519");
  assert.throws(() => new AttestationService({ signerSetId: "s".repeat(65), privateKey: keys.privateKey, publicKey: keys.publicKey, revocations: new RevocationRegistry() }), /ATTESTATION_DEPENDENCY_MISSING/);
  const service = new AttestationService({ signerSetId: "old", privateKey: keys.privateKey, publicKey: keys.publicKey, revocations: new RevocationRegistry() });
  const nextPolicy = new SignerSetPolicy({ signerSetId: "n".repeat(65), threshold: 1, signers: ["next"] });
  assert.throws(() => service.activateSignerBackend({ signerSetId: "n".repeat(65), signBytes() {}, verifyBytes() {}, signerPolicy: nextPolicy }, "old"), /SIGNER_SET_ACTIVATION_INVALID/);
});
test("protected signer callbacks receive only a 32-byte canonical envelope digest", () => {
  const keys = generateKeyPairSync("ed25519");
  let signedLength = null;
  let verifiedLength = null;
  const service = new AttestationService({
    signerSetId: "digest-signers",
    signBytes(bytes) { signedLength = bytes.length; return sign(null, bytes, keys.privateKey); },
    verifyBytes(bytes, signature) { verifiedLength = bytes.length; return verify(null, bytes, keys.publicKey, signature); },
    revocations: new RevocationRegistry(),
    clock: () => NOW,
  });
  const attestation = service.issue({ subject: { assetId: "asset-digest", chainId: "560048", contract: "test-only", tokenId: "1", purpose: "OWNERSHIP" }, factType: "STATUS", factValue: "VALID", sourceAuthority: "registry", sourceRecordHash: HASH_A, validForSeconds: 60, nonce: "digest-nonce" });
  assert.equal(service.verify(attestation).valid, true);
  assert.equal(signedLength, 32);
  assert.equal(verifiedLength, 32);
});

test("restart imports hash-protected attestations issued by a retired signer", () => {
  const oldKeys = generateKeyPairSync("ed25519");
  const newKeys = generateKeyPairSync("ed25519");
  const oldPolicy = new SignerSetPolicy({ signerSetId: "old-signers", threshold: 1, signers: ["old"] });
  const newPolicy = new SignerSetPolicy({ signerSetId: "new-signers", threshold: 1, signers: ["new"] });
  const original = new AttestationService({ signerSetId: "old-signers", privateKey: oldKeys.privateKey, publicKey: oldKeys.publicKey, signerPolicy: oldPolicy, revocations: new RevocationRegistry(), clock: () => NOW });
  const historical = original.issue({ subject: { assetId: "asset-history", chainId: "560048", contract: "test-only", tokenId: "1", purpose: "OWNERSHIP" }, factType: "STATUS", factValue: "VALID", sourceAuthority: "authoritative-registry", sourceRecordHash: HASH_A, validForSeconds: 3600, nonce: "historical-nonce" });
  original.activateSignerBackend({ signerSetId: "new-signers", signBytes: (bytes) => sign(null, bytes, newKeys.privateKey), verifyBytes: (bytes, signature) => verify(null, bytes, newKeys.publicKey, signature), signerPolicy: newPolicy }, "old-signers");
  const restored = new AttestationService({ signerSetId: "new-signers", privateKey: newKeys.privateKey, publicKey: newKeys.publicKey, verifyHistoricalBytes: (signerSetId, bytes, signature) => signerSetId === "old-signers" ? verify(null, bytes, oldKeys.publicKey, signature) : signerSetId === "new-signers" && verify(null, bytes, newKeys.publicKey, signature), signerPolicy: newPolicy, revocations: new RevocationRegistry(), clock: () => NOW });
  restored.importState(original.exportState());
  assert.deepEqual(restored.get(historical.envelope.attestationId), historical);
});



test("mixed alert results retain each failed alert boundary until that same boundary recovers", async () => {
  const { assembly } = await productionFixture({ rejectAlertCodes: ["OUTBOX_DEAD_LETTER_FAILED"], rejectDeadLetterSubjects: ["asset-alert-failure"] });
  for (const [subjectId, hash, createdAt] of [
    ["asset-alert-failure", HASH_A, NOW.toISOString()],
    ["asset-alert-success", HASH_B, new Date(NOW.getTime() + 1).toISOString()],
  ]) {
    const event = assembly.runtime.outbox.enqueue({ eventType: "test", subjectId, payloadHash: hash, createdAt });
    assembly.runtime.outbox.markDurable(event.eventId);
    for (let attempt = 0; attempt < 5; attempt += 1) assembly.runtime.outbox.recordAttempt(event.eventId);
  }
  const worker = assembly.startBackgroundWorkers({ intervalMs: 100 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  worker.stop();
  assert.equal(assembly.runtime.operationalState.alertingFailed, true);
  assert.deepEqual(await assembly.readinessCheck(), { ok: false });
});

test("production readiness fails closed while signer reconciliation is required", async () => {
  const { assembly } = await productionFixture();
  assembly.runtime.operationalState.signerRecoveryRequired = true;
  assert.deepEqual(await assembly.readinessCheck(), { ok: false });
  assembly.runtime.operationalState.signerRecoveryRequired = false;
  assert.deepEqual(await assembly.readinessCheck(), { ok: true });
});
test("durable commands capture every newly created implicit revocation", async () => {
  const runtime = createSyntheticRuntime({ clock: () => NOW });
  const dualControl = new DualControlQueue();
  const persisted = [];
  const attestationId = "00000000-0000-4000-8000-000000000123";
  const controlPlane = {
    authorizeCommand() {},
    beginSettlement() {
      runtime.revocations.revoke({ attestationId, reasonHash: HASH_A, authorityId: "production-operator", revokedAt: NOW.toISOString() });
      return Object.freeze({ settlementId: "settlement-implicit-revocation", status: "PENDING" });
    },
  };
  const repository = {
    async getCommand() { return null; },
    async persistMutation(record) { persisted.push(record); },
  };
  const durable = new DurableOracleControlPlane({ controlPlane, repository, runtime, dualControl });
  await durable.beginSettlement({ actorId: "production-operator", idempotencyKey: "implicit-revocation", request: {} });
  assert.deepEqual(persisted[0].revocations, [{ attestationId, reasonHash: HASH_A, revokedAt: NOW.toISOString(), authorityId: "production-operator" }]);
});
test("a failed terminal alert boundary recovers without another outbox event", async () => {
  const { assembly, setRejectAlerts, alerts } = await productionFixture({ rejectAlerts: true });
  const event = assembly.runtime.outbox.enqueue({ eventType: "test", subjectId: "asset-alert-terminal", payloadHash: HASH_A, createdAt: NOW.toISOString() });
  assembly.runtime.outbox.markDurable(event.eventId);
  for (let attempt = 0; attempt < 5; attempt += 1) assembly.runtime.outbox.recordAttempt(event.eventId);
  const worker = assembly.startBackgroundWorkers({ intervalMs: 100 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(assembly.runtime.operationalState.alertingFailed, true);
  assert.equal(assembly.runtime.outbox.pending().length, 0);
  setRejectAlerts(false);
  await new Promise((resolve) => setTimeout(resolve, 150));
  worker.stop();
  assert.equal(alerts.filter(({ code }) => code === "OUTBOX_EVENT_DEAD_LETTERED").length >= 2, true);
  assert.equal(assembly.runtime.operationalState.alertingFailed, false);
  assert.deepEqual(await assembly.readinessCheck(), { ok: true });
});
test("ambiguous signer rotation persists recovery state before propagating failure", async () => {
  const runtime = createSyntheticRuntime({ clock: () => NOW });
  const dualControl = new DualControlQueue();
  dualControl.request({ actionId: "rotate", actionType: "SIGNER_ROTATE", subjectId: "old->new", payloadHash: HASH_A, requestedBy: "security-a", requestedAt: NOW.toISOString() });
  dualControl.approve("rotate", { approvedBy: "approver-b", approvedAt: NOW.toISOString() });
  dualControl.beginExecution("rotate", { actionType: "SIGNER_ROTATE", subjectId: "old->new", payloadHash: HASH_A, executedBy: "security-a", executionStartedAt: NOW.toISOString() });
  dualControl.markRecoveryRequired("rotate", { failedAt: NOW.toISOString(), errorCode: "SIGNER_ROTATION_OUTCOME_AMBIGUOUS" });
  const recoveryWrites = [];
  const durable = new DurableOracleControlPlane({
    controlPlane: {
      authorizeCommand() {},
      async executeSignerRotation() {
        runtime.operationalState.signerRecoveryRequired = true;
        throw new Error("SIGNER_ROTATION_OUTCOME_AMBIGUOUS");
      },
    },
    repository: {
      async getCommand() { return null; },
      async persistMutation() { throw new Error("SHOULD_NOT_COMPLETE"); },
      async persistRecoveryState(record) { recoveryWrites.push(record); },
    },
    runtime,
    dualControl,
  });
  await assert.rejects(() => durable.executeSignerRotation({ actorId: "security-a", idempotencyKey: "rotation-recovery", actionId: "rotate", fromSignerSetId: "old", toSignerSetId: "new", rotationDigest: HASH_A }), /SIGNER_ROTATION_OUTCOME_AMBIGUOUS/);
  assert.equal(recoveryWrites.length, 1);
  assert.equal(recoveryWrites[0].method, "executeSignerRotation");
  assert.equal(recoveryWrites[0].stateSnapshot.state.dualControl.actions[0].status, "RECOVERY_REQUIRED");
  const restoredRuntime = createSyntheticRuntime({ clock: () => NOW });
  const restoredDualControl = new DualControlQueue();
  restoreProductionState(restoredRuntime, restoredDualControl, recoveryWrites[0].stateSnapshot);
  assert.equal(restoredRuntime.operationalState.signerRecoveryRequired, true);
  assert.equal(restoredDualControl.list()[0].status, "RECOVERY_REQUIRED");
  assert.equal(runtime.operationalState.compromised, false);
});
