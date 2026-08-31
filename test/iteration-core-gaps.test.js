import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { SignerSetPolicy } from "../src/domain/signer-set-policy.js";
import { ReasonCodeRegistry } from "../src/domain/reason-code-registry.js";
import { ReviewQueue } from "../src/services/review-queue.js";
import { StateRebuilder } from "../src/services/state-rebuilder.js";
import { SyntheticEvidenceVault } from "../src/ports/evidence-vault-port.js";
import { AttestationService } from "../src/domain/attestation-service.js";
import { RevocationRegistry } from "../src/domain/revocation-registry.js";

const HASH = "a".repeat(64);

test("raw evidence vault exposes only a digest without an explicit capability", () => {
  const vault = new SyntheticEvidenceVault();
  const stored = vault.store(Buffer.from("private evidence"), { schemaVersion: "asset-record.v1", sourceId: "registry-a" });
  assert.equal("bytes" in stored, false);
  assert.throws(() => vault.retrieve(stored.evidenceRef), /EVIDENCE_ACCESS_DENIED/);
  assert.equal(vault.retrieve(stored.evidenceRef, "evidence:read:synthetic").toString(), "private evidence");
});

test("review queue only creates REVIEW_REQUIRED immutable conflicts", () => {
  const queue = new ReviewQueue();
  const item = queue.enqueue({ reviewId: "review-001", subjectId: "asset-001", findingCodes: ["WAREHOUSE_CONFLICT", "CERTIFICATE_CONFLICT"], evidenceHash: HASH, createdAt: "2026-08-24T00:00:00.000Z" });
  assert.equal(item.status, "REVIEW_REQUIRED");
  assert.equal(queue.enqueue({ reviewId: "review-001", subjectId: "asset-001", findingCodes: ["CERTIFICATE_CONFLICT", "WAREHOUSE_CONFLICT"], evidenceHash: HASH, createdAt: "2026-08-24T00:00:00.000Z" }), item);
  assert.throws(() => queue.enqueue({ ...item, evidenceHash: "b".repeat(64) }), /REVIEW_IDEMPOTENCY_CONFLICT/);
});

test("state rebuilder reconstructs the current status from ordered evidence", () => {
  const entries = [
    { subjectId: "asset-001", to: "TRANSFER_PENDING", reasonHash: HASH, evidenceVersion: 2, occurredAt: "2026-08-24T00:01:00.000Z" },
    { subjectId: "asset-001", to: "VALID", reasonHash: HASH, evidenceVersion: 1, occurredAt: "2026-08-24T00:00:00.000Z" },
  ];
  assert.equal(new StateRebuilder().rebuild(entries).current("asset-001"), "TRANSFER_PENDING");
  assert.equal(new ReasonCodeRegistry().require("SOURCE_CONFLICT", "REVIEW_REQUIRED").status, "REVIEW_REQUIRED");
});

test("signer policy rejects insufficient threshold", () => {
  const policy = new SignerSetPolicy({ signerSetId: "oracle-v1", threshold: 2, signers: ["a", "b", "c"] });
  assert.throws(() => policy.authorize(["a", "outsider"]), /SIGNER_THRESHOLD_NOT_MET/);
  assert.equal(policy.authorize(["a", "b", "a"]), true);
});

test("offline verifier rejects cross-purpose replay", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const clock = () => new Date("2026-08-24T00:00:00.000Z");
  const service = new AttestationService({ signerSetId: "oracle-v1", privateKey, publicKey, revocations: new RevocationRegistry(), clock });
  const attestation = service.issue({ subject: { assetId: "asset-001", chainId: "test-chain", contract: "contract-001", tokenId: "1", purpose: "settlement" }, factType: "eligible", factValue: true, sourceAuthority: "synthetic-registry", sourceRecordHash: HASH, validForSeconds: 60, nonce: "nonce-001" });
  assert.equal(service.verify(attestation, { expectedSubject: { assetId: "asset-001", chainId: "test-chain", contract: "contract-001", tokenId: "1", purpose: "settlement" } }).valid, true);
  assert.deepEqual(service.verify(attestation, { expectedSubject: { assetId: "asset-001", chainId: "test-chain", contract: "contract-001", tokenId: "1", purpose: "finance" } }), { valid: false, errorCode: "SUBJECT_MISMATCH" });
});
