import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("synthetic signer rotation stays offline and cannot satisfy I12 acceptance", () => {
  const script = "scripts/run-i12-synthetic-signer-rotation.mjs";
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const runnerSha256 = createHash("sha256").update(readFileSync(script)).digest("hex");

  assert.equal(report.runnerSha256, runnerSha256);
  assert.equal(report.scope, "SYNTHETIC_OFFLINE_ONLY");
  assert.equal(report.status, "PASS");
  assert.equal(report.acceptanceEligible, false);
  assert.equal(report.doesNotSatisfyProductionProtectedSignerCeremony, true);
  assert.equal(report.newSignerAccepted, true);
  assert.equal(report.oldSignerRejected, true);
  assert.equal(report.rotationAudited, true);
  assert.equal(report.rotationPolicySha256, "df15dee447c36e185571667edf03772f24a502b554e4e85dcaa16552e2c4e7b6");
  assert.equal(report.twoDistinctApprovalsVerified, true);
  assert.equal(report.requesterSelfApprovalRejected, true);
  assert.equal(report.timelockSeconds, 300);
  assert.equal(report.earlyActivationRejected, true);
  assert.equal(report.rollbackWindowSeconds, 3600);
  assert.equal(report.rollbackPassed, true);
  assert.equal(report.auditChainVerified, true);
  assert.equal(report.tamperedAuditChainRejected, true);
  assert.equal(report.privateMaterialObserved, false);
  assert.equal(report.privateMaterialExported, false);
  assert.equal(report.privateMaterialPersisted, false);
  assert.equal(report.networkUsed, false);
  assert.equal(report.rpcUsed, false);
  assert.equal(report.brokerUsed, false);
  assert.equal(report.walletUsed, false);
  assert.equal(report.transactionSigned, false);
  assert.equal(report.nonceConsumed, false);

  const frozenReport = JSON.parse(readFileSync("output/i12-synthetic-signer-rotation.json", "utf8"));
  assert.equal(frozenReport.runnerSha256, runnerSha256);
  assert.equal(frozenReport.rotationPolicySha256, report.rotationPolicySha256);
  assert.equal(frozenReport.twoDistinctApprovalsVerified, true);
  assert.equal(frozenReport.earlyActivationRejected, true);
  assert.equal(frozenReport.rollbackPassed, true);
  assert.equal(frozenReport.acceptanceEligible, false);
});
