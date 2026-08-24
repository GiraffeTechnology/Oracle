import assert from "node:assert/strict";
import test from "node:test";
import { validateI12Evidence } from "../src/services/i12-evidence.js";
const HASH = "a".repeat(64);
test("I12 evidence validator rejects shortened stability claims", () => {
  const base = { schemaVersion: 1, type: "72h-stability", status: "PASS", artifactSha256: HASH, durationSeconds: 259200, continuous: true, sampleCount: 4320, secretScanPassed: true, unexplainedFailures: 0 };
  assert.equal(validateI12Evidence("72h-stability", base), true);
  assert.throws(() => validateI12Evidence("72h-stability", { ...base, durationSeconds: 3600 }), /I12_STABILITY_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("72h-stability", { ...base, durationSeconds: undefined }), /I12_STABILITY_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("72h-stability", { ...base, sampleCount: Number.NaN }), /I12_STABILITY_INSUFFICIENT/);
});
test("I12 evidence validator requires security privacy and legal acceptance", () => {
  const reviews = ["security", "privacy", "legal"].map((role) => ({ role, accepted: true, reviewerRef: `${role}-reviewer`, evidenceSha256: HASH }));
  const base = { schemaVersion: 1, type: "independent-reviews", status: "PASS", artifactSha256: HASH, reviews, unacceptedP0: 0 };
  assert.equal(validateI12Evidence("independent-reviews", base), true);
  assert.throws(() => validateI12Evidence("independent-reviews", { ...base, reviews: reviews.slice(0, 2) }), /I12_REVIEW_INSUFFICIENT:legal/);
  assert.throws(() => validateI12Evidence("independent-reviews", { ...base, reviews: reviews.map((review) => ({ ...review, reviewerRef: "same-reviewer" })) }), /I12_REVIEWS_NOT_INDEPENDENT/);
});
test("I12 evidence validator requires every security gate and reproducible builds", () => {
  const gates = Object.fromEntries(["sast", "dependency", "secret", "container", "iac", "api", "penetration"].map((gate) => [gate, "PASS"]));
  assert.equal(validateI12Evidence("security-scans", { schemaVersion: 1, type: "security-scans", status: "PASS", artifactSha256: HASH, gates, unacceptedP0: 0 }), true);
  assert.throws(() => validateI12Evidence("security-scans", { schemaVersion: 1, type: "security-scans", status: "PASS", artifactSha256: HASH, gates: { ...gates, penetration: "MISSING" }, unacceptedP0: 0 }), /I12_SECURITY_GATE_INSUFFICIENT/);
  assert.equal(validateI12Evidence("reproducible-build", { schemaVersion: 1, type: "reproducible-build", status: "PASS", artifactSha256: HASH, buildOneSha256: HASH, buildTwoSha256: HASH, sbomVerified: true, artifactSignatureVerified: true }), true);
});
test("I12 evidence validator rejects omitted and non-finite capacity or recovery metrics", () => {
  const evidence = { schemaVersion: 1, status: "PASS", artifactSha256: HASH };
  assert.throws(() => validateI12Evidence("performance-capacity", { ...evidence, type: "performance-capacity", loadProfileRef: "controlled/load-profile", faultInjectionPassed: true }), /I12_PERFORMANCE_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("performance-capacity", { ...evidence, type: "performance-capacity", loadProfileRef: "controlled/load-profile", requestsCompleted: 1, p95Milliseconds: Infinity, queueBacklogMaximum: 0, faultInjectionPassed: true }), /I12_PERFORMANCE_INSUFFICIENT/);
  assert.throws(() => validateI12Evidence("restore-drill", { ...evidence, type: "restore-drill", databaseIntegrityVerified: true, auditHeadVerified: true }), /I12_RESTORE_DRILL_INSUFFICIENT/);
  assert.equal(validateI12Evidence("restore-drill", { ...evidence, type: "restore-drill", databaseIntegrityVerified: true, auditHeadVerified: true, rpoSecondsTarget: 300, rpoSecondsActual: 120, rtoSecondsTarget: 900, rtoSecondsActual: 600 }), true);
});

