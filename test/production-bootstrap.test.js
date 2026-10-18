test("Stage D certificate conflict leaves pending settlement and original certificate unchanged", async () => {
  const { assembly, persisted, setSourceRecord } = await productionFixture();
  await assembly.controlPlane.verifyAsset({
    actorId: "production-operator",
    idempotencyKey: "stage-d-conflict-verify",
    evidenceReferences: { asset: "record:asset-001", certificate: "record:certificate-001", warehouse: "record:warehouse-001" },
    evidenceVersion: 1,
  });
  await assembly.controlPlane.bindToken({
    actorId: "production-operator",
    idempotencyKey: "stage-d-conflict-bind",
    binding: { assetId: "asset-production", chainId: "560048", contract: "test-only", tokenId: "1" },
  });
  const pending = await assembly.controlPlane.beginSettlement({
    actorId: "production-operator",
    idempotencyKey: "stage-d-conflict-begin",
    request: {
      settlementId: "stage-d-conflict-settlement",
      assetId: "asset-production",
      token: { chainId: "560048", contract: "test-only", tokenId: "1" },
      sellerWallet: "seller-test",
      buyerWallet: "buyer-test",
      externalExecutionRef: "synthetic-certificate-conflict-001",
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
  const scope = { settlementId: pending.result.settlementId, settlementSnapshotHash: pending.result.snapshotHash, settlementBuyerCommitment: buyerCommitment };
  Object.assign(next.asset, scope);
  Object.assign(next.certificate, scope, { certificateVersion: 2, certificateHash: HASH_A, previousCertificateHash: HASH_B, wenbaoChangeRef: "synthetic-registry-change-conflict" });
  Object.assign(next.warehouse, scope, { holderCommitment: HASH_B });
  next.asset.currentCertificateHash = HASH_C;
  setSourceRecord("authoritative-registry", next.asset);
  setSourceRecord("authoritative-certificate", next.certificate);
  setSourceRecord("authoritative-warehouse", next.warehouse);

  await assert.rejects(
    () => assembly.controlPlane.finalizeSettlement({
      actorId: "production-operator",
      idempotencyKey: "stage-d-conflict-finalize",
      request: { settlementId: pending.result.settlementId, snapshotHash: pending.result.snapshotHash, evidenceVersion: 3, assetReference: "record:conflict-asset", certificateReference: "record:conflict-certificate", warehouseReference: "record:conflict-warehouse" },
    }),
    /SETTLEMENT_AUTHORITATIVE_EVIDENCE_MISMATCH/,
  );

  assert.equal(assembly.runtime.settlements.get("stage-d-conflict-settlement").status, "PENDING");
  assert.equal(assembly.runtime.stateEngine.current("asset-production"), "TRANSFER_PENDING");
  assert.equal(assembly.runtime.recordStore.currentCertificate("asset-production").certificateHash, HASH_B);
  assert.equal(assembly.runtime.recordStore.currentCertificate("asset-production").certificateVersion, 1);
  assert.equal(persisted.filter(({ method }) => method === "finalizeSettlement").length, 0);
  assert.equal(assembly.runtime.auditJournal.list().filter(({ type }) => type === "settlement.finalized").length, 0);
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
