const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

function base(value, type) {
  if (!value || value.schemaVersion !== 1 || value.type !== type || value.status !== "PASS" || !COMMIT.test(value.candidateCommit ?? "") || !HASH.test(value.artifactSha256 ?? "")) {
    throw new Error(`STAGE_GATE_EVIDENCE_INVALID:${type}`);
  }
}

export function validatePremiseEvidence(value) {
  base(value, "premise-evidence");
  const premises = new Map((value.premises ?? []).map((item) => [item.id, item]));
  for (let index = 1; index <= 8; index += 1) {
    const id = `P${index}`;
    const item = premises.get(id);
    if (!item || item.confirmed !== true || !HASH.test(item.evidenceSha256 ?? "") || !Number.isFinite(Date.parse(item.obtainedAt ?? "")) || !Number.isFinite(Date.parse(item.reviewDueAt ?? "")) || Date.parse(item.reviewDueAt) <= Date.parse(item.obtainedAt) || typeof item.responsibleRole !== "string" || !item.responsibleRole.trim()) {
      throw new Error(`PREMISE_EVIDENCE_INSUFFICIENT:${id}`);
    }
  }
  return true;
}

export function validateStageFDecision(value) {
  base(value, "stage-f-contract-and-go-no-go");
  for (const field of ["scopeDecisionAccepted", "commercialContractSigned", "dataContractSigned", "mainnetGoNoGoWritten", "realAssetGoNoGoWritten", "realFundsGoNoGoWritten", "jurisdictionGoNoGoWritten", "releaseBlockersCleared"]) {
    if (value[field] !== true) throw new Error(`STAGE_F_DECISION_INSUFFICIENT:${field}`);
  }
  for (const field of ["scopeDecisionRef", "contractPackageRef", "releaseManifestRef", "signerSetRef", "rollbackPlanRef", "incidentResponseRef"]) {
    if (typeof value[field] !== "string" || !value[field].trim()) throw new Error(`STAGE_F_DECISION_INSUFFICIENT:${field}`);
  }
  if (value.operationsHandoffAccepted !== true || (value.unacceptedP0 ?? 1) !== 0) {
    throw new Error("STAGE_F_DECISION_INSUFFICIENT:references");
  }
  return true;
}

export function validateIntegratedCiEvidence(value) {
  base(value, "integrated-ci");
  const required = ["locked-install", "format-lint-typecheck", "unit-negative", "production-build", "contract", "consumer-integration", "mysql-migrate-backup-restore", "financial-boundary", "subject-compliance-boundary", "personal-information-boundary", "secret-credential-boundary"];
  const jobs = new Map((value.jobs ?? []).map((item) => [item.id, item.status]));
  for (const id of required) if (jobs.get(id) !== "PASS") throw new Error(`INTEGRATED_CI_INSUFFICIENT:${id}`);
  if (value.singleRun !== true || value.prApproved !== true || value.prMerged !== true || value.mergedHeadCommit !== value.candidateCommit) throw new Error("INTEGRATED_CI_INSUFFICIENT:merge");
  return true;
}
