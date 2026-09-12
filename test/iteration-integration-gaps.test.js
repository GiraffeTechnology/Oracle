import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { responseEtag } from "../src/app.js";
import { FixedWindowRateLimiter } from "../src/services/rate-limiter.js";
import { ExportGate } from "../src/services/export-gate.js";
import { SubscriptionSigner } from "../src/services/subscription-signer.js";
import { ResilientSourceAdapter } from "../src/adapters/resilient-source-adapter.js";
import { createAuditExport, verifyAuditExport } from "../src/services/audit-export.js";
import { createReleaseManifest, verifyReleaseManifest } from "../src/services/release-manifest.js";
import { SignerSetPolicy } from "../src/domain/signer-set-policy.js";
import { AttestationService } from "../src/domain/attestation-service.js";
import { RevocationRegistry } from "../src/domain/revocation-registry.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";
import { Authorizer } from "../src/services/authorizer.js";
import { AuditJournal } from "../src/domain/audit-journal.js";
import { Outbox } from "../src/services/outbox.js";

const HASH = "a".repeat(64);

test("read APIs emit deterministic ETags", () => {
  assert.equal(responseEtag({ value: 1 }), responseEtag({ value: 1 }));
  assert.notEqual(responseEtag({ value: 1 }), responseEtag({ value: 2 }));
});

test("rate limiter rejects excess requests", () => {
  const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 1000, clock: () => 100 });
  limiter.consume("reader-a"); limiter.consume("reader-a");
  assert.throws(() => limiter.consume("reader-a"), /RATE_LIMIT_EXCEEDED/);
});

test("export gate requires purpose and permission", () => {
  const gate = new ExportGate();
  assert.throws(() => gate.authorize({ permission: "audit:read", purpose: "regulatory-audit", recordCount: 1 }), /EXPORT_PERMISSION_DENIED/);
  assert.equal(gate.authorize({ permission: "audit:export", purpose: "regulatory-audit", recordCount: 1 }).sensitiveFieldsIncluded, false);
});

test("public schemas exclude financial opinions", async () => {
  const text = await Promise.all(["asset-record.v1.json", "certificate-record.v1.json", "warehouse-record.v1.json"].map((name) => readFile(`schemas/${name}`, "utf8")));
  assert.doesNotMatch(text.join("\n"), /price|yield|rating|collateral|investment/i);
});

test("subscription signer binds payload and delivery id", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signer = new SubscriptionSigner({ signerSetId: "events-v1", privateKey, publicKey });
  const signed = signer.issue({ deliveryId: "delivery-1", eventId: "event-1", payloadHash: HASH, issuedAt: "2026-08-24T00:00:00.000Z" });
  assert.equal(signer.verify(signed, "delivery-1"), true);
  assert.equal(signer.verify(signed, "delivery-2"), false);
});

test("revoked signer set fails every verification path", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signerPolicy = new SignerSetPolicy({ signerSetId: "oracle-v1", threshold: 1, signers: ["a"], status: "REVOKED" });
  const service = new AttestationService({ signerSetId: "oracle-v1", privateKey, publicKey, signerPolicy, revocations: new RevocationRegistry() });
  assert.throws(() => service.issue({ subject: { assetId: "asset-1", purpose: "test" }, sourceRecordHash: HASH, validForSeconds: 1, nonce: "n" }), /SIGNER_SET_NOT_ACTIVE/);
  assert.deepEqual(service.verify({}), { valid: false, errorCode: "SIGNER_SET_NOT_ACTIVE" });
});

test("resilient adapters negotiate versions and recover after circuit open", async () => {
  let now = 0; let failures = 2;
  const adapter = new ResilientSourceAdapter({ sourceId: "registry-a", capability: "asset.read", versions: ["v1"], failureThreshold: 2, resetMs: 10, clock: () => now, transport: { async fetch() { if (failures-- > 0) throw new Error("offline"); return { ok: true }; } } });
  await assert.rejects(() => adapter.fetch({ version: "v1", recordRef: "r1" }), /offline/);
  await assert.rejects(() => adapter.fetch({ version: "v1", recordRef: "r1" }), /offline/);
  await assert.rejects(() => adapter.fetch({ version: "v1", recordRef: "r1" }), /SOURCE_CIRCUIT_OPEN/);
  now = 11;
  assert.deepEqual(await adapter.fetch({ version: "v1", recordRef: "r1" }), { ok: true });
});

test("three source adapters reject conflict delay offline and unknown capability", async () => {
  const capabilities = ["asset.read", "certificate.read", "warehouse.read"];
  for (const [index, capability] of capabilities.entries()) {
    const adapter = new ResilientSourceAdapter({ sourceId: `source-${index}`, capability, versions: ["v1"], timeoutMs: 5, transport: { async fetch() { throw new Error(index === 0 ? "conflict" : "offline"); } } });
    await assert.rejects(() => adapter.fetch({ version: "v1", recordRef: "record" }), /conflict|offline/);
    await assert.rejects(() => adapter.fetch({ version: "v2", recordRef: "record" }), /SOURCE_VERSION_NOT_NEGOTIATED/);
  }
  assert.throws(() => new ResilientSourceAdapter({ sourceId: "bad", capability: "unknown", versions: ["v1"], transport: { fetch() {} } }), /RESILIENT_SOURCE_CONFIG_INVALID/);
});

test("admin cannot directly set VALID", () => {
  const auth = new Authorizer(); auth.registerActor("admin-a", ["AUDITOR"]);
  assert.throws(() => auth.require("admin-a", "asset:verify"), /PERMISSION_DENIED/);
});

test("audit export detects tampering and injection", () => {
  const candidate = createAuditExport([{ type: "=formula", eventHash: HASH }], { exportId: "export-1", purpose: "regulatory-audit", createdAt: "2026-08-24T00:00:00.000Z" });
  assert.equal(candidate.records[0].type, "'=formula");
  assert.equal(verifyAuditExport(candidate), true);
  assert.equal(verifyAuditExport({ ...candidate, records: [{ ...candidate.records[0], type: "changed" }] }), false);
});

test("release manifest detects artifact tampering", () => {
  const files = [{ path: "a", bytes: Buffer.from("one") }, { path: "b", bytes: Buffer.from("two") }];
  const manifest = createReleaseManifest(files);
  assert.equal(verifyReleaseManifest(manifest, files), true);
  assert.equal(verifyReleaseManifest(manifest, [{ path: "a", bytes: Buffer.from("changed") }, files[1]]), false);
});

test("fault injection preserves audit and outbox invariants", () => {
  const runtime = createSyntheticRuntime();
  const audit = new AuditJournal(); const outbox = new Outbox();
  assert.throws(() => runtime.recordStore.appendCertificate({ assetId: "missing", certificateHash: HASH, certificateVersion: 2 }), /CERTIFICATE_INITIAL_VERSION_INVALID/);
  assert.equal(audit.verify(), true);
  assert.equal(audit.list().length, 0);
  assert.equal(outbox.pending().length, 0);
});

test("settlement timeout and dispute never change the holder", () => {
  let now = new Date("2026-08-24T00:00:00.000Z");
  const runtime = createSyntheticRuntime({ clock: () => now });
  runtime.recordStore.putAsset({ assetId: "asset-timeout", assetFingerprintHash: HASH });
  runtime.recordStore.appendCertificate({ assetId: "asset-timeout", certificateHash: HASH, certificateVersion: 1 });
  runtime.recordStore.putWarehouse({ assetId: "asset-timeout", warehouseReceiptHash: "b".repeat(64) });
  runtime.stateEngine.transition({ subjectId: "asset-timeout", to: "VALID", reasonHash: HASH, evidenceVersion: 1, occurredAt: now.toISOString() });
  runtime.tokenIndex.bind({ chainId: "test-chain", contract: "contract-timeout", tokenId: "1", assetId: "asset-timeout" });
  runtime.settlements.begin({ settlementId: "settlement-timeout", assetId: "asset-timeout", token: { chainId: "test-chain", contract: "contract-timeout", tokenId: "1" }, sellerWallet: "seller-wallet", buyerWallet: "buyer-wallet", externalExecutionRef: "execution-timeout", oldCertificateHash: HASH, warehouseReceiptHash: "b".repeat(64), actorId: "operator", evidenceVersion: 2 });
  now = new Date("2026-08-28T00:02:00.000Z");
  runtime.settlements.timeout({ settlementId: "settlement-timeout", reasonHash: "d".repeat(64), actorId: "operator", evidenceVersion: 3 });
  assert.equal(runtime.settlements.get("settlement-timeout").status, "TIMED_OUT");
  assert.equal(runtime.recordStore.currentCertificate("asset-timeout").certificateVersion, 1);
  assert.equal(runtime.stateEngine.current("asset-timeout"), "REVIEW_REQUIRED");
});
