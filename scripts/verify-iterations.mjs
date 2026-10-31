import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { validateI12Evidence } from "../src/services/i12-evidence.js";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "config", "iteration-acceptance.json"), "utf8"));
const requirementManifest = JSON.parse(await readFile(path.join(root, "config", "prd-v0.4-acceptance.json"), "utf8"));

async function exists(relative) {
  try {
    await access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

function runNode(args) {
  // Reporter output is a machine input: inherited FORCE_COLOR must not add ANSI.
  // Do not strip arbitrary test-name bytes or weaken exact-name matching.
  const env = { ...process.env, NO_COLOR: "1", NODE_DISABLE_COLORS: "1" };
  delete env.FORCE_COLOR;
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return { ok: result.status === 0, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const results = [];
const authoritativeRequirementIds = new Set(requirementManifest.requirements.map(({ id }) => id));
const mappedRequirementIds = new Set();

if (manifest.prdVersion !== requirementManifest.prdVersion) {
  throw new Error(`ITERATION_PRD_VERSION_MISMATCH:${manifest.prdVersion}:${requirementManifest.prdVersion}`);
}

for (const iteration of manifest.iterations) {
  if (!Array.isArray(iteration.requirementIds) || iteration.requirementIds.length === 0) {
    throw new Error(`ITERATION_REQUIREMENT_MAPPING_MISSING:${iteration.id}`);
  }
  for (const requirementId of iteration.requirementIds) {
    if (!authoritativeRequirementIds.has(requirementId)) {
      throw new Error(`ITERATION_REQUIREMENT_UNKNOWN:${iteration.id}:${requirementId}`);
    }
    mappedRequirementIds.add(requirementId);
  }
}

const unmappedRequirementIds = [...authoritativeRequirementIds].filter((id) => !mappedRequirementIds.has(id));
if (unmappedRequirementIds.length > 0) {
  throw new Error(`ITERATION_REQUIREMENT_UNMAPPED:${unmappedRequirementIds.join(",")}`);
}

const syntax = runNode(["scripts/syntax-check.mjs"]);
// Pin the human-readable reporter because iteration evidence matches exact test
// names. Node's default reporter is environment-dependent (TAP vs spec).
const tests = runNode(["--test", "--test-reporter=spec", "test/*.test.js"]);
const scan = runNode(["scripts/repository-scan.mjs"]);
const testOutput = `${tests.stdout}\n${tests.stderr}`;
// Match a whole successful spec-reporter result, never a prefix of another test.
const passedTestNames = new Set(testOutput.split(/\r?\n/).flatMap((line) => {
  const match = /^\s*✔ (.*) \(\d+(?:\.\d+)?(?:ms|s)\)$/.exec(line);
  return match ? [match[1]] : [];
}));

for (const iteration of manifest.iterations) {
  const artifacts = [];
  for (const relative of iteration.artifacts) artifacts.push({ path: relative, present: await exists(relative) });
  const requiredTests = iteration.tests.map((name) => ({ name, passed: tests.ok && passedTestNames.has(name) }));
  const externalEvidence = [];
  for (const relative of iteration.externalEvidence) {
    const present = await exists(relative);
    let valid = false;
    let errorCode = present ? null : "EVIDENCE_NOT_FOUND";
    if (present) {
      const type = relative.includes("security-scans") ? "security-scans" : relative.includes("performance-capacity") ? "performance-capacity" : relative.includes("72h-stability") ? "72h-stability" : relative.includes("restore-drill") ? "restore-drill" : relative.includes("signer-rotation") ? "signer-rotation" : relative.includes("data-protection-response") ? "data-protection-response" : relative.includes("reproducible-build") ? "reproducible-build" : "independent-reviews";
      try { valid = validateI12Evidence(type, JSON.parse(await readFile(path.join(root, relative), "utf8"))); } catch (error) { errorCode = error.message; }
    }
    externalEvidence.push({ path: relative, present, valid, errorCode });
  }
  const complete = syntax.ok && scan.ok && artifacts.every(({ present }) => present) && requiredTests.every(({ passed }) => passed) && externalEvidence.every(({ present, valid }) => present && valid);
  results.push({ id: iteration.id, requirementIds: iteration.requirementIds, complete, artifacts, tests: requiredTests, externalEvidence });
}

const report = {
  schemaVersion: 1,
  prdVersion: manifest.prdVersion,
  generatedAt: new Date().toISOString(),
  commands: {
    syntax: { command: "node scripts/syntax-check.mjs", ok: syntax.ok },
    unit: { command: "node --test --test-reporter=spec \"test/*.test.js\"", ok: tests.ok },
    repositoryScan: { command: "node scripts/repository-scan.mjs", ok: scan.ok },
  },
  summary: {
    completed: results.filter(({ complete }) => complete).map(({ id }) => id),
    blocked: results.filter(({ complete }) => !complete).map(({ id }) => id),
    allComplete: results.every(({ complete }) => complete),
  },
  traceability: {
    authoritativeRequirementCount: authoritativeRequirementIds.size,
    mappedRequirementCount: mappedRequirementIds.size,
    unmappedRequirementIds,
  },
  iterations: results,
};
const canonical = JSON.stringify(report);
report.reportSha256 = createHash("sha256").update(canonical).digest("hex");
await mkdir(path.join(root, "output"), { recursive: true });
await writeFile(path.join(root, "output", "iteration-acceptance-report.json"), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "w" });
process.stdout.write(`${JSON.stringify(report.summary)}\nreportSha256=${report.reportSha256}\n`);
if (!report.summary.allComplete) process.exitCode = 1;
