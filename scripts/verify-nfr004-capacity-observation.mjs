import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PROFILE_PATH = "config/nfr-004-load-profile.json";
const COMMIT = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(code) {
  throw new Error(code);
}

function assertProfile(profile) {
  if (profile?.profileId !== "oracle-nfr004-mixed-synthetic-v1" || profile.syntheticOnly !== true || profile.network !== "none") fail("NFR004_PROFILE_IDENTITY_INVALID");
  if (profile.measuredRequests !== 240000 || profile.concurrencyMaximum !== 64 || profile.phases?.length !== 3 || profile.faultMatrix?.length !== 12) fail("NFR004_PROFILE_CONTRACT_INVALID");
  const [warmup, steady, burst] = profile.phases;
  if (warmup.name !== "warmup" || warmup.measured !== false || warmup.durationSeconds !== 300 || warmup.requestsPerSecond !== 50
    || steady.name !== "steady" || steady.measured !== true || steady.durationSeconds !== 1800 || steady.requestsPerSecond !== 100
    || burst.name !== "burst" || burst.measured !== true || burst.durationSeconds !== 300 || burst.requestsPerSecond !== 200
    || steady.durationSeconds * steady.requestsPerSecond + burst.durationSeconds * burst.requestsPerSecond !== profile.measuredRequests) fail("NFR004_PHASE_CONTRACT_INVALID");
}

function assertPhase(observed, expected) {
  if (!observed || observed.phase !== expected.name || observed.requestsScheduled !== expected.durationSeconds * expected.requestsPerSecond
    || observed.responsesCompleted !== observed.requestsScheduled || !Number.isInteger(observed.unexpectedFailures) || observed.unexpectedFailures < 0
    || !Number.isInteger(observed.application5xx) || observed.application5xx < 0 || !Number.isFinite(observed.maximumQueuedBacklog)
    || !Number.isFinite(observed.backlogDrainSeconds) || observed.backlogDrainSeconds < 0) fail("NFR004_PHASE_OBSERVATION_INVALID");
  if (expected.measured && (!Number.isFinite(observed.p95Milliseconds) || !Number.isFinite(observed.p99Milliseconds))) fail("NFR004_LATENCY_OBSERVATION_MISSING");
  if (!expected.measured && observed.p95Milliseconds !== null) fail("NFR004_WARMUP_MUST_NOT_BE_MEASURED");
}

const candidateCommit = argument("--candidate-commit");
if (!COMMIT.test(candidateCommit ?? "")) fail("I12_CANDIDATE_COMMIT_INVALID");
const profile = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
assertProfile(profile);

const observationPath = path.resolve("evidence", "raw", `nfr004-capacity-observation-${candidateCommit}.json`);
const raw = await readFile(observationPath);
const observation = JSON.parse(raw.toString("utf8"));
if (observation?.schemaVersion !== 1 || observation.type !== "performance-capacity-observation"
  || observation.status !== "MEASURED_NOT_ACCEPTANCE" || observation.candidateCommit !== candidateCommit
  || observation.profileId !== profile.profileId || observation.network !== "loopback-only" || observation.syntheticOnly !== true) fail("NFR004_OBSERVATION_IDENTITY_INVALID");
if (observation.runtime?.platform !== "linux" || observation.runtime?.interrupted !== false || observation.cleanupFailure !== null) fail("NFR004_RUNTIME_OBSERVATION_INVALID");
if (observation.faultMatrix?.status !== "NOT_RUN_BY_CAPACITY_RUNNER" || observation.faultMatrix?.passed !== 0
  || JSON.stringify(observation.faultMatrix?.required) !== JSON.stringify(profile.faultMatrix)) fail("NFR004_FAULT_MATRIX_MUST_REMAIN_SEPARATE");

const startedAt = Date.parse(observation.startedAt);
const finishedAt = Date.parse(observation.finishedAt);
const minimumDurationMilliseconds = profile.phases.reduce((total, phase) => total + phase.durationSeconds, 0) * 1000;
if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt - startedAt < minimumDurationMilliseconds) fail("NFR004_OBSERVATION_TIME_RANGE_INVALID");

if (!Array.isArray(observation.phases) || observation.phases.length !== profile.phases.length) fail("NFR004_PHASE_COUNT_INVALID");
for (let index = 0; index < profile.phases.length; index += 1) assertPhase(observation.phases[index], profile.phases[index]);

const measured = observation.phases.filter((phase) => phase.phase !== "warmup");
const requestsCompleted = measured.reduce((total, phase) => total + phase.responsesCompleted, 0);
const requestsExpected = measured.reduce((total, phase) => total + phase.requestsScheduled, 0);
const unexpectedFailures = measured.reduce((total, phase) => total + phase.unexpectedFailures, 0);
const application5xx = measured.reduce((total, phase) => total + phase.application5xx, 0);
if (requestsCompleted !== profile.measuredRequests || requestsExpected !== profile.measuredRequests
  || observation.requestsCompleted !== requestsCompleted || observation.requestsExpected !== requestsExpected
  || observation.unexpectedFailureRatePercent !== (requestsCompleted === 0 ? null : unexpectedFailures / requestsCompleted * 100)
  || observation.application5xx !== application5xx) fail("NFR004_AGGREGATE_OBSERVATION_MISMATCH");

const observationSha256 = createHash("sha256").update(raw).digest("hex");
if (!HASH.test(observationSha256)) fail("NFR004_OBSERVATION_DIGEST_INVALID");
const verification = {
  schemaVersion: 1,
  type: "performance-capacity-observation-structure",
  status: "STRUCTURALLY_VERIFIED_NOT_ACCEPTANCE",
  candidateCommit,
  profileId: profile.profileId,
  observationFile: path.relative(process.cwd(), observationPath).replaceAll("\\\\", "/"),
  observationSha256,
  requestsExpected,
  requestsCompleted,
  unexpectedFailures,
  application5xx,
  faultMatrix: "NOT_RUN_BY_CAPACITY_RUNNER",
  acceptanceStatus: "NOT_ESTABLISHED",
  verifiedAt: new Date().toISOString(),
};
const outputPath = path.resolve("evidence", "raw", `nfr004-capacity-observation-verification-${candidateCommit}.json`);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(verification, null, 2)}\\n`, { flag: "wx", mode: 0o600 });
process.stdout.write(`Structural observation verification recorded (not acceptance): ${outputPath}\\nSHA-256: ${observationSha256}\\n`);
