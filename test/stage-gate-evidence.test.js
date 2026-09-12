import assert from "node:assert/strict";
import test from "node:test";
import { validateIntegratedCiEvidence, validatePremiseEvidence, validateStageFDecision } from "../src/services/stage-gate-evidence.js";

const HASH = "a".repeat(64);
const COMMIT = "b".repeat(40);
const base = { schemaVersion: 1, status: "PASS", artifactSha256: HASH, candidateCommit: COMMIT };

test("premise evidence requires P1-P8 with dated review ownership", () => {
  const premises = Array.from({ length: 8 }, (_, index) => ({ id: `P${index + 1}`, confirmed: true, evidenceSha256: HASH, obtainedAt: "2026-08-25T00:00:00.000Z", reviewDueAt: "2027-08-25T00:00:00.000Z", responsibleRole: index < 4 ? "legal" : "product" }));
  assert.equal(validatePremiseEvidence({ ...base, type: "premise-evidence", premises }), true);
  assert.throws(() => validatePremiseEvidence({ ...base, type: "premise-evidence", premises: premises.slice(1) }), /PREMISE_EVIDENCE_INSUFFICIENT:P1/);
});

test("Stage F decision requires every written contract and go-no-go", () => {
  const decision = { ...base, type: "stage-f-contract-and-go-no-go", scopeDecisionAccepted: true, scopeDecisionRef: "controlled/scope-decision", commercialContractSigned: true, dataContractSigned: true, contractPackageRef: "controlled/contract-package", mainnetGoNoGoWritten: true, realAssetGoNoGoWritten: true, realFundsGoNoGoWritten: true, jurisdictionGoNoGoWritten: true, releaseBlockersCleared: true, releaseManifestRef: "controlled/release", signerSetRef: "controlled/signers", rollbackPlanRef: "controlled/rollback", incidentResponseRef: "controlled/incident", operationsHandoffAccepted: true, unacceptedP0: 0 };
  assert.equal(validateStageFDecision(decision), true);
  assert.throws(() => validateStageFDecision({ ...decision, legalGoNoGoWritten: false, jurisdictionGoNoGoWritten: false }), /STAGE_F_DECISION_INSUFFICIENT:jurisdictionGoNoGoWritten/);
});

test("integrated CI requires one approved merged run with every mandated job", () => {
  const ids = ["locked-install", "format-lint-typecheck", "unit-negative", "production-build", "contract", "consumer-integration", "mysql-migrate-backup-restore", "financial-boundary", "subject-compliance-boundary", "personal-information-boundary", "secret-credential-boundary"];
  const evidence = { ...base, type: "integrated-ci", singleRun: true, prApproved: true, prMerged: true, mergedHeadCommit: COMMIT, jobs: ids.map((id) => ({ id, status: "PASS" })) };
  assert.equal(validateIntegratedCiEvidence(evidence), true);
  assert.throws(() => validateIntegratedCiEvidence({ ...evidence, jobs: evidence.jobs.slice(1) }), /INTEGRATED_CI_INSUFFICIENT:locked-install/);
});
