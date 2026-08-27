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

async function productionFixture({ failPersistence = false, initialSnapshot = null, persistenceGate = null, omitSignerPolicy = false } = {}) {
  const [l2Profile, l3Profile] = await Promise.all([loadL2DeploymentProfile("config/l2.production.json"), loadProtocolProfile("config/l3.protocol.wd-0.1.1.json")]);
  const evidence = records("asset-production");
  const sourceById = new Map(l2Profile.sources.map((source) => [source.sourceId, source]));
  const recordBySource = { "authoritative-registry": evidence.asset, "authoritative-certificate": evidence.certificate, "authoritative-warehouse": evidence.warehouse };
  const persisted = [];
  const published = [];
  let sourceFetches = 0;
  let markPersistStarted;
  const persistStarted = new Promise((resolve) => { markPersistStarted = resolve; });
  const commands = new Map();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const repository = {
    async loadStateSnapshot() { return initialSnapshot; },
    async getCommand(key) { return commands.get(key) ?? null; },
    async persistMutation(value) {
      markPersistStarted();
      if (persistenceGate) await persistenceGate;
      if (failPersistence) throw new Error("db unavailable");
      persisted.push(value);
      commands.set(value.idempotencyKey, { commandHash: value.commandHash, status: "COMPLETED", result: value.result });
    },
  };
  const resolver = {
    async resolve(reference, kind) {
      if (kind === "repository") return repository;
      if (kind === "signer") return { signerSetId: "production-test-signers", ...(omitSignerPolicy ? {} : { signerPolicy: new SignerSetPolicy({ signerSetId: "production-test-signers", threshold: 1, signers: ["production-test-signer"], environment: "production" }) }), signBytes: (bytes) => sign(null, bytes, privateKey), verifyBytes: (bytes, signature) => verify(null, bytes, publicKey, signature), verifyHistoricalBytes: (signerSetId, bytes, signature) => signerSetId === "production-test-signers" && verify(null, bytes, publicKey, signature), async rotate() { throw new Error("NOT_USED"); }, async reconcile() { throw new Error("NOT_USED"); }, async activateRuntime() { throw new Error("NOT_USED"); } };
      if (kind === "source") {
        const source = l2Profile.sources.find(({ transportRef }) => transportRef === reference);
        return { async fetchByFixedReference() { sourceFetches += 1; const record = recordBySource[source.sourceId]; return { authenticated: true, sourceId: source.sourceId, schemaVersion: source.schemaVersions[0], record, recordHash: evidenceHash(record) }; } };
      }
      if (kind === "admin-authenticator") return { async authenticate() { return { actorId: "production-operator", roles: ["ORACLE_OPERATOR"] }; } };
      if (kind === "event-publisher") return { async publish(event) { published.push(event); } };
      if (kind === "monitoring") return { async checkReadiness() { return { ok: true }; } };
      return { kind, sourceById };
    },
  };
  const assembly = await assembleProductionApplication({
    config: { environment: "production", externalWritesEnabled: true }, l2Profile, l3Profile, resolver,
    settlementConfiguration: { profileId: "giraffe-settlement/production-v1", businessCalendarRef: "wenbao-production-v1", targetBusinessDays: 3, timeZone: "Asia/Shanghai", holidays: [] },
    clock: () => NOW,
  });
  await assembly.authenticateAdmin({ headers: {} });
  return { assembly, persisted, published, persistStarted, getSourceFetches: () => sourceFetches };
}

test("production assembly fetches three authenticated sources and persists the authoritative mutation", async () => {
  const { assembly, persisted, published, getSourceFetches } = await productionFixture();
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
