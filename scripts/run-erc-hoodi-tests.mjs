import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuthorizedHoodiTestAsset } from "./erc-test-asset-config.mjs";

const HOODI_CHAIN_ID = "560048";
const require = createRequire(import.meta.url);
const hardhatPackage = require.resolve("hardhat/package.json");
const hardhatCli = path.join(path.dirname(hardhatPackage), "internal", "cli", "cli.js");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testAsset = loadAuthorizedHoodiTestAsset(repositoryRoot);
const evidenceDirectory = path.join(repositoryRoot, "docs", "erc-working-draft", "hoodi-evidence");
mkdirSync(evidenceDirectory, { recursive: true });
const evidenceTimestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
const evidencePath = path.join(evidenceDirectory, `HOODI_TEST_EVIDENCE_${evidenceTimestamp}.log`);
const evidenceStream = createWriteStream(evidencePath, { flags: "wx" });

const env = {
  ...process.env,
  APPDATA: path.join(repositoryRoot, ".hardhat-appdata"),
  LOCALAPPDATA: path.join(repositoryRoot, ".hardhat-localappdata"),
  ERC_PUBLIC_TESTNET: "1",
  ERC_EXPECTED_CHAIN_ID: HOODI_CHAIN_ID,
  ERC_TEST_ASSET_EVIDENCE_HASH: testAsset.evidenceHash,
  ERC_DEADLINE_SECONDS: process.env.ERC_DEADLINE_SECONDS || "90"
};

evidenceStream.write(`${JSON.stringify({
  kind: "hoodi-test-run",
  startedAt: new Date().toISOString(),
  chainId: Number(HOODI_CHAIN_ID),
  assetId: testAsset.assetId,
  evidenceHash: testAsset.evidenceHash,
  owner: testAsset.owner,
  custodian: testAsset.custodian,
  labels: ["TEST ONLY", "NO VALUE", "NO LEGAL EFFECT", "NO RIGHTS TRANSFER"]
})}\n`);

const child = spawn(process.execPath, [hardhatCli, "test", "--no-compile"], {
  cwd: repositoryRoot,
  env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  evidenceStream.write(chunk);
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  evidenceStream.write(chunk);
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
evidenceStream.end(`${JSON.stringify({
  kind: "hoodi-test-run-complete",
  completedAt: new Date().toISOString(),
  exitCode
})}\n`);
await new Promise((resolve, reject) => {
  evidenceStream.once("finish", resolve);
  evidenceStream.once("error", reject);
});
console.log(`HOODI_EVIDENCE_LOG ${path.relative(repositoryRoot, evidencePath)}`);
process.exit(exitCode ?? 1);
