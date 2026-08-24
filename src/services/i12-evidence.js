const HASH = /^[a-f0-9]{64}$/;
function base(value, type) {
  if (!value || value.schemaVersion !== 1 || value.type !== type || value.status !== "PASS" || !HASH.test(value.artifactSha256 ?? "")) throw new Error(`I12_EVIDENCE_INVALID:${type}`);
}
export function validateI12Evidence(type, value) {
  base(value, type);
  if (type === "72h-stability") {
    if (value.durationSeconds < 259200 || value.continuous !== true || value.sampleCount < 4320 || value.secretScanPassed !== true || value.unexplainedFailures !== 0) throw new Error("I12_STABILITY_INSUFFICIENT");
  } else if (type === "restore-drill") {
    if (value.databaseIntegrityVerified !== true || value.auditHeadVerified !== true || value.rpoSecondsActual > value.rpoSecondsTarget || value.rtoSecondsActual > value.rtoSecondsTarget) throw new Error("I12_RESTORE_DRILL_INSUFFICIENT");
  } else if (type === "signer-rotation") {
    if (value.newSignerAccepted !== true || value.oldSignerRejected !== true || value.rotationAudited !== true || value.privateMaterialObserved !== false) throw new Error("I12_SIGNER_ROTATION_INSUFFICIENT");
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

