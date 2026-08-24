import assert from "node:assert/strict";
import test from "node:test";
import { validateI12Evidence } from "../src/services/i12-evidence.js";
const HASH = "a".repeat(64);
test("I12 evidence validator rejects shortened stability claims", () => {
  const base = { schemaVersion: 1, type: "72h-stability", status: "PASS", artifactSha256: HASH, durationSeconds: 259200, continuous: true, sampleCount: 4320, secretScanPassed: true, unexplainedFailures: 0 };
  assert.equal(validateI12Evidence("72h-stability", base), true);
  assert.throws(() => validateI12Evidence("72h-stability", { ...base, durationSeconds: 3600 }), /I12_STABILITY_INSUFFICIENT/);
});
test("I12 evidence validator requires security privacy and legal acceptance", () => {
  const reviews = ["security", "privacy", "legal"].map((role) => ({ role, accepted: true, reviewerRef: `${role}-reviewer`, evidenceSha256: HASH }));
  const base = { schemaVersion: 1, type: "independent-reviews", status: "PASS", artifactSha256: HASH, reviews, unacceptedP0: 0 };
  assert.equal(validateI12Evidence("independent-reviews", base), true);
  assert.throws(() => validateI12Evidence("independent-reviews", { ...base, reviews: reviews.slice(0, 2) }), /I12_REVIEW_INSUFFICIENT:legal/);
});

