import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const candidate = read("docs/erc-working-draft/ERC_SUBMISSION_CANDIDATE_EN.md");
const formalEn = read("docs/erc-working-draft/GIRAFFE_ERC_FORMAL_EN.txt");
const formalZh = read("docs/erc-working-draft/GIRAFFE_ERC_FORMAL_ZH.txt");
const reference = read("erc-reference/contracts/VersionedRWACertificateReference.sol");
const protocolTest = read("erc-reference/test/protocol.cjs");

assert.ok(candidate.startsWith("---\n"), "F1: YAML front matter missing");
for (const field of [
  "eip:", "title:", "description:", "author:", "discussions-to:",
  "status: Draft", "type: Standards Track", "category: ERC", "created:",
  "requires: 165, 721, 712, 1271, 8325"
]) assert.ok(candidate.includes(field), `missing submission field: ${field}`);
assert.ok(candidate.includes("```solidity"), "F7: Solidity fence missing");
assert.equal((candidate.match(/```/g) || []).length % 2, 0, "unbalanced code fences");
assert.ok(
  candidate.includes("Copyright and related rights waived via [CC0](/LICENSE)."),
  "F5: exact CC0 statement missing"
);

const settlementType = "SettlementAuthorization(uint256 tokenId,bytes32 settlementId,address from,address to,bytes32 previousCertificateHash,bytes32 newCertificateHash,uint64 newCertificateVersion,uint64 effectiveAt,uint64 validUntil,uint256 nonce)";
const cancellationType = "CancellationAuthorization(bytes32 settlementId,uint256 tokenId,bytes32 reasonHash,uint64 validUntil,uint256 nonce)";
for (const text of [candidate, formalEn, reference, protocolTest]) {
  assert.ok(text.includes(settlementType), "T1: settlement EIP-712 type drift");
  assert.ok(text.includes(cancellationType), "T1: cancellation EIP-712 type drift");
}
for (const text of [candidate, formalEn]) {
  assert.ok(text.includes("abi.encode(uint64 validUntil, uint256 nonce, bytes signature)"));
  assert.ok(text.includes("IAssetBoundTokenId"), "T3: ERC-8325 binding missing");
  assert.ok(text.includes("ERC-6997"), "T4: ERC-6997 comparison missing");
  assert.ok(text.includes("Reference Implementation"), "T5: reference implementation missing");
  assert.ok(text.includes("SHOULD emit"), "T6: event order must be SHOULD");
  assert.ok(text.includes("does not require Keccak-256"), "T7: commitment algorithm is over-constrained");
}
assert.ok(formalZh.includes("必须实现 ERC-8325 IAssetBoundTokenId、IVersionedRWACertificate 和 IDeferredCertificateSettlement"));
assert.ok(formalEn.includes("MUST implement ERC-8325 IAssetBoundTokenId, IVersionedRWACertificate, and IDeferredCertificateSettlement"));

for (const forbidden of ["中创", "文保链", "Chainart", "ERC-RWO", "T+1", "T+3"]) {
  assert.equal(candidate.includes(forbidden), false, `forbidden candidate term: ${forbidden}`);
  assert.equal(formalEn.includes(forbidden), false, `forbidden EN term: ${forbidden}`);
  assert.equal(formalZh.includes(forbidden), false, `forbidden ZH term: ${forbidden}`);
}

console.log("erc-submission-gate: pass (F1-F7, T1-T7 static invariants)");
