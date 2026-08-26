import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";
import { AdminOperations } from "../src/services/admin-operations.js";
import { Authorizer } from "../src/services/authorizer.js";
import { CommandJournal } from "../src/services/command-journal.js";
import { DualControlQueue } from "../src/services/dual-control.js";
import { OracleControlPlane } from "../src/services/oracle-control-plane.js";

const HASH = "a".repeat(64);

function fixture() {
  const runtime = createSyntheticRuntime({ clock: () => new Date("2026-08-27T00:00:00.000Z") });
  const authorizer = new Authorizer();
  authorizer.registerActor("auditor", ["AUDITOR"]);
  authorizer.registerActor("security-a", ["SECURITY_OFFICER"]);
  authorizer.registerActor("approver-b", ["APPROVER"]);
  const dualControl = new DualControlQueue();
  const signerRotationBroker = { async rotate() { return { oldSignerRejected: true, newSignerAccepted: true, rotationAudited: true, auditChainVerified: true, dualApprovalVerified: true, timelockSeconds: 300, rollbackWindowSeconds: 3600, rollbackVerified: true, privateMaterialObserved: false, networkUsed: false, transactionSigned: false, evidenceSha256: HASH, rawSignature: "must-not-escape" }; } };
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

test("signer rotation delegates only after independent approval and validates broker result", async () => {
  const { runtime, controlPlane } = fixture();
  controlPlane.requestSignerRotation({ actorId: "security-a", actionId: "rotate-001", fromSignerSetId: "old", toSignerSetId: "new", rotationDigest: HASH });
  await assert.rejects(() => controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-001", fromSignerSetId: "old", toSignerSetId: "new", rotationDigest: HASH }), /DUAL_CONTROL_APPROVAL_REQUIRED/);
  controlPlane.approveAction({ actorId: "approver-b", actionId: "rotate-001" });
  const result = await controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-001", fromSignerSetId: "old", toSignerSetId: "new", rotationDigest: HASH });
  assert.equal(result.privateMaterialIncluded, false);
  assert.equal("rawSignature" in result, false);
  assert.equal(result.evidenceSha256, HASH);
  await assert.rejects(() => controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-001", fromSignerSetId: "old", toSignerSetId: "new", rotationDigest: HASH }), /DUAL_CONTROL_APPROVAL_REQUIRED/);
  assert.equal(runtime.auditJournal.list().at(-1).type, "signer.rotated");
});

test("signer rotation rejects malformed scope and incomplete broker evidence", async () => {
  const { authorizer, runtime } = fixture();
  const dualControl = new DualControlQueue();
  const controlPlane = new OracleControlPlane({
    runtime, authorizer, dualControl, commandJournal: new CommandJournal(), outbox: runtime.outbox,
    signerRotationBroker: { async rotate() { return { oldSignerRejected: true, newSignerAccepted: true }; } },
  });
  assert.throws(() => controlPlane.requestSignerRotation({ actorId: "security-a", actionId: "bad", fromSignerSetId: "same", toSignerSetId: "same", rotationDigest: HASH }), /SIGNER_ROTATION_REQUEST_INVALID/);
  controlPlane.requestSignerRotation({ actorId: "security-a", actionId: "rotate-incomplete", fromSignerSetId: "old", toSignerSetId: "new", rotationDigest: HASH });
  controlPlane.approveAction({ actorId: "approver-b", actionId: "rotate-incomplete" });
  await assert.rejects(() => controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-incomplete", fromSignerSetId: "old", toSignerSetId: "new", rotationDigest: HASH }), /SIGNER_ROTATION_BROKER_RESULT_INVALID/);
});

test("controlled action failure never persists a dependency message", async () => {
  const { authorizer, runtime } = fixture();
  const dualControl = new DualControlQueue();
  const controlPlane = new OracleControlPlane({
    runtime, authorizer, dualControl, commandJournal: new CommandJournal(), outbox: runtime.outbox,
    signerRotationBroker: { async rotate() { throw new Error("credential leaked at C:\\private\\signer.key"); } },
  });
  controlPlane.requestSignerRotation({ actorId: "security-a", actionId: "rotate-secret", fromSignerSetId: "old", toSignerSetId: "new", rotationDigest: HASH });
  controlPlane.approveAction({ actorId: "approver-b", actionId: "rotate-secret" });
  await assert.rejects(() => controlPlane.executeSignerRotation({ actorId: "security-a", actionId: "rotate-secret", fromSignerSetId: "old", toSignerSetId: "new", rotationDigest: HASH }));
  const action = dualControl.list()[0];
  assert.equal(action.status, "FAILED");
  assert.equal(action.errorCode, "SIGNER_ROTATION_FAILED");
  assert.equal(JSON.stringify(action).includes("private"), false);
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
