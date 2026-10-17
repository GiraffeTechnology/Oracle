const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
export const I12_NFR004_FAULT_CASES = Object.freeze([
  "invalid-input",
  "unauthorized-write",
  "source-timeout",
  "source-invalid-proof",
  "mysql-interruption",
  "durability-failure",
  "outbox-pause",
  "evidence-storage-failure",
  "process-restart",
  "resource-reduction",
  "restore-tamper",
  "clock-skew",
]);
const PERFORMANCE_CONTRACT = Object.freeze({
  loadProfileRef: (value) => value === "oracle-nfr004-mixed-synthetic-v1",
  requestsCompleted: (value) => value === 240000,
  unexpectedFailureRatePercent: (value) => finiteNumber(value) && value <= 0.1,
  application5xx: (value) => value === 0,
  processRestarts: (value) => value === 0,
  steadyP95Milliseconds: (value) => finiteNumber(value, { minimum: Number.EPSILON }) && value <= 150,
  burstP95Milliseconds: (value) => finiteNumber(value, { minimum: Number.EPSILON }) && value <= 300,
  steadyBacklogMaximum: (value) => finiteNumber(value, { integer: true }) && value <= 64,
  burstBacklogMaximum: (value) => finiteNumber(value, { integer: true }) && value <= 256,
  backlogDrainSeconds: (value) => finiteNumber(value) && value <= 60,
  cpuFiveMinuteAveragePercent: (value) => finiteNumber(value) && value < 80,
  memoryPeakPercent: (value) => finiteNumber(value) && value < 85,
  faultInjectionPassed: (value) => value === true,
  faultMatrixPassed: (value) => value === I12_NFR004_FAULT_CASES.length,
  faultMatrix: Array.isArray,
});
export const I12_PERFORMANCE_FIELDS = Object.freeze(Object.keys(PERFORMANCE_CONTRACT));
export const I12_INDEPENDENT_REVIEW_ROLES = Object.freeze(["security", "privacy", "legal", "contract", "operations"]);function base(value, type) {
  if (!value || value.schemaVersion !== 1 || value.type !== type || value.status !== "PASS" || !HASH.test(value.artifactSha256 ?? "") || !COMMIT.test(value.candidateCommit ?? "")) throw new Error(`I12_EVIDENCE_INVALID:${type}`);
}
function finiteNumber(value, { minimum = 0, integer = false } = {}) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && (!integer || Number.isInteger(value));
}
function faultMatrixEvidenceValid(entries, candidateCommit) {
  if (!Array.isArray(entries) || entries.length !== I12_NFR004_FAULT_CASES.length) return false;
  const cases = new Set();
  const evidenceRefs = new Set();
  for (const entry of entries) {
    if (!entry || !I12_NFR004_FAULT_CASES.includes(entry.caseId) || cases.has(entry.caseId)
      || entry.status !== "PASS" || entry.candidateCommit !== candidateCommit
      || typeof entry.evidenceRef !== "string" || !entry.evidenceRef.trim()
      || !HASH.test(entry.evidenceSha256 ?? "") || evidenceRefs.has(entry.evidenceRef.trim())) return false;
    cases.add(entry.caseId);
    evidenceRefs.add(entry.evidenceRef.trim());
  }
  return cases.size === I12_NFR004_FAULT_CASES.length;
}
export function validateI12Evidence(type, value) {
  base(value, type);
  if (type === "security-scans") {
    for (const gate of ["sast", "dependency", "secret", "container", "iac", "api", "penetration"]) if (value.gates?.[gate] !== "PASS") throw new Error(`I12_SECURITY_GATE_INSUFFICIENT:${gate}`);
    if ((value.unacceptedP0 ?? 1) !== 0) throw new Error("I12_SECURITY_UNACCEPTED_P0");
  } else if (type === "performance-capacity") {
    for (const [field, accepts] of Object.entries(PERFORMANCE_CONTRACT)) if (!accepts(value[field])) throw new Error(`I12_PERFORMANCE_INSUFFICIENT:${field}`);
    if (!faultMatrixEvidenceValid(value.faultMatrix, value.candidateCommit)) throw new Error("I12_PERFORMANCE_FAULT_MATRIX_INSUFFICIENT");
  } else if (type === "72h-stability") {
    if (!finiteNumber(value.durationSeconds, { minimum: 259200 }) || value.continuous !== true || !finiteNumber(value.sampleCount, { minimum: 4320, integer: true }) || !finiteNumber(value.maxSampleIntervalSeconds) || value.maxSampleIntervalSeconds > 120 || value.secretScanPassed !== true || !finiteNumber(value.unexplainedFailures, { integer: true }) || value.unexplainedFailures !== 0) throw new Error("I12_STABILITY_INSUFFICIENT");
    const availabilityPercent = finiteNumber(value.availabilityPercent)
      ? value.availabilityPercent
      : ((value.sampleCount - value.unexplainedFailures) / value.sampleCount) * 100;
    if (!finiteNumber(availabilityPercent, { minimum: 99.9 }) || availabilityPercent > 100) throw new Error("I12_AVAILABILITY_INSUFFICIENT");
  } else if (type === "restore-drill") {
    if (value.databaseIntegrityVerified !== true || value.auditHeadVerified !== true || !finiteNumber(value.rpoSecondsTarget) || !finiteNumber(value.rpoSecondsActual) || !finiteNumber(value.rtoSecondsTarget) || !finiteNumber(value.rtoSecondsActual) || value.rpoSecondsActual > value.rpoSecondsTarget || value.rtoSecondsActual > value.rtoSecondsTarget) throw new Error("I12_RESTORE_DRILL_INSUFFICIENT");
  } else if (type === "signer-rotation") {
    if (value.newSignerAccepted !== true || value.oldSignerRejected !== true || value.rotationAudited !== true || value.auditChainVerified !== true || value.dualApprovalVerified !== true || !finiteNumber(value.timelockSeconds, { minimum: 300 }) || !finiteNumber(value.rollbackWindowSeconds, { minimum: 3600 }) || value.rollbackVerified !== true || value.privateMaterialObserved !== false || value.networkUsed !== false || value.transactionSigned !== false) throw new Error("I12_SIGNER_ROTATION_INSUFFICIENT");
  } else if (type === "data-protection-response") {
    if (value.dpiaAccepted !== true || value.retentionPolicyVerified !== true || value.deletionPolicyVerified !== true || value.incidentExercisePassed !== true || typeof value.goNoGoChecklistRef !== "string" || !value.goNoGoChecklistRef.trim()) throw new Error("I12_DATA_PROTECTION_INSUFFICIENT");
  } else if (type === "reproducible-build") {
    if (!HASH.test(value.buildOneSha256 ?? "") || value.buildOneSha256 !== value.buildTwoSha256 || value.sbomVerified !== true || value.artifactSignatureVerified !== true) throw new Error("I12_REPRODUCIBLE_BUILD_INSUFFICIENT");
  } else if (type === "independent-reviews") {
    if (!Array.isArray(value.reviews) || value.reviews.length !== I12_INDEPENDENT_REVIEW_ROLES.length) throw new Error("I12_REVIEW_MATRIX_INSUFFICIENT");
    const reviews = new Map(value.reviews.map((review) => [review?.role, review]));
    if (reviews.size !== I12_INDEPENDENT_REVIEW_ROLES.length || [...reviews.keys()].some((role) => !I12_INDEPENDENT_REVIEW_ROLES.includes(role))) throw new Error("I12_REVIEW_MATRIX_INSUFFICIENT");
    const reviewerRefs = new Set();
    const evidenceRefs = new Set();
    for (const role of I12_INDEPENDENT_REVIEW_ROLES) {
      const review = reviews.get(role);
      const evidenceRef = typeof review?.evidenceRef === "string" ? review.evidenceRef.trim() : "";
      if (!review || review.accepted !== true || review.candidateCommit !== value.candidateCommit
        || typeof review.reviewerRef !== "string" || !review.reviewerRef.trim()
        || !evidenceRef || !HASH.test(review.evidenceSha256 ?? "")) throw new Error(`I12_REVIEW_INSUFFICIENT:${role}`);
      reviewerRefs.add(review.reviewerRef.trim());
      evidenceRefs.add(evidenceRef);
    }
    if (reviewerRefs.size !== I12_INDEPENDENT_REVIEW_ROLES.length) throw new Error("I12_REVIEWS_NOT_INDEPENDENT");
    if (evidenceRefs.size !== I12_INDEPENDENT_REVIEW_ROLES.length) throw new Error("I12_REVIEW_EVIDENCE_NOT_INDEPENDENT");
    if ((value.unacceptedP0 ?? 1) !== 0) throw new Error("I12_UNACCEPTED_P0");
  } else throw new Error("I12_EVIDENCE_TYPE_UNKNOWN");
  return true;
}
