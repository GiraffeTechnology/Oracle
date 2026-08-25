import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { validateI12Evidence } from "../src/services/i12-evidence.js";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "config", "iteration-acceptance.json"), "utf8"));

async function exists(relative) {
  try {
    await access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return { ok: result.status === 0, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const syntax = runNode(["scripts/syntax-check.mjs"]);
const tests = runNode(["--test", "test/*.test.js"]);
const scan = runNode(["scripts/repository-scan.mjs"]);
const testOutput = `${tests.stdout}\n${tests.stderr}`;
const results = [];

for (const iteration of manifest.iterations) {
  const artifacts = [];
  for (const relative of iteration.artifacts) artifacts.push({ path: relative, present: await exists(relative) });
  const requiredTests = iteration.tests.map((name) => ({ name, passed: tests.ok && testOutput.includes(`✔ ${name}`) }));
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
  results.push({ id: iteration.id, complete, artifacts, tests: requiredTests, externalEvidence });
}

const report = {
  schemaVersion: 1,
  prdVersion: manifest.prdVersion,
  generatedAt: new Date().toISOString(),
  commands: {
    syntax: { command: "node scripts/syntax-check.mjs", ok: syntax.ok },
    unit: { command: "node --test \"test/*.test.js\"", ok: tests.ok },
    repositoryScan: { command: "node scripts/repository-scan.mjs", ok: scan.ok },
  },
  summary: {
    completed: results.filter(({ complete }) => complete).map(({ id }) => id),
    blocked: results.filter(({ complete }) => !complete).map(({ id }) => id),
    allComplete: results.every(({ complete }) => complete),
  },
  iterations: results,
};
const canonical = JSON.stringify(report);
report.reportSha256 = createHash("sha256").update(canonical).digest("hex");
await mkdir(path.join(root, "output"), { recursive: true });
await writeFile(path.join(root, "output", "iteration-acceptance-report.json"), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "w" });
process.stdout.write(`${JSON.stringify(report.summary)}\nreportSha256=${report.reportSha256}\n`);
if (!report.summary.allComplete) process.exitCode = 1;
