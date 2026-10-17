import assert from "node:assert/strict";
import test from "node:test";
import { validateIntegratedCiEvidence, validatePremiseEvidence, validateStageFDecision } from "../src/services/stage-gate-evidence.js";

const HASH = "a".repeat(64);
const COMMIT = "b".repeat(40);
const base = { schemaVersion: 1, status: "PASS", artifactSha256: HASH, candidateCommit: COMMIT };

test("premise evidence requires P1-P8 with dated review ownership", () => {
  const premises = Array.from({ length: 8 }, (_, index) => ({ id: `P${index + 1}`, confirmed: true, candidateCommit: COMMIT, evidenceRef: `evidence/premises/P${index + 1}#supporting-record`, evidenceSha256: HASH, obtainedAt: "2026-08-25T00:00:00.000Z", reviewDueAt: "2027-08-25T00:00:00.000Z", responsibleRole: index < 4 || index === 7 ? "legal" : "product" }));
  assert.equal(validatePremiseEvidence({ ...base, type: "premise-evidence", premises }), true);
  assert.throws(() => validatePremiseEvidence({ ...base, type: "premise-evidence", premises: premises.slice(1) }), /PREMISE_EVIDENCE_INSUFFICIENT:P1/);
  assert.throws(() => validatePremiseEvidence({ ...base, type: "premise-evidence", premises: premises.map((item, index) => index === 0 ? { ...item, candidateCommit: "c".repeat(40) } : item) }), /PREMISE_EVIDENCE_INSUFFICIENT:P1/);
  assert.throws(() => validatePremiseEvidence({ ...base, type: "premise-evidence", premises: premises.map((item, index) => index === 0 ? { ...item, responsibleRole: "product" } : item) }), /PREMISE_EVIDENCE_INSUFFICIENT:P1/);
  assert.throws(() => validatePremiseEvidence({ ...base, type: "premise-evidence", premises: premises.map((item, index) => index === 0 ? { ...item, evidenceRef: premises[1].evidenceRef } : item) }), /PREMISE_EVIDENCE_REFERENCES_NOT_UNIQUE/);
  assert.throws(() => validatePremiseEvidence({ ...base, type: "premise-evidence", premises: [...premises, premises[0]] }), /PREMISE_EVIDENCE_MATRIX_INSUFFICIENT/);
});

test("Stage F decision requires every written contract and go-no-go", () => {
  const decisionEvidence = ["scope-decision", "commercial-contract", "data-protection-contract", "mainnet-go-no-go", "real-assets-go-no-go", "real-funds-go-no-go", "jurisdiction-go-no-go", "release-blockers", "operations-handoff"].map((id) => ({ id, status: "PASS", candidateCommit: COMMIT, evidenceRef: `controlled/stage-f/${id}.json`, evidenceSha256: HASH }));
  const decision = { ...base, type: "stage-f-contract-and-go-no-go", scopeDecisionAccepted: true, scopeDecisionRef: "controlled/scope-decision", commercialContractSigned: true, dataContractSigned: true, contractPackageRef: "controlled/contract-package", mainnetGoNoGoWritten: true, realAssetGoNoGoWritten: true, realFundsGoNoGoWritten: true, jurisdictionGoNoGoWritten: true, releaseBlockersCleared: true, releaseManifestRef: "controlled/release", signerSetRef: "controlled/signers", rollbackPlanRef: "controlled/rollback", incidentResponseRef: "controlled/incident", operationsHandoffAccepted: true, unacceptedP0: 0, decisionEvidence };
  assert.equal(validateStageFDecision(decision), true);
  assert.throws(() => validateStageFDecision({ ...decision, legalGoNoGoWritten: false, jurisdictionGoNoGoWritten: false }), /STAGE_F_DECISION_INSUFFICIENT:jurisdictionGoNoGoWritten/);
  assert.throws(() => validateStageFDecision({ ...decision, decisionEvidence: decisionEvidence.slice(1) }), /STAGE_F_DECISION_EVIDENCE_INSUFFICIENT/);
  assert.throws(() => validateStageFDecision({ ...decision, decisionEvidence: decisionEvidence.map((item, index) => index === 0 ? { ...item, candidateCommit: "c".repeat(40) } : item) }), /STAGE_F_DECISION_EVIDENCE_INSUFFICIENT:scope-decision/);
  assert.throws(() => validateStageFDecision({ ...decision, decisionEvidence: decisionEvidence.map((item, index) => index === 0 ? { ...item, evidenceRef: decisionEvidence[1].evidenceRef } : item) }), /STAGE_F_DECISION_EVIDENCE_NOT_UNIQUE/);

});

test("integrated CI requires one approved merged run with every mandated job", () => {
  const ids = ["locked-install", "format-lint-typecheck", "unit-negative", "production-build", "contract", "consumer-integration", "mysql-migrate-backup-restore", "financial-boundary", "subject-compliance-boundary", "personal-information-boundary", "secret-credential-boundary"];
  const runId = "run-12345";
  const evidence = { ...base, type: "integrated-ci", runId, runRef: "https://github.example/actions/runs/run-12345", singleRun: true, prApproved: true, prMerged: true, mergedHeadCommit: COMMIT, jobs: ids.map((id) => ({ id, status: "PASS", runId, candidateCommit: COMMIT })) };
  assert.equal(validateIntegratedCiEvidence(evidence), true);
  assert.throws(() => validateIntegratedCiEvidence({ ...evidence, jobs: evidence.jobs.slice(1) }), /INTEGRATED_CI_INSUFFICIENT:locked-install/);
  assert.throws(() => validateIntegratedCiEvidence({ ...evidence, jobs: [...evidence.jobs, evidence.jobs[0]] }), /INTEGRATED_CI_JOB_MATRIX_INSUFFICIENT/);
  assert.throws(() => validateIntegratedCiEvidence({ ...evidence, jobs: evidence.jobs.map((job, index) => index === 0 ? { ...job, runId: "other-run" } : job) }), /INTEGRATED_CI_INSUFFICIENT:locked-install/);
  assert.throws(() => validateIntegratedCiEvidence({ ...evidence, jobs: evidence.jobs.map((job, index) => index === 0 ? { ...job, candidateCommit: "c".repeat(40) } : job) }), /INTEGRATED_CI_INSUFFICIENT:locked-install/);
  assert.throws(() => validateIntegratedCiEvidence({ ...evidence, runRef: "" }), /INTEGRATED_CI_JOB_MATRIX_INSUFFICIENT/);
});
