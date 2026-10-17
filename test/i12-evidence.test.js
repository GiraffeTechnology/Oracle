import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { I12_INDEPENDENT_REVIEW_ROLES, I12_NFR004_FAULT_CASES, I12_PERFORMANCE_FIELDS, validateI12Evidence } from "../src/services/i12-evidence.js";
const HASH = "a".repeat(64);
const COMMIT = "b".repeat(40);
const faultMatrix = (candidateCommit = COMMIT) => I12_NFR004_FAULT_CASES.map((caseId, index) => ({
  caseId,
  status: "PASS",
  candidateCommit,
  evidenceRef: `evidence/raw/fault-${index + 1}.json`,
  evidenceSha256: HASH,
}));
test("I12 evidence validator rejects shortened stability claims", () => {
  const base = { schemaVersion: 1, type: "72h-stability", status: "PASS", artifactSha256: HASH, candidateCommit: COMMIT, durationSeconds: 259200, continuous: true, sampleCount: 4320, maxSampleIntervalSeconds: 60, secretScanPassed: true, unexplainedFailures: 0 };
  assert.equal(validateI12Evidence("72h-stability", base), true);
  assert.throws(() => validateI12Evidence("72h-stability", { ...base, durationSeconds: 3600 }), /I12_STABILITY_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("72h-stability", { ...base, durationSeconds: undefined }), /I12_STABILITY_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("72h-stability", { ...base, sampleCount: Number.NaN }), /I12_STABILITY_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("72h-stability", { ...base, maxSampleIntervalSeconds: 121 }), /I12_STABILITY_INSUFFICIENT/);
});

test("I12 stability enforces 99.9 percent availability and derives it for the frozen runner", () => {
  const base = { schemaVersion: 1, type: "72h-stability", status: "PASS", artifactSha256: "a".repeat(64), candidateCommit: COMMIT, durationSeconds: 259200, continuous: true, sampleCount: 4321, maxSampleIntervalSeconds: 60, secretScanPassed: true, unexplainedFailures: 0 };
  assert.equal(validateI12Evidence("72h-stability", base), true);
  assert.throws(() => validateI12Evidence("72h-stability", { ...base, availabilityPercent: 99.8 }), /I12_AVAILABILITY_INSUFFICIENT/);
});
test("I12 evidence validator requires five independent production-candidate reviews", () => {
  const reviews = I12_INDEPENDENT_REVIEW_ROLES.map((role) => ({ role, accepted: true, reviewerRef: `${role}-reviewer`, candidateCommit: COMMIT, evidenceRef: `evidence/stage-f/${role}-review.json`, evidenceSha256: HASH }));
  const base = { schemaVersion: 1, type: "independent-reviews", status: "PASS", artifactSha256: HASH, candidateCommit: COMMIT, reviews, unacceptedP0: 0 };
  assert.equal(validateI12Evidence("independent-reviews", base), true);
  assert.throws(() => validateI12Evidence("independent-reviews", { ...base, reviews: reviews.slice(0, 2) }), /I12_REVIEW_INSUFFICIENT:legal/);
  assert.throws(() => validateI12Evidence("independent-reviews", { ...base, reviews: reviews.map((review) => ({ ...review, reviewerRef: "same-reviewer" })) }), /I12_REVIEWS_NOT_INDEPENDENT/);
  assert.throws(() => validateI12Evidence("independent-reviews", { ...base, reviews: reviews.map((review, index) => index === 0 ? { ...review, candidateCommit: "c".repeat(40) } : review) }), /I12_REVIEW_INSUFFICIENT:security/);
  assert.throws(() => validateI12Evidence("independent-reviews", { ...base, reviews: reviews.map((review, index) => index === 0 ? { ...review, evidenceRef: "" } : review) }), /I12_REVIEW_INSUFFICIENT:security/);
  assert.throws(() => validateI12Evidence("independent-reviews", { ...base, reviews: reviews.map((review, index) => index === 0 ? { ...review, evidenceRef: reviews[1].evidenceRef } : review) }), /I12_REVIEW_EVIDENCE_NOT_INDEPENDENT/);
  assert.throws(() => validateI12Evidence("independent-reviews", { ...base, reviews: [...reviews, reviews[0]] }), /I12_REVIEW_MATRIX_INSUFFICIENT/);
});
test("I12 evidence validator requires every security gate and reproducible builds", () => {
  const gates = Object.fromEntries(["sast", "dependency", "secret", "container", "iac", "api", "penetration"].map((gate) => [gate, "PASS"]));
  assert.equal(validateI12Evidence("security-scans", { schemaVersion: 1, type: "security-scans", status: "PASS", artifactSha256: HASH, candidateCommit: COMMIT, gates, unacceptedP0: 0 }), true);
  assert.throws(() => validateI12Evidence("security-scans", { schemaVersion: 1, type: "security-scans", status: "PASS", artifactSha256: HASH, candidateCommit: COMMIT, gates: { ...gates, penetration: "MISSING" }, unacceptedP0: 0 }), /I12_SECURITY_GATE_INSUFFICIENT/);
  assert.equal(validateI12Evidence("reproducible-build", { schemaVersion: 1, type: "reproducible-build", status: "PASS", artifactSha256: HASH, candidateCommit: COMMIT, buildOneSha256: HASH, buildTwoSha256: HASH, sbomVerified: true, artifactSignatureVerified: true }), true);
});
test("I12 evidence validator rejects omitted and non-finite capacity or recovery metrics", () => {
  const evidence = { schemaVersion: 1, status: "PASS", artifactSha256: HASH, candidateCommit: COMMIT };
  assert.throws(() => validateI12Evidence("performance-capacity", { ...evidence, type: "performance-capacity", loadProfileRef: "controlled/load-profile", faultInjectionPassed: true }), /I12_PERFORMANCE_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("performance-capacity", { ...evidence, type: "performance-capacity", loadProfileRef: "controlled/load-profile", requestsCompleted: 1, p95Milliseconds: Infinity, queueBacklogMaximum: 0, faultInjectionPassed: true }), /I12_PERFORMANCE_INSUFFICIENT/);
  const performance = { ...evidence, type: "performance-capacity", loadProfileRef: "oracle-nfr004-mixed-synthetic-v1", requestsCompleted: 240000, unexpectedFailureRatePercent: 0, application5xx: 0, processRestarts: 0, steadyP95Milliseconds: 100, burstP95Milliseconds: 200, steadyBacklogMaximum: 10, burstBacklogMaximum: 20, backlogDrainSeconds: 10, cpuFiveMinuteAveragePercent: 40, memoryPeakPercent: 50, faultInjectionPassed: true, faultMatrixPassed: 12, faultMatrix: faultMatrix() };
  assert.equal(validateI12Evidence("performance-capacity", performance), true);
  assert.throws(() => validateI12Evidence("performance-capacity", { ...performance, faultMatrix: faultMatrix(COMMIT.toUpperCase()) }), /I12_PERFORMANCE_FAULT_MATRIX_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("performance-capacity", { ...performance, faultMatrix: faultMatrix().slice(1) }), /I12_PERFORMANCE_FAULT_MATRIX_INSUFFICIENT/);
  const duplicatedCase = faultMatrix();
  duplicatedCase[1] = { ...duplicatedCase[1], caseId: duplicatedCase[0].caseId };
  assert.throws(() => validateI12Evidence("performance-capacity", { ...performance, faultMatrix: duplicatedCase }), /I12_PERFORMANCE_FAULT_MATRIX_INSUFFICIENT/);
  const missingDigest = faultMatrix();
  missingDigest[0] = { ...missingDigest[0], evidenceSha256: "not-a-sha256" };
  assert.throws(() => validateI12Evidence("performance-capacity", { ...performance, faultMatrix: missingDigest }), /I12_PERFORMANCE_FAULT_MATRIX_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("performance-capacity", { ...performance, faultMatrixPassed: 11 }), /I12_PERFORMANCE_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("restore-drill", { ...evidence, type: "restore-drill", databaseIntegrityVerified: true, auditHeadVerified: true }), /I12_RESTORE_DRILL_INSUFFICIENT/);
  assert.equal(validateI12Evidence("restore-drill", { ...evidence, type: "restore-drill", databaseIntegrityVerified: true, auditHeadVerified: true, rpoSecondsTarget: 300, rpoSecondsActual: 120, rtoSecondsTarget: 900, rtoSecondsActual: 600 }), true);
});

test("I12 signer rotation evidence requires finite timing controls", () => {
  const base = { schemaVersion: 1, type: "signer-rotation", status: "PASS", artifactSha256: HASH, candidateCommit: COMMIT, newSignerAccepted: true, oldSignerRejected: true, rotationAudited: true, auditChainVerified: true, dualApprovalVerified: true, timelockSeconds: 300, rollbackWindowSeconds: 3600, rollbackVerified: true, privateMaterialObserved: false, networkUsed: false, transactionSigned: false };
  assert.equal(validateI12Evidence("signer-rotation", base), true);
  assert.throws(() => validateI12Evidence("signer-rotation", { ...base, timelockSeconds: Number.NaN }), /I12_SIGNER_ROTATION_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("signer-rotation", { ...base, rollbackWindowSeconds: undefined }), /I12_SIGNER_ROTATION_INSUFFICIENT/);
});
test("blocked I12 template stays synchronized with the authoritative validator contract", () => {
  const template = JSON.parse(readFileSync(new URL("../evidence/templates/i12-evidence.blocked.example.json", import.meta.url), "utf8"));
  const loadProfile = JSON.parse(readFileSync(new URL("../config/nfr-004-load-profile.json", import.meta.url), "utf8"));
  assert.deepEqual(I12_NFR004_FAULT_CASES, loadProfile.faultMatrix);
  assert.equal(template.status, "BLOCKED");
  const performance = template.records["performance-capacity"];
  assert.deepEqual(
    Object.keys(performance).sort(),
    ["type", "candidateCommit", "artifactSha256", ...I12_PERFORMANCE_FIELDS].sort(),
  );
  assert.equal(performance.loadProfileRef, "oracle-nfr004-mixed-synthetic-v1");
  assert.deepEqual(
    template.records["independent-reviews"].reviews.map(({ role }) => role),
    I12_INDEPENDENT_REVIEW_ROLES,
  );
  for (const [type, record] of Object.entries(template.records)) {
    assert.throws(() => validateI12Evidence(type, { schemaVersion: template.schemaVersion, status: template.status, ...record }), new RegExp(`I12_EVIDENCE_INVALID:${type}`));
  }

  const evidence = { schemaVersion: 1, status: "PASS", artifactSha256: HASH, candidateCommit: COMMIT };
  const validPerformanceValues = {
    loadProfileRef: "oracle-nfr004-mixed-synthetic-v1",
    requestsCompleted: 240000,
    unexpectedFailureRatePercent: 0,
    application5xx: 0,
    processRestarts: 0,
    steadyP95Milliseconds: 100,
    burstP95Milliseconds: 200,
    steadyBacklogMaximum: 10,
    burstBacklogMaximum: 20,
    backlogDrainSeconds: 10,
    cpuFiveMinuteAveragePercent: 40,
    memoryPeakPercent: 50,
    faultInjectionPassed: true,
    faultMatrixPassed: 12,
    faultMatrix: faultMatrix(),
  };
  const validPerformance = {
    ...evidence,
    type: "performance-capacity",
    ...Object.fromEntries(I12_PERFORMANCE_FIELDS.map((field) => [field, validPerformanceValues[field]])),
  };
  assert.equal(validateI12Evidence("performance-capacity", validPerformance), true);
  for (const field of I12_PERFORMANCE_FIELDS) {
    const missing = { ...validPerformance };
    delete missing[field];
    assert.throws(() => validateI12Evidence("performance-capacity", missing), new RegExp(`I12_PERFORMANCE_INSUFFICIENT:${field}`));
  }

  const validReviews = I12_INDEPENDENT_REVIEW_ROLES.map((role) => ({ role, accepted: true, reviewerRef: `${role}-reviewer`, evidenceSha256: HASH }));
  const validIndependentReviews = { ...evidence, type: "independent-reviews", reviews: validReviews, unacceptedP0: 0 };
  assert.equal(validateI12Evidence("independent-reviews", validIndependentReviews), true);
  for (const role of I12_INDEPENDENT_REVIEW_ROLES) {
    assert.throws(
      () => validateI12Evidence("independent-reviews", { ...validIndependentReviews, reviews: validReviews.filter((review) => review.role !== role) }),
      new RegExp(`I12_REVIEW_INSUFFICIENT:${role}`),
    );
  }
});
