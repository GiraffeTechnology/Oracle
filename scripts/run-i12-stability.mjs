import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";

const REQUIRED_SECONDS = 259200;
const SAMPLE_INTERVAL_MS = 60000;
const MAX_SAMPLE_GAP_MS = 120000;
const outputDirectory = path.resolve("evidence", "acceptance");
const rawDirectory = path.resolve("evidence", "raw");
const acceptancePath = path.join(outputDirectory, "i12-72h-stability.json");
const rawPath = path.join(rawDirectory, "i12-72h-observations.json");
const observations = [];
const candidateCommit = process.env.I12_CANDIDATE_COMMIT;
if (!/^[a-f0-9]{40}$/.test(candidateCommit ?? "")) throw new Error("I12_CANDIDATE_COMMIT_INVALID");
const runtime = createSyntheticRuntime();
const started = Date.now();
let lastSample = started;
let continuous = true;
let unexplainedFailures = 0;

function scan() {
  return spawnSync(process.execPath, ["scripts/repository-scan.mjs"], { cwd: process.cwd(), encoding: "utf8", windowsHide: true }).status === 0;
}

function sample(index) {
  const now = Date.now();
  if (now - lastSample > MAX_SAMPLE_GAP_MS) continuous = false;
  lastSample = now;
  const assetId = `stability-${index}`;
  const hash = createHash("sha256").update(assetId).digest("hex");
  try {
    runtime.recordStore.putAsset({ assetId, assetFingerprintHash: hash });
    runtime.recordStore.appendCertificate({ assetId, certificateHash: hash, certificateVersion: 1 });
    runtime.recordStore.putWarehouse({ assetId, warehouseReceiptHash: hash });
    runtime.stateEngine.transition({ subjectId: assetId, to: "VALID", reasonHash: hash, evidenceVersion: 1, occurredAt: new Date(now).toISOString() });
    if (runtime.stateEngine.current(assetId) !== "VALID" || !runtime.auditJournal.verify()) throw new Error("INVARIANT_FAILED");
    observations.push({ index, observedAt: new Date(now).toISOString(), elapsedSeconds: Math.floor((now - started) / 1000), heapUsed: process.memoryUsage().heapUsed, ok: true });
  } catch (error) {
    unexplainedFailures += 1;
    observations.push({ index, observedAt: new Date(now).toISOString(), elapsedSeconds: Math.floor((now - started) / 1000), ok: false, errorCode: error.message });
  }
}

if (!scan()) throw new Error("I12_INITIAL_REPOSITORY_SCAN_FAILED");
for (let index = 0; Date.now() - started < REQUIRED_SECONDS * 1000; index += 1) {
  sample(index);
  const remaining = REQUIRED_SECONDS * 1000 - (Date.now() - started);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(SAMPLE_INTERVAL_MS, remaining)));
}
sample(observations.length);
const secretScanPassed = scan();
const completed = Date.now();
const sampleIntervals = observations.slice(1).map((item, index) => (Date.parse(item.observedAt) - Date.parse(observations[index].observedAt)) / 1000);
const maxSampleIntervalSeconds = Math.max(0, ...sampleIntervals);
const successfulSamples = observations.filter((item) => item.ok).length;
const availabilityPercent = (successfulSamples / observations.length) * 100;
const raw = { schemaVersion: 1, startedAt: new Date(started).toISOString(), completedAt: new Date(completed).toISOString(), observations };
const rawText = `${JSON.stringify(raw, null, 2)}\n`;
const artifactSha256 = createHash("sha256").update(rawText).digest("hex");
const report = {
  schemaVersion: 1,
  type: "72h-stability",
  status: continuous && secretScanPassed && unexplainedFailures === 0 ? "PASS" : "FAIL",
  candidateCommit,
  artifactSha256,
  durationSeconds: Math.floor((completed - started) / 1000),
  continuous,
  sampleCount: observations.length,
  maxSampleIntervalSeconds,
  availabilityPercent,
  secretScanPassed,
  unexplainedFailures,
  rawEvidenceRef: "evidence/raw/i12-72h-observations.json"
};
await mkdir(outputDirectory, { recursive: true });
await mkdir(rawDirectory, { recursive: true });
await writeFile(rawPath, rawText, { encoding: "utf8", flag: "wx" });
await writeFile(acceptancePath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({ status: report.status, artifactSha256, durationSeconds: report.durationSeconds, sampleCount: report.sampleCount })}\n`);
if (report.status !== "PASS") process.exitCode = 1;
