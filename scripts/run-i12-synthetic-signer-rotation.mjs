import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AttestationService } from "../src/domain/attestation-service.js";
import { AuditJournal } from "../src/domain/audit-journal.js";
import { canonicalJson, evidenceHash } from "../src/domain/canonical-json.js";
import { RevocationRegistry } from "../src/domain/revocation-registry.js";
import { SignerSetPolicy } from "../src/domain/signer-set-policy.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixedOutput = path.join(root, "output", "i12-synthetic-signer-rotation.json");
const writeFixedOutput = process.argv.includes("--write-fixed-output");
const unknownArguments = process.argv.slice(2).filter((value) => value !== "--write-fixed-output");
if (unknownArguments.length) throw new Error("SYNTHETIC_ROTATION_ARGUMENT_REFUSED");

function publicKeyFingerprint(publicKey) {
  return createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
}

function verifyPublicAuditChain(events) {
  let previousHash = "0".repeat(64);
  for (const event of events) {
    const { eventHash, ...body } = event;
    if (body.previousHash !== previousHash || evidenceHash(body) !== eventHash) return false;
    previousHash = eventHash;
  }
  return true;
}

function issue(service, nonce) {
  return service.issue({
    subject: { assetId: "SYNTHETIC-I12-ASSET", purpose: "signer-rotation-drill" },
    factType: "synthetic-rotation",
    factValue: "TEST_ONLY",
    sourceRecordHash: evidenceHash({ fixture: "i12-synthetic-signer-rotation-v1" }),
    validForSeconds: 300,
    nonce,
  });
}

const startedAt = new Date();
let oldKeys = generateKeyPairSync("ed25519");
let newKeys = generateKeyPairSync("ed25519");

try {
  const oldSignerSetId = `synthetic-old-${publicKeyFingerprint(oldKeys.publicKey).slice(0, 16)}`;
  const newSignerSetId = `synthetic-new-${publicKeyFingerprint(newKeys.publicKey).slice(0, 16)}`;
  const oldActivePolicy = new SignerSetPolicy({ signerSetId: oldSignerSetId, threshold: 1, signers: [oldSignerSetId] });
  const oldRetiredPolicy = new SignerSetPolicy({ signerSetId: oldSignerSetId, threshold: 1, signers: [oldSignerSetId], status: "RETIRED" });
  const newActivePolicy = new SignerSetPolicy({ signerSetId: newSignerSetId, threshold: 1, signers: [newSignerSetId] });
  const revocations = new RevocationRegistry();
  const clock = () => startedAt;

  const oldActive = new AttestationService({ signerSetId: oldSignerSetId, privateKey: oldKeys.privateKey, publicKey: oldKeys.publicKey, signerPolicy: oldActivePolicy, revocations, clock });
  const oldRetired = new AttestationService({ signerSetId: oldSignerSetId, privateKey: oldKeys.privateKey, publicKey: oldKeys.publicKey, signerPolicy: oldRetiredPolicy, revocations, clock });
  const newActive = new AttestationService({ signerSetId: newSignerSetId, privateKey: newKeys.privateKey, publicKey: newKeys.publicKey, signerPolicy: newActivePolicy, revocations, clock });

  const oldAttestation = issue(oldActive, "synthetic-old-before-rotation");
  assert.equal(oldActive.verify(oldAttestation).valid, true, "old signer must be valid before rotation");

  const audit = new AuditJournal();
  const actorId = "synthetic-rotation-controller";
  const subjectId = "synthetic-oracle-attestation-signer";
  audit.append({
    type: "signer.rotation.requested",
    subjectId,
    payloadHash: evidenceHash({ from: oldSignerSetId, to: newSignerSetId, mode: "SYNTHETIC_OFFLINE" }),
    actorId,
    occurredAt: new Date(startedAt.getTime() + 1000).toISOString(),
  });
  audit.append({
    type: "signer.rotation.new-activated",
    subjectId,
    payloadHash: evidenceHash({ signerSetId: newSignerSetId, status: "ACTIVE" }),
    actorId,
    occurredAt: new Date(startedAt.getTime() + 2000).toISOString(),
  });
  audit.append({
    type: "signer.rotation.prior-retired",
    subjectId,
    payloadHash: evidenceHash({ signerSetId: oldSignerSetId, status: "RETIRED" }),
    actorId,
    occurredAt: new Date(startedAt.getTime() + 3000).toISOString(),
  });

  const newAttestation = issue(newActive, "synthetic-new-after-rotation");
  const newVerification = newActive.verify(newAttestation);
  const oldSignatureAgainstNewSet = newActive.verify(oldAttestation);
  const oldRetiredVerification = oldRetired.verify(oldAttestation);
  let oldIssueErrorCode = null;
  try { issue(oldRetired, "synthetic-old-after-rotation"); } catch (error) { oldIssueErrorCode = error.message; }

  assert.deepEqual(newVerification, { valid: true, errorCode: null });
  assert.deepEqual(oldSignatureAgainstNewSet, { valid: false, errorCode: "SIGNATURE_INVALID" });
  assert.deepEqual(oldRetiredVerification, { valid: false, errorCode: "SIGNER_SET_NOT_ACTIVE" });
  assert.equal(oldIssueErrorCode, "SIGNER_SET_NOT_ACTIVE");
  assert.equal(audit.verify(), true);

  const auditEvents = audit.list();
  const tamperedEvents = auditEvents.map((event) => ({ ...event }));
  tamperedEvents[1].payloadHash = evidenceHash({ tampered: true });
  assert.equal(verifyPublicAuditChain(tamperedEvents), false);

  const runnerSha256 = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
  const publicTranscript = {
    schemaVersion: 1,
    drillId: "oracle-i12-synthetic-signer-rotation-v1",
    scope: "SYNTHETIC_OFFLINE_ONLY",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    runnerSha256,
    oldSignerSetId,
    newSignerSetId,
    oldPublicKeyFingerprintSha256: publicKeyFingerprint(oldKeys.publicKey),
    newPublicKeyFingerprintSha256: publicKeyFingerprint(newKeys.publicKey),
    auditEventHashes: auditEvents.map(({ sequence, type, previousHash, eventHash }) => ({ sequence, type, previousHash, eventHash })),
  };
  const transcriptSha256 = evidenceHash(publicTranscript);
  const report = {
    ...publicTranscript,
    type: "signer-rotation-synthetic-drill",
    status: "PASS",
    acceptanceEligible: false,
    doesNotSatisfyProductionProtectedSignerCeremony: true,
    transcriptSha256,
    newSignerAccepted: true,
    oldSignerRejected: true,
    oldSignerRejectionCodes: ["SIGNATURE_INVALID", "SIGNER_SET_NOT_ACTIVE"],
    rotationAudited: true,
    auditChainVerified: true,
    tamperedAuditChainRejected: true,
    privateMaterialObserved: false,
    privateMaterialExported: false,
    privateMaterialPersisted: false,
    networkUsed: false,
    rpcUsed: false,
    brokerUsed: false,
    walletUsed: false,
    transactionSigned: false,
    nonceConsumed: false,
  };

  const serialized = `${canonicalJson(report)}\n`;
  const forbiddenPublicReportPattern = new RegExp([
    "BEGIN " + "PRIVATE KEY",
    "privateKey",
    "mnemonic",
    "seedPhrase",
    "rawTransaction",
  ].join("|"), "i");
  if (forbiddenPublicReportPattern.test(serialized)) {
    throw new Error("SYNTHETIC_ROTATION_PUBLIC_REPORT_REFUSED");
  }
  if (writeFixedOutput) {
    await mkdir(path.dirname(fixedOutput), { recursive: true });
    await writeFile(fixedOutput, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  process.stdout.write(serialized);
} finally {
  oldKeys = null;
  newKeys = null;
}

