const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
function base(value, type) {
  if (!value || value.schemaVersion !== 1 || value.type !== type || value.status !== "PASS" || !HASH.test(value.artifactSha256 ?? "") || !COMMIT.test(value.candidateCommit ?? "")) throw new Error(`I12_EVIDENCE_INVALID:${type}`);
}
function finiteNumber(value, { minimum = 0, integer = false } = {}) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && (!integer || Number.isInteger(value));
}
export function validateI12Evidence(type, value) {
  base(value, type);
  if (type === "security-scans") {
    for (const gate of ["sast", "dependency", "secret", "container", "iac", "api", "penetration"]) if (value.gates?.[gate] !== "PASS") throw new Error(`I12_SECURITY_GATE_INSUFFICIENT:${gate}`);
    if ((value.unacceptedP0 ?? 1) !== 0) throw new Error("I12_SECURITY_UNACCEPTED_P0");
  } else if (type === "performance-capacity") {
    if (value.loadProfileRef !== "oracle-nfr004-mixed-synthetic-v1" || value.requestsCompleted !== 240000 || !finiteNumber(value.unexpectedFailureRatePercent) || value.unexpectedFailureRatePercent > 0.1 || value.application5xx !== 0 || value.processRestarts !== 0 || !finiteNumber(value.steadyP95Milliseconds, { minimum: Number.EPSILON }) || value.steadyP95Milliseconds > 150 || !finiteNumber(value.burstP95Milliseconds, { minimum: Number.EPSILON }) || value.burstP95Milliseconds > 300 || !finiteNumber(value.steadyBacklogMaximum, { integer: true }) || value.steadyBacklogMaximum > 64 || !finiteNumber(value.burstBacklogMaximum, { integer: true }) || value.burstBacklogMaximum > 256 || !finiteNumber(value.backlogDrainSeconds) || value.backlogDrainSeconds > 60 || !finiteNumber(value.cpuFiveMinuteAveragePercent) || value.cpuFiveMinuteAveragePercent >= 80 || !finiteNumber(value.memoryPeakPercent) || value.memoryPeakPercent >= 85 || value.faultInjectionPassed !== true || value.faultMatrixPassed !== 12) throw new Error("I12_PERFORMANCE_INSUFFICIENT");
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
    const reviews = new Map((value.reviews ?? []).map((review) => [review.role, review]));
    const reviewerRefs = new Set();
    for (const role of ["security", "privacy", "legal", "contract", "operations"]) {
      const review = reviews.get(role);
      if (!review || review.accepted !== true || typeof review.reviewerRef !== "string" || !review.reviewerRef.trim() || !HASH.test(review.evidenceSha256 ?? "")) throw new Error(`I12_REVIEW_INSUFFICIENT:${role}`);
      reviewerRefs.add(review.reviewerRef.trim());
    }
    if (reviewerRefs.size !== 5) throw new Error("I12_REVIEWS_NOT_INDEPENDENT");
    if ((value.unacceptedP0 ?? 1) !== 0) throw new Error("I12_UNACCEPTED_P0");
  } else throw new Error("I12_EVIDENCE_TYPE_UNKNOWN");
  return true;
}
