import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";
import { AdminOperations } from "../src/services/admin-operations.js";
import { Authorizer } from "../src/services/authorizer.js";
import { CommandJournal } from "../src/services/command-journal.js";
import { DualControlQueue } from "../src/services/dual-control.js";
import { OracleControlPlane } from "../src/services/oracle-control-plane.js";

const HASH = "a".repeat(64);
const ACTIVE_SIGNER_SET = "synthetic-oracle-signers";

function activateSyntheticRuntime({ fromSignerSetId, toSignerSetId, attestationService }) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return attestationService.activateSignerBackend({ signerSetId: toSignerSetId, signBytes: (bytes) => sign(null, bytes, privateKey), verifyBytes: (bytes, signature) => verify(null, bytes, publicKey, signature) }, fromSignerSetId);
}

function fixture() {
  const runtime = createSyntheticRuntime({ clock: () => new Date("2026-08-27T00:00:00.000Z") });
  const authorizer = new Authorizer();
  authorizer.registerActor("auditor", ["AUDITOR"]);
  authorizer.registerActor("security-a", ["SECURITY_OFFICER"]);
  authorizer.registerActor("approver-b", ["APPROVER"]);
  const dualControl = new DualControlQueue();
  const signerRotationBroker = { async rotate() { return { oldSignerRejected: true, newSignerAccepted: true, rotationAudited: true, auditChainVerified: true, dualApprovalVerified: true, timelockSeconds: 300, rollbackWindowSeconds: 3600, rollbackVerified: true, privateMaterialObserved: false, networkUsed: false, transactionSigned: false, evidenceSha256: HASH, rawSignature: "must-not-escape" }; }, async activateRuntime(scope) { return activateSyntheticRuntime(scope); } };
  const controlPlane = new OracleControlPlane({ runtime, authorizer, dualControl, commandJournal: new CommandJournal(), outbox: runtime.outbox, signerRotationBroker, clock: () => new Date("2026-08-27T00:00:00.000Z") });
  const adminOperations = new AdminOperations({ runtime, sourceRegistry: runtime.sourceRegistry, authorizer, reviewQueue: runtime.reviewQueue, dualControl, clock: () => new Date("2026-08-27T00:00:00.000Z") });
  return { runtime, authorizer, dualControl, controlPlane, adminOperations };
}

test("authenticated admin snapshot exposes operational facts without private material", async () => {
  const { runtime, adminOperations } = fixture();
  runtime.reviewQueue.enqueue({ reviewId: "review-001", subjectId: "asset-001", findingCodes: ["SOURCE_CONFLICT"], evidenceHash: HASH, createdAt: "2026-08-27T00:00:00.000Z" });
  const snapshot = await adminOperations.snapshot("auditor");
  assert.equal(snapshot.sources.length, 3);
  assert.equal(snapshot.reviewQueue.length, 1);
  assert.equal(snapshot.signerSet.privateMaterialIncluded, false);
  assert.equal(snapshot.controlledActions.length, 0);
  assert.equal(snapshot.audit.chainVerified, true);
  assert.equal(JSON.stringify(snapshot).includes("privateKey"), false);
  runtime.auditJournal.append({ type: "test.audit", subjectId: "asset-001", payloadHash: HASH, actorId: "auditor", occurredAt: "2026-08-27T00:00:00.000Z" });
  const exported = await adminOperations.exportAudit("auditor", "regulatory-audit");
  assert.equal(exported.manifest.recordCount, 1);
  assert.equal(runtime.auditJournal.list().at(-1).type, "audit.exported");
  assert.equal(exported.records.some((event) => event.type === "audit.exported"), false);
  await assert.rejects(() => adminOperations.exportAudit("auditor", "financial-analysis"), /EXPORT_PURPOSE_INVALID/);
});

test("source disable requires an independent approval", () => {
  const { runtime, controlPlane } = fixture();
  controlPlane.requestSourceDisable({ actorId: "security-a", actionId: "disable-001", sourceId: "synthetic-registry", reasonHash: HASH });
  assert.throws(() => controlPlane.executeSourceDisable({ actorId: "security-a", actionId: "disable-001", sourceId: "synthetic-registry", reasonHash: HASH }), /DUAL_CONTROL_APPROVAL_REQUIRED/);
  controlPlane.approveAction({ actorId: "approver-b", actionId: "disable-001" });
  assert.equal(controlPlane.executeSourceDisable({ actorId: "security-a", actionId: "disable-001", sourceId: "synthetic-registry", reasonHash: HASH }).active, false);
  assert.throws(() => controlPlane.executeSourceDisable({ actorId: "security-a", actionId: "disable-001", sourceId: "synthetic-registry", reasonHash: HASH }), /DUAL_CONTROL_APPROVAL_REQUIRED/);
  assert.equal(runtime.auditJournal.list().at(-1).type, "source.disabled");
});

test("source disable phases replay exact idempotency results", () => {
  const { controlPlane } = fixture();
  const request = { actorId: "security-a", idempotencyKey: "disable-request-idem", actionId: "disable-idem", sourceId: "synthetic-registry", reasonHash: HASH };
  assert.equal(controlPlane.requestSourceDisable(request).replayed, false);
  assert.equal(controlPlane.requestSourceDisable(request).replayed, true);
  const approval = { actorId: "approver-b", idempotencyKey: "disable-approve-idem", actionId: "disable-idem" };
  assert.equal(controlPlane.approveAction(approval).replayed, false);
  assert.equal(controlPlane.approveAction(approval).replayed, true);
  const execute = { actorId: "security-a", idempotencyKey: "disable-execute-idem", actionId: "disable-idem", sourceId: "synthetic-registry", reasonHash: HASH };
  assert.equal(controlPlane.executeSourceDisable(execute).replayed, false);
  assert.equal(controlPlane.executeSourceDisable(execute).replayed, true);
});

test("signer rotation delegates only after independent approval and validates broker result", async () => {
  const { runtime, controlPlane } = fixture();
  const oldAttestation = runtime.attestations.issue({ subject: { assetId: "asset-signer", chainId: "hoodi", contract: "contract-signer", tokenId: "1", purpose: "provenance" }, factType: "SOURCE_STATUS", factValue: "VALID", sourceAuthority: "synthetic-registry", sourceRecordHash: HASH, validForSeconds: 60, nonce: "before-rotation" });
  controlPlane.requestSignerRotation({ actorId: "security-a", actionId: "rotate-001", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH });
  await assert.rejects(() => controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-001", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH }), /DUAL_CONTROL_APPROVAL_REQUIRED/);
  controlPlane.approveAction({ actorId: "approver-b", actionId: "rotate-001" });
  const result = await controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-001", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH });
  assert.equal(result.privateMaterialIncluded, false);
  assert.equal("rawSignature" in result, false);
  assert.equal(result.evidenceSha256, HASH);
  assert.equal(runtime.attestations.signerSetId, "new");
  assert.equal(runtime.attestations.verify(oldAttestation).errorCode, "SIGNATURE_INVALID");
  const newAttestation = runtime.attestations.issue({ subject: { assetId: "asset-signer", chainId: "hoodi", contract: "contract-signer", tokenId: "1", purpose: "provenance" }, factType: "SOURCE_STATUS", factValue: "VALID", sourceAuthority: "synthetic-registry", sourceRecordHash: HASH, validForSeconds: 60, nonce: "after-rotation" });
  assert.equal(newAttestation.envelope.signerSetId, "new");
  assert.equal(runtime.attestations.verify(newAttestation).valid, true);
  await assert.rejects(() => controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-001", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH }), /SIGNER_ROTATION_SOURCE_NOT_ACTIVE/);
  assert.equal(runtime.auditJournal.list().at(-1).type, "signer.rotated");
});

test("signer rotation phases replay exact idempotency results after activation", async () => {
  const { controlPlane } = fixture();
  const request = { actorId: "security-a", idempotencyKey: "rotate-request-idem", actionId: "rotate-idem", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH };
  assert.equal(controlPlane.requestSignerRotation(request).replayed, false);
  assert.equal(controlPlane.requestSignerRotation(request).replayed, true);
  const approval = { actorId: "approver-b", idempotencyKey: "rotate-approve-idem", actionId: "rotate-idem" };
  controlPlane.approveAction(approval);
  assert.equal(controlPlane.approveAction(approval).replayed, true);
  const execute = { actorId: "security-a", idempotencyKey: "rotate-execute-idem", actionId: "rotate-idem", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH };
  assert.equal((await controlPlane.executeSignerRotation(execute)).replayed, false);
  assert.equal((await controlPlane.executeSignerRotation(execute)).replayed, true);
});

test("signer rotation rejects malformed scope and incomplete broker evidence", async () => {
  const { authorizer, runtime } = fixture();
  const dualControl = new DualControlQueue();
  const controlPlane = new OracleControlPlane({
    runtime, authorizer, dualControl, commandJournal: new CommandJournal(), outbox: runtime.outbox,
    signerRotationBroker: { async rotate() { return { oldSignerRejected: true, newSignerAccepted: true }; } },
  });
  assert.throws(() => controlPlane.requestSignerRotation({ actorId: "security-a", actionId: "bad", fromSignerSetId: "same", toSignerSetId: "same", rotationDigest: HASH }), /SIGNER_ROTATION_REQUEST_INVALID/);
  controlPlane.requestSignerRotation({ actorId: "security-a", actionId: "rotate-incomplete", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH });
  controlPlane.approveAction({ actorId: "approver-b", actionId: "rotate-incomplete" });
  await assert.rejects(() => controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-incomplete", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH }), /SIGNER_ROTATION_BROKER_RESULT_INVALID/);
});

test("controlled action failure never persists a dependency message", async () => {
  const { authorizer, runtime } = fixture();
  const dualControl = new DualControlQueue();
  const controlPlane = new OracleControlPlane({
    runtime, authorizer, dualControl, commandJournal: new CommandJournal(), outbox: runtime.outbox,
    signerRotationBroker: { async rotate() { throw new Error("credential leaked at C:\\private\\signer.key"); } },
  });
  controlPlane.requestSignerRotation({ actorId: "security-a", actionId: "rotate-secret", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH });
  controlPlane.approveAction({ actorId: "approver-b", actionId: "rotate-secret" });
  await assert.rejects(() => controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-secret", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH }));
  const action = dualControl.list()[0];
  assert.equal(action.status, "RECOVERY_REQUIRED");
  assert.equal(action.errorCode, "SIGNER_ROTATION_RECOVERY_REQUIRED");
  assert.equal(JSON.stringify(action).includes("private"), false);
});

test("ambiguous signer rotation is reconciled without replaying rotation", async () => {
  const { authorizer, runtime } = fixture();
  const dualControl = new DualControlQueue();
  let rotateCalls = 0;
  let reconcileCalls = 0;
  const evidence = { oldSignerRejected: true, newSignerAccepted: true, rotationAudited: true, auditChainVerified: true, dualApprovalVerified: true, timelockSeconds: 300, rollbackWindowSeconds: 3600, rollbackVerified: true, privateMaterialObserved: false, networkUsed: false, transactionSigned: false, evidenceSha256: HASH };
  const controlPlane = new OracleControlPlane({ runtime, authorizer, dualControl, commandJournal: new CommandJournal(), outbox: runtime.outbox, signerRotationBroker: {
    async rotate() { rotateCalls += 1; throw new Error("response lost after apply"); },
    async reconcile() { reconcileCalls += 1; return { applied: true, ...evidence }; },
    async activateRuntime(scope) { return activateSyntheticRuntime(scope); },
  } });
  controlPlane.requestSignerRotation({ actorId: "security-a", actionId: "rotate-recovery", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH });
  controlPlane.approveAction({ actorId: "approver-b", actionId: "rotate-recovery" });
  await assert.rejects(() => controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-recovery", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH }));
  assert.equal(dualControl.list()[0].status, "RECOVERY_REQUIRED");
  const result = await controlPlane.reconcileSignerRotation({ actorId: "security-a", actionId: "rotate-recovery", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH });
  assert.equal(result.applied, true);
  assert.equal(dualControl.list()[0].status, "EXECUTED");
  assert.equal(rotateCalls, 1);
  assert.equal(reconcileCalls, 1);
  assert.equal(runtime.attestations.signerSetId, "new");
});

test("signer reconciliation requires an affirmative applied result", async () => {
  const { authorizer, runtime } = fixture();
  const dualControl = new DualControlQueue();
  const evidence = { oldSignerRejected: true, newSignerAccepted: true, rotationAudited: true, auditChainVerified: true, dualApprovalVerified: true, timelockSeconds: 300, rollbackWindowSeconds: 3600, rollbackVerified: true, privateMaterialObserved: false, networkUsed: false, transactionSigned: false, evidenceSha256: HASH };
  const controlPlane = new OracleControlPlane({ runtime, authorizer, dualControl, commandJournal: new CommandJournal(), outbox: runtime.outbox, signerRotationBroker: {
    async rotate() { throw new Error("response lost after apply"); },
    async reconcile() { return evidence; },
  } });
  controlPlane.requestSignerRotation({ actorId: "security-a", actionId: "rotate-unresolved", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH });
  controlPlane.approveAction({ actorId: "approver-b", actionId: "rotate-unresolved" });
  await assert.rejects(() => controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-unresolved", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH }));
  await assert.rejects(() => controlPlane.reconcileSignerRotation({ actorId: "security-a", actionId: "rotate-unresolved", fromSignerSetId: ACTIVE_SIGNER_SET, toSignerSetId: "new", rotationDigest: HASH }), /SIGNER_ROTATION_RECONCILIATION_UNRESOLVED/);
  assert.equal(dualControl.list()[0].status, "RECOVERY_REQUIRED");
  assert.equal(runtime.attestations.signerSetId, ACTIVE_SIGNER_SET);
});

test("admin dashboard API requires authentication and rejects cross-origin writes", async () => {
  const { runtime, controlPlane, adminOperations } = fixture();
  const config = loadConfig({ GIRAFFE_ORACLE_ENV: "test", GIRAFFE_ORACLE_EXTERNAL_WRITES: "true", GIRAFFE_ORACLE_TEST_WRITE_ACK: "synthetic-only" });
  let authenticated = false;
  const server = createApp({ config, sourceRegistry: runtime.sourceRegistry, runtime, controlPlane, adminOperations, authenticateAdmin: async () => authenticated ? "auditor" : null });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    const base = `http://localhost:${server.address().port}`;
    assert.equal((await fetch(`${base}/v1/rwa/admin/dashboard`)).status, 401);
    authenticated = true;
    const dashboard = await fetch(`${base}/v1/rwa/admin/dashboard`);
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json()).result.audit.chainVerified, true);
    const rejected = await fetch(`${base}/v1/rwa/admin/actions/approve`, { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.invalid" }, body: "{}" });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).errorCode, "CSRF_ORIGIN_REJECTED");
    const missingHeader = await fetch(`${base}/v1/rwa/admin/actions/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(missingHeader.status, 400);
    assert.equal((await missingHeader.json()).errorCode, "CSRF_REQUEST_HEADER_REQUIRED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
