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

async function productionFixture({ failPersistence = false, initialSnapshot = null } = {}) {
  const [l2Profile, l3Profile] = await Promise.all([loadL2DeploymentProfile("config/l2.production.json"), loadProtocolProfile("config/l3.protocol.wd-0.1.1.json")]);
  const evidence = records("asset-production");
  const sourceById = new Map(l2Profile.sources.map((source) => [source.sourceId, source]));
  const recordBySource = { "authoritative-registry": evidence.asset, "authoritative-certificate": evidence.certificate, "authoritative-warehouse": evidence.warehouse };
  const persisted = [];
  let sourceFetches = 0;
  const commands = new Map();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const repository = {
    async loadStateSnapshot() { return initialSnapshot; },
    async getCommand(key) { return commands.get(key) ?? null; },
    async persistMutation(value) {
      if (failPersistence) throw new Error("db unavailable");
      persisted.push(value);
      commands.set(value.idempotencyKey, { commandHash: value.commandHash, status: "COMPLETED", result: value.result });
    },
  };
  const resolver = {
    async resolve(reference, kind) {
      if (kind === "repository") return repository;
      if (kind === "signer") return { signerSetId: "production-test-signers", signBytes: (bytes) => sign(null, bytes, privateKey), verifyBytes: (bytes, signature) => verify(null, bytes, publicKey, signature) };
      if (kind === "source") {
        const source = l2Profile.sources.find(({ transportRef }) => transportRef === reference);
        return { async fetchByFixedReference() { sourceFetches += 1; const record = recordBySource[source.sourceId]; return { authenticated: true, sourceId: source.sourceId, schemaVersion: source.schemaVersions[0], record, recordHash: evidenceHash(record) }; } };
      }
      if (kind === "admin-authenticator") return { async authenticate() { return { actorId: "production-operator", roles: ["ORACLE_OPERATOR"] }; } };
      return { kind, sourceById };
    },
  };
  const assembly = await assembleProductionApplication({
    config: { environment: "production", externalWritesEnabled: true }, l2Profile, l3Profile, resolver,
    settlementConfiguration: { profileId: "giraffe-settlement/production-v1", businessCalendarRef: "wenbao-production-v1", targetBusinessDays: 3, timeZone: "Asia/Shanghai", holidays: [] },
    clock: () => NOW,
  });
  await assembly.authenticateAdmin({ headers: {} });
  return { assembly, persisted, getSourceFetches: () => sourceFetches };
}

test("production assembly fetches three authenticated sources and persists the authoritative mutation", async () => {
  const { assembly, persisted, getSourceFetches } = await productionFixture();
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
