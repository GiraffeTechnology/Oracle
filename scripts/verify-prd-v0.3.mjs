import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateI12Evidence } from "../src/services/i12-evidence.js";
import { validateIntegratedCiEvidence, validatePremiseEvidence, validateStageFDecision } from "../src/services/stage-gate-evidence.js";

const root = process.cwd();
const acceptedCandidateCommits = new Set();
const config = JSON.parse(await readFile(path.join(root, "config/prd-v0.3-acceptance.json"), "utf8"));
const testText = (await readdir(path.join(root, "test"), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"));
const tests = (await Promise.all(testText.map((entry) => readFile(path.join(root, "test", entry.name), "utf8")))).join("\n");

async function exists(relative) {
  try { await access(path.join(root, relative)); return true; } catch { return false; }
}

async function sha256(relative) {
  return createHash("sha256").update(await readFile(path.join(root, relative))).digest("hex");
}

async function validateExternalEvidence(relative) {
  const value = JSON.parse(await readFile(path.join(root, relative), "utf8"));
  if (typeof value.candidateCommit === "string") acceptedCandidateCommits.add(value.candidateCommit);
  if (relative.endsWith("premise-evidence.json")) return validatePremiseEvidence(value);
  if (relative.endsWith("stage-f-contract-and-go-no-go.json")) return validateStageFDecision(value);
  if (relative.endsWith("integrated-ci.json")) return validateIntegratedCiEvidence(value);
  const match = Object.entries({
    "i12-security-scans.json": "security-scans",
    "i12-performance-capacity.json": "performance-capacity",
    "i12-72h-stability.json": "72h-stability",
    "i12-restore-drill.json": "restore-drill",
    "i12-signer-rotation.json": "signer-rotation",
    "i12-data-protection-response.json": "data-protection-response",
    "i12-reproducible-build.json": "reproducible-build",
    "i12-independent-reviews.json": "independent-reviews",
  }).find(([file]) => relative.endsWith(file));
  if (match) return validateI12Evidence(match[1], value);
  return true;
}

if (await sha256("docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md") !== config.prdSha256) throw new Error("PRD_HASH_MISMATCH");
if (await sha256("docs/ACCEPTANCE_RWA_ORACLE_ZH.md") !== config.acceptanceSha256) throw new Error("ACCEPTANCE_HASH_MISMATCH");

const requirements = [];
for (const requirement of config.requirements) {
  const missingArtifacts = [];
  for (const artifact of requirement.artifacts) if (!(await exists(artifact))) missingArtifacts.push(artifact);
  const missingTests = requirement.tests.filter((name) => !tests.includes(`test("${name}"`) && !tests.includes(`test('${name}'`));
  const missingExternalEvidence = [];
  for (const evidence of requirement.externalEvidence ?? []) {
    if (!(await exists(evidence))) missingExternalEvidence.push(evidence);
    else { try { await validateExternalEvidence(evidence); } catch { missingExternalEvidence.push(evidence); } }
  }
  requirements.push({ id: requirement.id, status: missingArtifacts.length || missingTests.length ? "NOT-IMPLEMENTED" : missingExternalEvidence.length ? "PENDING-GATE" : "VERIFIED", missingArtifacts, missingTests, missingExternalEvidence });
}

const missingStageFEvidence = [];
for (const evidence of config.stageFExternalEvidence) {
  if (!(await exists(evidence))) missingStageFEvidence.push(evidence);
  else { try { await validateExternalEvidence(evidence); } catch { missingStageFEvidence.push(evidence); } }
}
if (acceptedCandidateCommits.size > 1) missingStageFEvidence.push("candidate-commit-consistency");
const engineeringVerified = requirements.filter((item) => item.status === "VERIFIED").map((item) => item.id);
const pending = requirements.filter((item) => item.status !== "VERIFIED").map((item) => item.id);
const report = {
  schemaVersion: 1,
  prdVersion: config.prdVersion,
  requirements,
  stages: {
    A: missingStageFEvidence.includes("evidence/acceptance/premise-evidence.json") ? "PENDING-GATE" : "VERIFIED",
    B: pending.some((id) => /^ORACLE-00[1-9]$|^NFR-00[1-3]$/.test(id)) ? "PENDING-GATE" : "VERIFIED",
    C: pending.some((id) => id === "ORACLE-010" || id.startsWith("CONSUMER-")) ? "PENDING-GATE" : "VERIFIED",
    D: pending.includes("NFR-004") ? "PENDING-GATE" : "VERIFIED",
    E: pending.some((id) => id === "ORACLE-005" || id === "ORACLE-009") ? "PENDING-GATE" : "VERIFIED",
    F: missingStageFEvidence.length ? "PENDING-GATE" : "VERIFIED"
  },
  engineeringVerified,
  pending,
  missingStageFEvidence,
};
report.allComplete = Object.values(report.stages).every((value) => value === "VERIFIED") && pending.length === 0;
await mkdir(path.join(root, "output"), { recursive: true });
await writeFile(path.join(root, "output/prd-v0.3-acceptance-report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "w" });
console.log(JSON.stringify({ engineeringVerified: engineeringVerified.length, pending, stages: report.stages, allComplete: report.allComplete }));
if (!report.allComplete) process.exitCode = 1;
