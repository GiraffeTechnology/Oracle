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

const NOW = new Date("2026-08-24T00:00:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function controlFixture() {
  const runtime = createSyntheticRuntime({ clock: () => NOW });
  const authorizer = new Authorizer();
  authorizer.registerActor("oracle-a", ["ORACLE_OPERATOR", "SECURITY_OFFICER"]);
  authorizer.registerActor("approver-b", ["APPROVER"]);
  authorizer.registerActor("reader-c", ["READER"]);
  const outbox = new Outbox();
  const control = new OracleControlPlane({ runtime, authorizer, dualControl: new DualControlQueue(), commandJournal: new CommandJournal(), outbox, clock: () => NOW });
  return { runtime, authorizer, outbox, control };
}

test("control plane verifies an asset idempotently and rejects unauthorized actor", () => {
  const { control } = controlFixture();
  const command = {
    actorId: "oracle-a",
    idempotencyKey: "verify-001",
    asset: { assetId: "asset-001", assetFingerprintHash: HASH_A, registryRef: "registry-001" },
    certificate: { assetId: "asset-001", certificateHash: HASH_B, certificateVersion: 1 },
    warehouse: { assetId: "asset-001", warehouseReceiptHash: HASH_C, warehouseStatus: "HELD" },
    evidenceVersion: 1,
  };
  assert.equal(control.verifyAsset(command).result.status, "VALID");
  assert.equal(control.verifyAsset(command).replayed, true);
  assert.throws(() => control.verifyAsset({ ...command, actorId: "reader-c", idempotencyKey: "verify-002" }), /PERMISSION_DENIED/);
});

test("failed asset verification leaves no partial in-memory records", () => {
  const { control, runtime } = controlFixture();
  assert.throws(
    () => control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-bad", asset: { assetId: "asset-bad", assetFingerprintHash: HASH_A }, certificate: { assetId: "asset-bad", certificateHash: HASH_B, certificateVersion: 2 }, warehouse: { assetId: "asset-bad", warehouseReceiptHash: HASH_C }, evidenceVersion: 1 }),
    /CERTIFICATE_INITIAL_VERSION_INVALID/,
  );
  assert.equal(runtime.recordStore.getAsset("asset-bad"), null);
  assert.equal(runtime.recordStore.getWarehouse("asset-bad"), null);
});

test("attestation revocation requires independent approval", () => {
  const { control } = controlFixture();
  control.verifyAsset({
    actorId: "oracle-a",
    idempotencyKey: "verify-001",
    asset: { assetId: "asset-001", assetFingerprintHash: HASH_A, registryRef: "registry-001" },
    certificate: { assetId: "asset-001", certificateHash: HASH_B, certificateVersion: 1 },
    warehouse: { assetId: "asset-001", warehouseReceiptHash: HASH_C, warehouseStatus: "HELD" },
    evidenceVersion: 1,
  });
  const issued = control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-001", request: { subject: { assetId: "asset-001", purpose: "transfer-eligibility" }, factType: "TRANSFER_STATUS", factValue: "VALID", sourceRecordHash: HASH_A, validForSeconds: 60, nonce: "attestation-nonce-001" } }).result;
  control.requestRevocation({ actorId: "oracle-a", actionId: "revoke-001", attestationId: issued.envelope.attestationId, reasonHash: HASH_C });
  assert.throws(() => control.executeRevocation({ actorId: "oracle-a", actionId: "revoke-001", attestationId: issued.envelope.attestationId, reasonHash: HASH_C }), /APPROVAL_REQUIRED/);
  control.approveAction({ actorId: "approver-b", actionId: "revoke-001" });
  assert.equal(control.executeRevocation({ actorId: "oracle-a", actionId: "revoke-001", attestationId: issued.envelope.attestationId, reasonHash: HASH_C }).attestationId, issued.envelope.attestationId);
});

test("token binding is one-to-one and idempotent", () => {
  const { control, runtime } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-001", asset: { assetId: "asset-001", assetFingerprintHash: HASH_A }, certificate: { assetId: "asset-001", certificateHash: HASH_B, certificateVersion: 1 }, warehouse: { assetId: "asset-001", warehouseReceiptHash: HASH_C }, evidenceVersion: 1 });
  const command = { actorId: "oracle-a", idempotencyKey: "bind-001", binding: { chainId: "test-chain", contract: "contract-001", tokenId: "1", assetId: "asset-001" } };
  assert.equal(control.bindToken(command).result.assetId, "asset-001");
  assert.equal(control.bindToken(command).replayed, true);
  assert.equal(runtime.tokenIndex.byAsset("asset-001").tokenId, "1");
  assert.throws(() => runtime.tokenIndex.bind({ chainId: "test-chain", contract: "contract-001", tokenId: "2", assetId: "asset-001" }), /ASSET_ALREADY_TOKENIZED/);
});

test("attestation service rejects duplicate nonces", () => {
  const { control } = controlFixture();
  control.verifyAsset({ actorId: "oracle-a", idempotencyKey: "verify-001", asset: { assetId: "asset-001", assetFingerprintHash: HASH_A }, certificate: { assetId: "asset-001", certificateHash: HASH_B, certificateVersion: 1 }, warehouse: { assetId: "asset-001", warehouseReceiptHash: HASH_C }, evidenceVersion: 1 });
  const request = { subject: { assetId: "asset-001", purpose: "transfer-eligibility" }, factType: "TRANSFER_STATUS", factValue: "VALID", sourceRecordHash: HASH_A, validForSeconds: 60, nonce: "same-nonce" };
  control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-001", request });
  assert.throws(() => control.issueAttestation({ actorId: "oracle-a", idempotencyKey: "issue-002", request }), /ATTESTATION_NONCE_REUSED/);
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
