import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { createApp } from "../src/app.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";

const PROFILE_PATH = "config/nfr-004-load-profile.json";
const OUTPUT_DIRECTORY = path.resolve("evidence", "raw");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assertProfile(profile) {
  if (profile?.profileId !== "oracle-nfr004-mixed-synthetic-v1" || profile.syntheticOnly !== true || profile.network !== "none") throw new Error("NFR004_PROFILE_IDENTITY_INVALID");
  if (profile.resources?.cpuCount !== 2 || profile.resources?.memoryMiB !== 1024 || profile.resources?.pidsMaximum !== 256) throw new Error("NFR004_PROFILE_RESOURCE_CONTRACT_INVALID");
  if (profile.measuredRequests !== 240000 || profile.concurrencyMaximum !== 64 || profile.phases?.length !== 3) throw new Error("NFR004_PROFILE_LOAD_CONTRACT_INVALID");
  const [warmup, steady, burst] = profile.phases;
  if (warmup.name !== "warmup" || warmup.measured !== false || warmup.durationSeconds !== 300 || warmup.requestsPerSecond !== 50
    || steady.name !== "steady" || steady.measured !== true || steady.durationSeconds !== 1800 || steady.requestsPerSecond !== 100
    || burst.name !== "burst" || burst.measured !== true || burst.durationSeconds !== 300 || burst.requestsPerSecond !== 200
    || steady.durationSeconds * steady.requestsPerSecond + burst.durationSeconds * burst.requestsPerSecond !== profile.measuredRequests) throw new Error("NFR004_PROFILE_PHASE_CONTRACT_INVALID");
  return true;
}

async function assertCgroupResources(profile) {
  if (process.platform !== "linux") throw new Error("NFR004_REMOTE_LINUX_REQUIRED");
  const [cpuText, memoryText, pidsText] = await Promise.all([
    readFile("/sys/fs/cgroup/cpu.max", "utf8"),
    readFile("/sys/fs/cgroup/memory.max", "utf8"),
    readFile("/sys/fs/cgroup/pids.max", "utf8"),
  ]);
  const [quotaText, periodText] = cpuText.trim().split(/\s+/);
  const cpuQuota = quotaText === "max" ? Number.POSITIVE_INFINITY : Number(quotaText) / Number(periodText);
  const memoryBytes = memoryText.trim() === "max" ? Number.POSITIVE_INFINITY : Number(memoryText.trim());
  const pidsMaximum = pidsText.trim() === "max" ? Number.POSITIVE_INFINITY : Number(pidsText.trim());
  const expectedBytes = profile.resources.memoryMiB * 1024 * 1024;
  if (cpuQuota !== profile.resources.cpuCount || memoryBytes !== expectedBytes || pidsMaximum !== profile.resources.pidsMaximum) throw new Error("NFR004_CGROUP_RESOURCE_MISMATCH");
  return Object.freeze({ cpuQuota, memoryBytes, pidsMaximum });
}

function seedSyntheticRuntime(runtime) {
  const observedAt = new Date().toISOString();
  runtime.recordStore.putAsset({
    assetId: "nfr004-synthetic-asset",
    assetFingerprintHash: HASH_A,
    wenbaoRegistryRef: "synthetic:nfr004-registry",
    transferEligibility: "VALID",
    warehouseId: "synthetic-nfr004-warehouse",
    warehouseReceiptHash: HASH_C,
    currentCertificateHash: HASH_B,
    currentCertificateVersion: 1,
    currentOwnerCommitment: HASH_C,
    encumbranceStatus: "CLEAR",
    oracleStatus: "VALID",
    updatedAt: observedAt,
  });
  runtime.recordStore.appendCertificate({
    assetId: "nfr004-synthetic-asset",
    tokenId: "1",
    certificateVersion: 1,
    certificateHash: HASH_B,
    previousCertificateHash: null,
    wenbaoChangeRef: "synthetic:nfr004-change",
    warehouseReceiptHash: HASH_C,
    effectiveAt: observedAt,
    status: "CURRENT",
  });
  runtime.recordStore.putWarehouse({
    assetId: "nfr004-synthetic-asset",
    warehouseId: "synthetic-nfr004-warehouse",
    warehouseReceiptHash: HASH_C,
    warehouseStatus: "IN_CUSTODY",
    holderCommitment: HASH_C,
    observedAt,
  });
  runtime.stateEngine.transition({
    subjectId: "nfr004-synthetic-asset",
    to: "VALID",
    reasonHash: HASH_A,
    evidenceVersion: 1,
    occurredAt: observedAt,
  });
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)];
}

async function runPhase({ phase, baseUrl, concurrencyMaximum, collectLatency }) {
  const target = phase.durationSeconds * phase.requestsPerSecond;
  const queue = [];
  const latencies = collectLatency ? [] : null;
  let scheduled = 0;
  let active = 0;
  let completed = 0;
  let failed = 0;
  let application5xx = 0;
  let maximumBacklog = 0;
  let drainResolver = null;
  let schedulingEnded = false;
  const paths = ["/readyz", "/v1/oracle/statuses", "/v1/rwa/assets/nfr004-synthetic-asset"];

  function checkDrained() {
    if (schedulingEnded && queue.length === 0 && active === 0) drainResolver?.();
  }

  function pump() {
    while (active < concurrencyMaximum && queue.length > 0) {
      const ordinal = queue.shift();
      active += 1;
      const requestPath = paths[ordinal % paths.length];
      const startedAt = performance.now();
      void (async () => {
        const response = await fetch(new URL(requestPath, baseUrl));
        if (response.status >= 500) application5xx += 1;
        const body = await response.json();
        if (response.status !== 200) throw new Error(`HTTP_STATUS_${response.status}`);
        if (requestPath === "/readyz" && body.ok !== true) throw new Error("READINESS_BODY_INVALID");
        if (requestPath === "/v1/oracle/statuses" && !Array.isArray(body.statuses)) throw new Error("STATUSES_BODY_INVALID");
        if (requestPath === "/v1/rwa/assets/nfr004-synthetic-asset" && (body.status !== "VALID" || body.currentCertificate?.certificateHash !== HASH_B)) throw new Error("ASSET_FACTS_BODY_INVALID");
        if (latencies) latencies.push(performance.now() - startedAt);
      })().catch(() => {
        failed += 1;
      }).finally(() => {
        completed += 1;
        active -= 1;
        pump();
        checkDrained();
      });
    }
    checkDrained();
  }

  const startedAt = performance.now();
  for (;;) {
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    const due = Math.min(target, Math.floor(elapsedSeconds * phase.requestsPerSecond));
    while (scheduled < due) queue.push(scheduled++);
    maximumBacklog = Math.max(maximumBacklog, queue.length);
    pump();
    if (elapsedSeconds >= phase.durationSeconds) {
      while (scheduled < target) queue.push(scheduled++);
      maximumBacklog = Math.max(maximumBacklog, queue.length);
      schedulingEnded = true;
      pump();
      break;
    }
    await sleep(10);
  }

  const drainStartedAt = performance.now();
  await new Promise((resolve) => {
    drainResolver = resolve;
    checkDrained();
  });
  const backlogDrainSeconds = (performance.now() - drainStartedAt) / 1000;
  if (completed !== target) throw new Error("NFR004_REQUEST_COUNT_MISMATCH");
  if (!phase.measured && failed !== 0) throw new Error("NFR004_WARMUP_REQUEST_FAILED");
  return Object.freeze({
    phase: phase.name,
    requestsScheduled: scheduled,
    responsesCompleted: completed,
    unexpectedFailures: failed,
    application5xx,
    maximumQueuedBacklog: maximumBacklog,
    backlogDrainSeconds,
    p95Milliseconds: latencies ? percentile(latencies, 0.95) : null,
    p99Milliseconds: latencies ? percentile(latencies, 0.99) : null,
  });
}

async function collectResources({ memoryLimitBytes, cpuCount }) {
  let stopped = false;
  let timer = null;
  let sampleError = null;
  let peakMemoryPercent = 0;
  const cpuFiveMinuteAverages = [];
  let cpuWindowStartedAt = performance.now();
  let cpuWindowUsage = process.cpuUsage();
  async function sample() {
    if (stopped) return;
    try {
      const memoryBytes = Number((await readFile("/sys/fs/cgroup/memory.current", "utf8")).trim());
      if (!Number.isFinite(memoryBytes)) throw new Error("NFR004_MEMORY_SAMPLE_INVALID");
      peakMemoryPercent = Math.max(peakMemoryPercent, memoryBytes / memoryLimitBytes * 100);
      const now = performance.now();
      const windowSeconds = (now - cpuWindowStartedAt) / 1000;
      if (windowSeconds >= 300) {
        const delta = process.cpuUsage(cpuWindowUsage);
        const usedSeconds = (delta.user + delta.system) / 1_000_000;
        cpuFiveMinuteAverages.push(100 * usedSeconds / (windowSeconds * cpuCount));
        cpuWindowUsage = process.cpuUsage();
        cpuWindowStartedAt = now;
      }
    } catch {
      sampleError = "NFR004_RESOURCE_SAMPLE_FAILED";
    }
    timer = setTimeout(sample, 1000);
  }
  timer = setTimeout(sample, 0);
  return Object.freeze({
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await sleep(0);
      if (sampleError) throw new Error(sampleError);
      if (cpuFiveMinuteAverages.length === 0) throw new Error("NFR004_CPU_WINDOW_MISSING");
      return Object.freeze({ cpuFiveMinuteAveragePercent: Math.max(...cpuFiveMinuteAverages), cpuFiveMinuteWindowCount: cpuFiveMinuteAverages.length, memoryPeakPercent });
    },
  });
}

const profile = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
assertProfile(profile);
const resources = await assertCgroupResources(profile);
const candidateCommit = process.env.I12_CANDIDATE_COMMIT;
if (!/^[a-f0-9]{40}$/.test(candidateCommit ?? "")) throw new Error("I12_CANDIDATE_COMMIT_INVALID");

const runtime = createSyntheticRuntime();
seedSyntheticRuntime(runtime);
const server = createApp({ config: { environment: "test", externalWritesEnabled: false }, sourceRegistry: runtime.sourceRegistry, runtime });
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const sampler = await collectResources({ memoryLimitBytes: resources.memoryBytes, cpuCount: resources.cpuQuota });
const phaseResults = [];
const runStartedAt = new Date().toISOString();
let interrupted = false;
try {
  for (const phase of profile.phases) phaseResults.push(await runPhase({ phase, baseUrl, concurrencyMaximum: profile.concurrencyMaximum, collectLatency: phase.measured }));
} catch (error) {
  interrupted = true;
  throw error;
} finally {
  let resourceResults = null;
  let cleanupFailure = null;
  try {
    resourceResults = await sampler.stop();
  } catch (error) {
    cleanupFailure = error instanceof Error ? error.message : String(error);
  }
  try {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } catch (error) {
    cleanupFailure ??= error instanceof Error ? error.message : String(error);
  }
  const measured = phaseResults.filter(({ phase }) => phase !== "warmup");
  const steady = measured.find(({ phase }) => phase === "steady");
  const burst = measured.find(({ phase }) => phase === "burst");
  const requestsCompleted = measured.reduce((total, phase) => total + phase.responsesCompleted, 0);
  const unexpectedFailures = measured.reduce((total, phase) => total + phase.unexpectedFailures, 0);
  const application5xx = measured.reduce((total, phase) => total + phase.application5xx, 0);
  const report = {
    schemaVersion: 1,
    type: "performance-capacity-observation",
    status: "MEASURED_NOT_ACCEPTANCE",
    candidateCommit,
    profileId: profile.profileId,
    network: "loopback-only",
    syntheticOnly: true,
    startedAt: runStartedAt,
    finishedAt: new Date().toISOString(),
    runtime: { platform: process.platform, nodeVersion: process.version, pid: process.pid, runnerInstances: 1, interrupted },
    cleanupFailure,
    resources: { cpuQuota: resources.cpuQuota, memoryLimitBytes: resources.memoryBytes, pidsMaximum: resources.pidsMaximum },
    requestsCompleted,
    requestsExpected: profile.measuredRequests,
    unexpectedFailureRatePercent: requestsCompleted === 0 ? null : unexpectedFailures / requestsCompleted * 100,
    application5xx,
    steadyP95Milliseconds: steady?.p95Milliseconds ?? null,
    burstP95Milliseconds: burst?.p95Milliseconds ?? null,
    steadyBacklogMaximum: steady?.maximumQueuedBacklog ?? null,
    burstBacklogMaximum: burst?.maximumQueuedBacklog ?? null,
    backlogDrainSecondsMaximum: Math.max(...measured.map(({ backlogDrainSeconds }) => backlogDrainSeconds), 0),
    ...(resourceResults ?? { cpuFiveMinuteAveragePercent: null, cpuFiveMinuteWindowCount: 0, memoryPeakPercent: null }),
    faultMatrix: { status: "NOT_RUN_BY_CAPACITY_RUNNER", passed: 0, required: profile.faultMatrix },
    phases: phaseResults,
  };
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const outputPath = path.join(OUTPUT_DIRECTORY, `nfr004-capacity-observation-${candidateCommit}.json`);
  await writeFile(outputPath, bytes, { flag: "wx", mode: 0o600 });
  process.stdout.write(`NFR-004 capacity observation written: ${outputPath}\nSHA-256: ${digest}\nStatus: MEASURED_NOT_ACCEPTANCE (fault matrix and independent evidence remain separate)\n`);
}
