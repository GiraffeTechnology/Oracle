import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Run the real CLI and real Node test subprocesses in an isolated fixture. Never
// recurse into the repository suite or substitute a fabricated reporter result.
function execute(t, { version = "v0.4", requirementIds = ["NFR-004"], requiredTest = "acceptance fixture", requirements = ["NFR-004"], testSource, syntaxExit = 0, scanExit = 0, artifact = true, evidence, forceColor = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "oracle-iteration-executor-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["scripts", "src/services", "config", "test", "evidence/acceptance"]) mkdirSync(path.join(root, directory), { recursive: true });
  for (const relative of ["scripts/verify-iterations.mjs", "src/services/i12-evidence.js"]) copyFileSync(new URL(`../${relative}`, import.meta.url), path.join(root, relative));
  const write = (relative, value) => writeFileSync(path.join(root, relative), value);
  write("package.json", JSON.stringify({ type: "module" }));
  write("scripts/syntax-check.mjs", `process.exitCode = ${syntaxExit};`);
  write("scripts/repository-scan.mjs", `process.exitCode = ${scanExit};`);
  write("test/fixture.test.js", testSource ?? 'import test from "node:test"; test("acceptance fixture", () => {});');
  if (artifact) write("artifact.txt", "fixture only");
  const externalEvidence = evidence === undefined ? [] : ["evidence/acceptance/i12-72h-stability.json"];
  if (evidence !== undefined && evidence !== null) write(externalEvidence[0], JSON.stringify(evidence));
  write("config/iteration-acceptance.json", JSON.stringify({ prdVersion: version, iterations: [{ id: "I12", requirementIds, artifacts: ["artifact.txt"], tests: [requiredTest], externalEvidence }] }));
  write("config/prd-v0.4-acceptance.json", JSON.stringify({ prdVersion: "v0.4", requirements: requirements.map((id) => ({ id })) }));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  if (forceColor) {
    env.FORCE_COLOR = "1";
    delete env.NO_COLOR;
    delete env.NODE_DISABLE_COLORS;
  }
  const result = spawnSync(process.execPath, ["scripts/verify-iterations.mjs"], { cwd: root, env, encoding: "utf8", timeout: 15000 });
  assert.equal(result.error, undefined);
  let report;
  try { report = JSON.parse(readFileSync(path.join(root, "output/iteration-acceptance-report.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  return { ...result, report };
}

test("iteration executor emits a hash-verifiable report for passing fixture evidence", (t) => {
  const { status, report } = execute(t);
  assert.equal(status, 0, JSON.stringify(report));
  assert.deepEqual(report.summary, { completed: ["I12"], blocked: [], allComplete: true });
  const { reportSha256, ...unsigned } = report;
  assert.equal(reportSha256, createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"));
  assert.deepEqual(report.traceability.unmappedRequirementIds, []);
  assert.equal(report.iterations[0].tests[0].passed, true);
});


test("iteration executor disables inherited forced colors in verification children", (t) => {
  const { status, report } = execute(t, {
    forceColor: true,
    testSource: 'import test from "node:test"; import assert from "node:assert/strict"; test("acceptance fixture", () => { assert.equal(process.env.FORCE_COLOR, undefined); assert.equal(process.env.NO_COLOR, "1"); assert.equal(process.env.NODE_DISABLE_COLORS, "1"); });',
  });
  assert.equal(status, 0, JSON.stringify(report));
  assert.equal(report.commands.unit.ok, true);
  assert.equal(report.iterations[0].tests[0].passed, true);
  assert.equal(report.summary.allComplete, true);
});

for (const [label, options, code] of [
  ["version drift", { version: "v0.3" }, "ITERATION_PRD_VERSION_MISMATCH:v0.3:v0.4"],
  ["missing mapping", { requirementIds: [] }, "ITERATION_REQUIREMENT_MAPPING_MISSING:I12"],
  ["unmapped requirement", { requirements: ["NFR-004", "NFR-001"] }, "ITERATION_REQUIREMENT_UNMAPPED:NFR-001"],
  ["unknown requirement", { requirementIds: ["UNKNOWN"] }, "ITERATION_REQUIREMENT_UNKNOWN:I12:UNKNOWN"],
]) test(`iteration executor rejects ${label}`, (t) => {
  const result = execute(t, options);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(code), result.stderr);
  assert.equal(result.report, undefined);
});

for (const [label, options] of [
  ["missing required test", { requiredTest: "unexecuted fixture" }],
  ["prefix-only test name", { requiredTest: "acceptance" }],
  ["skipped required test", { testSource: 'import test from "node:test"; test.skip("acceptance fixture", () => {});' }],
  ["failed test command", { testSource: 'import test from "node:test"; test("acceptance fixture", () => {}); test("failure", () => { throw new Error("expected fixture failure"); });' }],
  ["failed syntax command", { syntaxExit: 1 }],
  ["failed repository scan", { scanExit: 1 }],
  ["missing artifact", { artifact: false }],
  ["missing I12 evidence", { evidence: null }],
  ["invalid I12 evidence", { evidence: { schemaVersion: 1, type: "72h-stability", status: "PASS" } }],
]) for (const forceColor of [false, true]) test(`iteration executor remains blocked on ${label}${forceColor ? " with forced colors" : ""}`, (t) => {
  const { status, report } = execute(t, { ...options, forceColor });
  assert.equal(status, 1);
  assert.deepEqual(report.summary, { completed: [], blocked: ["I12"], allComplete: false });
  assert.equal(report.iterations[0].complete, false);
  if (label === "missing I12 evidence") assert.equal(report.iterations[0].externalEvidence[0].errorCode, "EVIDENCE_NOT_FOUND");
  if (label === "invalid I12 evidence") assert.equal(report.iterations[0].externalEvidence[0].valid, false);
});
