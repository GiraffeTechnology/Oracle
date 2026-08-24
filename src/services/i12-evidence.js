const HASH = /^[a-f0-9]{64}$/;
function base(value, type) {
  if (!value || value.schemaVersion !== 1 || value.type !== type || value.status !== "PASS" || !HASH.test(value.artifactSha256 ?? "")) throw new Error(`I12_EVIDENCE_INVALID:${type}`);
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
    if (typeof value.loadProfileRef !== "string" || !value.loadProfileRef.trim() || !finiteNumber(value.requestsCompleted, { minimum: 1, integer: true }) || !finiteNumber(value.p95Milliseconds, { minimum: Number.EPSILON }) || !finiteNumber(value.queueBacklogMaximum, { integer: true }) || value.faultInjectionPassed !== true) throw new Error("I12_PERFORMANCE_INSUFFICIENT");
  } else if (type === "72h-stability") {
    if (!finiteNumber(value.durationSeconds, { minimum: 259200 }) || value.continuous !== true || !finiteNumber(value.sampleCount, { minimum: 4320, integer: true }) || value.secretScanPassed !== true || !finiteNumber(value.unexplainedFailures, { integer: true }) || value.unexplainedFailures !== 0) throw new Error("I12_STABILITY_INSUFFICIENT");
  } else if (type === "restore-drill") {
    if (value.databaseIntegrityVerified !== true || value.auditHeadVerified !== true || !finiteNumber(value.rpoSecondsTarget) || !finiteNumber(value.rpoSecondsActual) || !finiteNumber(value.rtoSecondsTarget) || !finiteNumber(value.rtoSecondsActual) || value.rpoSecondsActual > value.rpoSecondsTarget || value.rtoSecondsActual > value.rtoSecondsTarget) throw new Error("I12_RESTORE_DRILL_INSUFFICIENT");
  } else if (type === "signer-rotation") {
    if (value.newSignerAccepted !== true || value.oldSignerRejected !== true || value.rotationAudited !== true || value.privateMaterialObserved !== false) throw new Error("I12_SIGNER_ROTATION_INSUFFICIENT");
  } else if (type === "data-protection-response") {
    if (value.dpiaAccepted !== true || value.retentionPolicyVerified !== true || value.deletionPolicyVerified !== true || value.incidentExercisePassed !== true || typeof value.goNoGoChecklistRef !== "string" || !value.goNoGoChecklistRef.trim()) throw new Error("I12_DATA_PROTECTION_INSUFFICIENT");
  } else if (type === "reproducible-build") {
    if (!HASH.test(value.buildOneSha256 ?? "") || value.buildOneSha256 !== value.buildTwoSha256 || value.sbomVerified !== true || value.artifactSignatureVerified !== true) throw new Error("I12_REPRODUCIBLE_BUILD_INSUFFICIENT");
  } else if (type === "independent-reviews") {
    const reviews = new Map((value.reviews ?? []).map((review) => [review.role, review]));
    for (const role of ["security", "privacy", "legal"]) {
      const review = reviews.get(role);
      if (!review || review.accepted !== true || !review.reviewerRef || !HASH.test(review.evidenceSha256 ?? "")) throw new Error(`I12_REVIEW_INSUFFICIENT:${role}`);
    }
    if ((value.unacceptedP0 ?? 1) !== 0) throw new Error("I12_UNACCEPTED_P0");
  } else throw new Error("I12_EVIDENCE_TYPE_UNKNOWN");
  return true;
}

