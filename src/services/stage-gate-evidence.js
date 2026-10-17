const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PREMISE_OWNERS = Object.freeze({
  P1: "legal",
  P2: "legal",
  P3: "legal",
  P4: "legal",
  P5: "product",
  P6: "product",
  P7: "product",
  P8: "legal",
});

function base(value, type) {
  if (!value || value.schemaVersion !== 1 || value.type !== type || value.status !== "PASS" || !COMMIT.test(value.candidateCommit ?? "") || !HASH.test(value.artifactSha256 ?? "")) {
    throw new Error(`STAGE_GATE_EVIDENCE_INVALID:${type}`);
  }
}

export function validatePremiseEvidence(value) {
  base(value, "premise-evidence");
  const expectedIds = Object.keys(PREMISE_OWNERS);
  if (!Array.isArray(value.premises) || value.premises.length !== expectedIds.length) throw new Error("PREMISE_EVIDENCE_MATRIX_INSUFFICIENT");
  const premises = new Map(value.premises.map((item) => [item?.id, item]));
  if (premises.size !== expectedIds.length || [...premises.keys()].some((id) => !expectedIds.includes(id))) throw new Error("PREMISE_EVIDENCE_MATRIX_INSUFFICIENT");
  const evidenceRefs = new Set();
  for (const id of expectedIds) {
    const item = premises.get(id);
    const evidenceRef = typeof item?.evidenceRef === "string" ? item.evidenceRef.trim() : "";
    if (!item || item.candidateCommit !== value.candidateCommit || item.confirmed !== true
      || item.responsibleRole !== PREMISE_OWNERS[id] || !HASH.test(item.evidenceSha256 ?? "")
      || !evidenceRef || !Number.isFinite(Date.parse(item.obtainedAt ?? ""))
      || !Number.isFinite(Date.parse(item.reviewDueAt ?? ""))
      || Date.parse(item.reviewDueAt) <= Date.parse(item.obtainedAt)) {
      throw new Error(`PREMISE_EVIDENCE_INSUFFICIENT:${id}`);
    }
    evidenceRefs.add(evidenceRef);
  }
  if (evidenceRefs.size !== expectedIds.length) throw new Error("PREMISE_EVIDENCE_REFERENCES_NOT_UNIQUE");
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
  const requiredEvidence = [
    "scope-decision", "commercial-contract", "data-protection-contract", "mainnet-go-no-go",
    "real-assets-go-no-go", "real-funds-go-no-go", "jurisdiction-go-no-go",
    "release-blockers", "operations-handoff",
  ];
  if (!Array.isArray(value.decisionEvidence) || value.decisionEvidence.length !== requiredEvidence.length) throw new Error("STAGE_F_DECISION_EVIDENCE_INSUFFICIENT");
  const evidence = new Map(value.decisionEvidence.map((item) => [item?.id, item]));
  if (evidence.size !== requiredEvidence.length || [...evidence.keys()].some((id) => !requiredEvidence.includes(id))) throw new Error("STAGE_F_DECISION_EVIDENCE_INSUFFICIENT");
  const references = new Set();
  for (const id of requiredEvidence) {
    const item = evidence.get(id);
    const evidenceRef = typeof item?.evidenceRef === "string" ? item.evidenceRef.trim() : "";
    if (!item || item.status !== "PASS" || item.candidateCommit !== value.candidateCommit
      || !evidenceRef || !HASH.test(item.evidenceSha256 ?? "")) throw new Error(`STAGE_F_DECISION_EVIDENCE_INSUFFICIENT:${id}`);
    references.add(evidenceRef);
  }
  if (references.size !== requiredEvidence.length) throw new Error("STAGE_F_DECISION_EVIDENCE_NOT_UNIQUE");
  return true;
}

export function validateIntegratedCiEvidence(value) {
  base(value, "integrated-ci");
  const required = ["locked-install", "format-lint-typecheck", "unit-negative", "production-build", "contract", "consumer-integration", "mysql-migrate-backup-restore", "financial-boundary", "subject-compliance-boundary", "personal-information-boundary", "secret-credential-boundary"];
  if (!Array.isArray(value.jobs) || value.jobs.length !== required.length
    || typeof value.runId !== "string" || !value.runId.trim()
    || typeof value.runRef !== "string" || !value.runRef.trim()) throw new Error("INTEGRATED_CI_JOB_MATRIX_INSUFFICIENT");
  const jobs = new Map(value.jobs.map((item) => [item?.id, item]));
  if (jobs.size !== required.length || [...jobs.keys()].some((id) => !required.includes(id))) throw new Error("INTEGRATED_CI_JOB_MATRIX_INSUFFICIENT");
  for (const id of required) {
    const job = jobs.get(id);
    if (!job || job.status !== "PASS" || job.runId !== value.runId || job.candidateCommit !== value.candidateCommit) throw new Error(`INTEGRATED_CI_INSUFFICIENT:${id}`);
  }
  if (value.singleRun !== true || value.prApproved !== true || value.prMerged !== true || value.mergedHeadCommit !== value.candidateCommit) throw new Error("INTEGRATED_CI_INSUFFICIENT:merge");
  return true;
}
