import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { canonicalJson } from "../src/domain/canonical-json.js";
import { KeySetRegistry } from "../src/domain/key-set-registry.js";
import { createDefaultSchemaRegistry } from "../src/domain/schema-registry.js";
import { SourceRegistry } from "../src/domain/source-registry.js";
import { assertProductionPorts } from "../src/ports/production-ports.js";
import { BusinessCalendar } from "../src/services/business-calendar.js";
import { createBackupManifest, verifyBackupManifest } from "../src/services/backup-manifest.js";
import { DualControlQueue } from "../src/services/dual-control.js";
import { IngestionGateway } from "../src/services/ingestion-gateway.js";
import { Metrics } from "../src/services/metrics.js";
import { Outbox } from "../src/services/outbox.js";
import { Reconciler } from "../src/services/reconciler.js";
import { RetentionPolicy } from "../src/services/retention-policy.js";

const NOW = new Date("2026-08-24T00:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function ingestionFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const sources = new SourceRegistry([{ id: "approved-registry", displayName: "Approved Registry", kind: "REGISTRY", keySetId: "approved-keys", schemaVersions: ["asset-record.v1"], active: true }]);
  const keys = new KeySetRegistry();
  keys.register({ keySetId: "approved-keys", publicKey, validFrom: "2026-01-01T00:00:00.000Z" });
  const gateway = new IngestionGateway({ sourceRegistry: sources, schemaRegistry: createDefaultSchemaRegistry(), keySetRegistry: keys, clock: () => NOW });
  const envelope = {
    sourceId: "approved-registry",
    schemaVersion: "asset-record.v1",
    issuedAt: NOW.toISOString(),
    nonce: "nonce-001",
    idempotencyKey: "idem-001",
    payload: {
      assetId: "asset-001",
      wenbaoRegistryRef: "registry-001",
      assetFingerprintHash: HASH_A,
      classificationCode: "synthetic-artwork",
      transferEligibility: "VALID",
      warehouseId: "synthetic-warehouse",
      warehouseReceiptHash: HASH_C,
      currentCertificateHash: HASH_B,
      currentCertificateVersion: 1,
      currentOwnerCommitment: HASH_B,
      encumbranceStatus: "CLEAR",
      oracleStatus: "VALID",
      updatedAt: NOW.toISOString(),
    },
  };
  const signature = sign(null, Buffer.from(canonicalJson(envelope)), privateKey).toString("base64url");
  return { gateway, envelope, signature, keys };
}

test("signed ingestion authenticates, redacts and is idempotent", () => {
  const { gateway, envelope, signature } = ingestionFixture();
  const first = gateway.ingest({ envelope, signature });
  assert.equal(first.replayed, false);
  assert.equal(first.publicPayload.currentOwnerCommitment, undefined);
  assert.equal(first.publicPayload.warehouseId, undefined);
  assert.equal(gateway.ingest({ envelope, signature }).replayed, true);
});

test("ingestion rejects signature, replay and caller-controlled endpoint", () => {
  const { gateway, envelope, signature } = ingestionFixture();
  assert.throws(() => gateway.ingest({ envelope, signature: `${signature}x` }), /INGESTION_SIGNATURE_INVALID/);
  assert.throws(() => gateway.ingest({ envelope: { ...envelope, endpoint: "https://example.invalid" }, signature }), /CALLER_CONTROLLED_FIELD_REJECTED/);
  gateway.ingest({ envelope, signature });
  const changed = { ...envelope, idempotencyKey: "idem-002" };
  const { privateKey } = generateKeyPairSync("ed25519");
  const wrongSignature = sign(null, Buffer.from(canonicalJson(changed)), privateKey).toString("base64url");
  assert.throws(() => gateway.ingest({ envelope: changed, signature: wrongSignature }), /INGESTION_SIGNATURE_INVALID/);
});

test("revoked source key sets fail closed", () => {
  const { gateway, envelope, signature, keys } = ingestionFixture();
  keys.replace("approved-keys", "REVOKED");
  assert.throws(() => gateway.ingest({ envelope, signature }), /KEY_SET_NOT_ACTIVE/);
});

test("business calendar skips weekends and configured holidays", () => {
  const calendar = new BusinessCalendar({ calendarId: "wenbao-v1", timeZone: "Asia/Shanghai", holidays: ["2026-08-25"] });
  assert.equal(calendar.addBusinessDays(new Date("2026-08-21T00:00:00.000Z"), 2).toISOString().slice(0, 10), "2026-08-26");
});

test("dual control rejects self approval and scope changes", () => {
  const queue = new DualControlQueue();
  queue.request({ actionId: "action-001", actionType: "ATTESTATION_REVOKE", subjectId: "asset-001", payloadHash: HASH_A, requestedBy: "operator-a", requestedAt: NOW.toISOString() });
  assert.throws(() => queue.approve("action-001", { approvedBy: "operator-a", approvedAt: NOW.toISOString() }), /SELF_APPROVAL/);
  queue.approve("action-001", { approvedBy: "operator-b", approvedAt: NOW.toISOString() });
  assert.throws(() => queue.requireApproved("action-001", "ATTESTATION_REVOKE", "asset-001", HASH_B), /SCOPE_MISMATCH/);
  assert.equal(queue.requireApproved("action-001", "ATTESTATION_REVOKE", "asset-001", HASH_A).status, "APPROVED");
});

test("outbox delivery is ordered, retryable and idempotently acknowledged", () => {
  const outbox = new Outbox();
  const first = outbox.enqueue({ eventType: "asset.verified", subjectId: "asset-001", payloadHash: HASH_A, createdAt: "2026-08-24T00:00:00.000Z" });
  outbox.enqueue({ eventType: "asset.frozen", subjectId: "asset-002", payloadHash: HASH_B, createdAt: "2026-08-24T00:01:00.000Z" });
  assert.equal(outbox.pending(1)[0].eventId, first.eventId);
  assert.equal(outbox.recordAttempt(first.eventId).attempts, 1);
  const published = outbox.markPublished(first.eventId, NOW.toISOString());
  assert.deepEqual(outbox.markPublished(first.eventId, NOW.toISOString()), published);
  assert.equal(outbox.pending().length, 1);
});

test("reconciler reports all mismatched authoritative projections", () => {
  const result = new Reconciler().reconcileAsset({
    assetId: "asset-001",
    registry: { registryRefHash: HASH_A },
    certificate: { assetId: "asset-001", certificateHash: HASH_B },
    warehouse: { assetId: "asset-001", warehouseReceiptHash: HASH_C },
    oracle: { assetId: "asset-001", registryRefHash: HASH_C, certificateHash: HASH_A, warehouseReceiptHash: HASH_B },
  });
  assert.equal(result.consistent, false);
  assert.deepEqual(result.findings, ["CERTIFICATE_HASH_MISMATCH", "REGISTRY_REF_MISMATCH", "WAREHOUSE_HASH_MISMATCH"]);
  assert.equal(result.reconciliationHash.length, 64);
});

test("metrics expose numeric counters and gauges only", () => {
  const metrics = new Metrics();
  metrics.increment("ingestion_accepted_total");
  metrics.gauge("outbox_pending", 3);
  assert.deepEqual(metrics.snapshot(), { counters: { ingestion_accepted_total: 1 }, gauges: { outbox_pending: 3 } });
  assert.throws(() => metrics.increment("bad.metric"), /METRIC_INVALID/);
});

test("production ports fail closed when any dependency is absent", () => {
  assert.throws(() => assertProductionPorts({}), /PRODUCTION_PORT_MISSING:repository/);
  assert.equal(assertProductionPorts({ repository: {}, signer: {}, registrySource: {}, certificateSource: {}, warehouseSource: {}, eventPublisher: {} }), true);
});

test("backup manifest detects tampering", () => {
  const candidate = createBackupManifest({ backupId: "backup-001", createdAt: NOW.toISOString(), databaseSnapshotHash: HASH_A, auditHeadHash: HASH_B, schemaVersion: "oracle-db.v1", recordCounts: { assets: 1, certificates: 1 } });
  assert.equal(verifyBackupManifest(candidate), true);
  assert.equal(verifyBackupManifest({ ...candidate, manifest: { ...candidate.manifest, databaseSnapshotHash: HASH_C } }), false);
});

test("retention policy calculates versioned expiry dates", () => {
  const policy = new RetentionPolicy({ policyId: "retention-v1", evidenceDays: 30, auditDays: 3650, identityDays: 90 });
  assert.equal(policy.expiresAt("evidence", NOW).toISOString(), "2026-09-23T00:00:00.000Z");
  assert.throws(() => policy.expiresAt("unknown", NOW), /RETENTION_KIND_INVALID/);
});
