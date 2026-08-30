import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const packageRoot = path.resolve(process.argv[2] || "docs/ERC_PRE_SUBMISSION_READY_2026-08-29_V9");
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const relative = (file) => path.relative(packageRoot, file).split(path.sep).join("/");
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const stat = fs.lstatSync(file);
    assert.equal(stat.isSymbolicLink(), false, `symlink/reparse entry rejected: ${relative(file)}`);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) files.push(file);
    else assert.fail(`unsupported entry: ${relative(file)}`);
  }
}
walk(packageRoot);

const indexPath = path.join(packageRoot, "FILE_INDEX_SHA256.txt");
assert.ok(files.includes(indexPath), "FILE_INDEX_SHA256.txt missing");
const indexLines = fs.readFileSync(indexPath, "utf8").trim().split(/\r?\n/);
const indexed = new Map(indexLines.map((line) => {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  assert.ok(match, `invalid index line: ${line}`);
  return [match[2], match[1]];
}));
assert.equal(indexed.size, files.length - 1, "index count mismatch");
for (const file of files.filter((value) => value !== indexPath)) {
  const name = relative(file);
  assert.equal(indexed.get(name), sha256(fs.readFileSync(file)), `hash mismatch: ${name}`);
}

const publicFiles = files.map(relative).filter((name) => name.startsWith("ERCS/") || name.startsWith("assets/"));
assert.deepEqual(publicFiles.sort(), [
  "ERCS/erc-xxxx.md",
  "assets/eip-xxxx/README.md",
  "assets/eip-xxxx/contracts/VersionedCertificateReference.sol",
  "assets/eip-xxxx/hardhat.config.cjs",
  "assets/eip-xxxx/package.json",
  "assets/eip-xxxx/test/protocol.cjs",
].sort(), "public submission tree contains unexpected files");

const ledger = JSON.parse(fs.readFileSync(path.join(packageRoot, "review/PREP_READY_LEDGER_V9.json"), "utf8"));
assert.equal(ledger.status, "PREP_READY");
assert.deepEqual(ledger.remainingUserInputs, ["ethereumMagiciansDiscussionUrl", "explicitPublicationAuthorizationIncludingIprCc0Confirmation"]);
assert.equal(ledger.discussionPublished, false);
assert.equal(ledger.pullRequestCreated, false);
assert.equal(indexed.get("ERCS/erc-xxxx.md"), ledger.candidateSha256);
assert.equal(indexed.get("assets/eip-xxxx/contracts/VersionedCertificateReference.sol"), ledger.referenceSha256);
assert.equal(indexed.get("assets/eip-xxxx/test/protocol.cjs"), ledger.testsSha256);

const candidate = fs.readFileSync(path.join(packageRoot, "ERCS/erc-xxxx.md"), "utf8");
assert.equal(candidate.includes("author: Michael Yip (@GiraffeTechnology)"), true, "final author must be set");
assert.equal(candidate.includes("@REPLACE_WITH_GITHUB_USERNAME"), false, "author placeholder must be gone");
assert.equal(candidate.includes("REPLACE_WITH_DISCUSSION_SLUG"), true, "discussion URL is the only remaining placeholder");
const privateKeyMarker = ["PRIVATE", "KEY"].join(" ");
for (const forbidden of [`BEGIN ${privateKeyMarker}`, `${privateKeyMarker}-----`, "RPC_URL=", "560048", "ArtFi1", "ArtFi2", "SIN_REGISTRY"]) {
  for (const name of publicFiles) assert.equal(fs.readFileSync(path.join(packageRoot, name), "utf8").includes(forbidden), false, `public material leak: ${forbidden} in ${name}`);
}
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "assets/eip-xxxx/package.json"), "utf8"));
assert.equal(packageJson.license, "CC0-1.0");

console.log(JSON.stringify({ status: "PASS", packageRoot, indexedFiles: indexed.size, indexSha256: sha256(fs.readFileSync(indexPath)), candidateSha256: ledger.candidateSha256, remainingUserInputs: ledger.remainingUserInputs }));
