import assert from "node:assert/strict";
import test from "node:test";
import { evidenceHash } from "../src/domain/canonical-json.js";
import { AuthoritativeOracleControlPlane } from "../src/services/authoritative-control-plane.js";

const SOURCES = [
  { kind: "REGISTRY", sourceId: "registry" },
  { kind: "CERTIFICATE_AUTHORITY", sourceId: "certificates" },
  { kind: "WAREHOUSE", sourceId: "warehouse" },
];

const RECORDS = {
  registrySource: { sourceId: "registry", schemaVersion: "asset-record.v1", record: { assetId: "asset-fixed" } },
  certificateSource: { sourceId: "certificates", schemaVersion: "certificate-record.v1", record: { assetId: "asset-fixed", certificateHash: "a".repeat(64) } },
  warehouseSource: { sourceId: "warehouse", schemaVersion: "warehouse-record.v1", record: { assetId: "asset-fixed", warehouseReceiptHash: "b".repeat(64) } },
};

function delayedFixture() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetched = [];
  const sourceRecords = structuredClone(RECORDS);
  const sourcePorts = Object.fromEntries(Object.entries(sourceRecords).map(([name, value]) => [name, {
    async fetchByFixedReference(reference) {
      fetched.push({ name, reference });
      return { authenticated: true, sourceId: value.sourceId, schemaVersion: value.schemaVersion, record: value.record, recordHash: evidenceHash(value.record) };
    },
  }]));
  const controlPlane = {
    async executeResolved(method, commandInput, resolveInput) {
      assert.equal(Object.isFrozen(method === "verifyAsset" ? commandInput.evidenceReferences : commandInput.request), true);
      await gate;
      return resolveInput();
    },
  };
  return { authoritative: new AuthoritativeOracleControlPlane({ controlPlane, sourcePorts, sourceDefinitions: SOURCES }), fetched, release, sourceRecords };
}

test("authoritative verification snapshots fixed references before deferred resolution", async () => {
  const { authoritative, fetched, release } = delayedFixture();
  const evidenceReferences = { asset: "record:asset-original", certificate: "record:certificate-original", warehouse: "record:warehouse-original" };
  const pending = authoritative.verifyAsset({ actorId: "operator", idempotencyKey: "verify-fixed", evidenceReferences, evidenceVersion: 1 });
  evidenceReferences.asset = "record:asset-mutated";
  evidenceReferences.certificate = "record:certificate-mutated";
  evidenceReferences.warehouse = "record:warehouse-mutated";
  release();
  await pending;
  assert.deepEqual(fetched.map(({ reference }) => reference).sort(), ["record:asset-original", "record:certificate-original", "record:warehouse-original"]);
});

test("authoritative finalization snapshots references and rejects caller-derived confirmations", async () => {
  const { authoritative, fetched, release } = delayedFixture();
  const request = { settlementId: "settlement-fixed", snapshotHash: "c".repeat(64), evidenceVersion: 2, assetReference: "record:asset-original", certificateReference: "record:certificate-original", warehouseReference: "record:warehouse-original" };
  const pending = authoritative.finalizeSettlement({ actorId: "operator", idempotencyKey: "finalize-fixed", request });
  request.assetReference = "record:asset-mutated";
  request.certificateReference = "record:certificate-mutated";
  request.warehouseReference = "record:warehouse-mutated";
  release();
  await pending;
  assert.deepEqual(fetched.map(({ reference }) => reference).sort(), ["record:asset-original", "record:certificate-original", "record:warehouse-original"]);
  await assert.rejects(() => authoritative.finalizeSettlement({ actorId: "operator", idempotencyKey: "finalize-injected", request: { ...request, warehouseConfirmed: true } }), /AUTHORITATIVE_FINALIZATION_INPUT_INVALID/);
});
test("authenticated source records are detached from adapter-owned mutable objects", async () => {
  const { authoritative, release, sourceRecords } = delayedFixture();
  const pending = authoritative.verifyAsset({ actorId: "operator", idempotencyKey: "verify-detached", evidenceReferences: { asset: "record:asset", certificate: "record:certificate", warehouse: "record:warehouse" }, evidenceVersion: 1 });
  release();
  const resolved = await pending;
  sourceRecords.registrySource.record.assetId = "asset-mutated-after-authentication";
  assert.equal(resolved.asset.assetId, "asset-fixed");
  assert.equal(Object.isFrozen(resolved.asset), true);
});