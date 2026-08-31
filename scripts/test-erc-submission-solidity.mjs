import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hardhatRequire = createRequire(require.resolve("hardhat/package.json"));
const solc = hardhatRequire("solc");
const { ethers } = require("ethers");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateText = fs.readFileSync(
  path.join(root, "docs/erc-working-draft/ERC_SUBMISSION_CANDIDATE_EN.md"),
  "utf8"
);
const referenceText = fs.readFileSync(
  path.join(root, "erc-reference/contracts/VersionedRWACertificateReference.sol"),
  "utf8"
);
const blocks = [...candidateText.matchAll(/```solidity\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
assert.equal(blocks.length, 3, "candidate Solidity fence count drift");
const interfaceBlocks = blocks.filter((block) => block.includes("interface I"));
assert.equal(interfaceBlocks.length, 2, "candidate must contain exactly two Solidity interface blocks");

const input = {
  language: "Solidity",
  sources: {
    "CandidateCertificate.sol": { content: interfaceBlocks[0] },
    "CandidateSettlement.sol": { content: interfaceBlocks[1] },
    "Reference.sol": { content: referenceText },
    "@openzeppelin/contracts/utils/introspection/IERC165.sol": {
      content: "// SPDX-License-Identifier: CC0-1.0\npragma solidity ^0.8.20; interface IERC165 { function supportsInterface(bytes4 interfaceId) external view returns (bool); }"
    }
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi"] } }
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((entry) => entry.severity === "error");
assert.equal(errors.length, 0, errors.map((entry) => entry.formattedMessage).join("\n"));

function interfaceId(abi) {
  const iface = new ethers.Interface(abi);
  let value = 0n;
  for (const fragment of iface.fragments) {
    if (fragment.type === "function" && fragment.name !== "supportsInterface") {
      value ^= BigInt(fragment.selector);
    }
  }
  return ethers.toBeHex(value, 4);
}

for (const [source, name, expected] of [
  ["CandidateCertificate.sol", "IVersionedRWACertificate", "0xebaa86a0"],
  ["CandidateSettlement.sol", "IDeferredCertificateSettlement", "0x2773d4c9"]
]) {
  const candidateAbi = output.contracts[source][name].abi;
  const referenceAbi = output.contracts["Reference.sol"][name].abi;
  assert.deepEqual(candidateAbi, referenceAbi, `${name} candidate ABI drift`);
  assert.equal(interfaceId(candidateAbi), expected, `${name} interface ID drift`);
}

console.log("erc-submission-solidity: pass (candidate blocks compile and ABIs match reference)");
