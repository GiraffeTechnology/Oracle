import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const FORBIDDEN_PUBLIC_KEYS = /(?:^|_)(?:kyc|aml|sanctions?|suitability|jurisdictioneligibility|licenseeligibility|valuation|marketprice|collateralratio|investmentadvice|privatekey|identitymapping|currentownercommitment|holdercommitment|warehouseid|sellerwallet|buyerwallet)(?:$|_)/i;

test("Stage E third-party asset reads are factual and cannot query prohibited conclusions or write", async () => {
  const runtime = createSyntheticRuntime();
  const observedAt = "2026-10-17T00:00:00.000Z";
  runtime.recordStore.putAsset({
    assetId: "stage-e-asset",
    assetFingerprintHash: HASH_A,
    wenbaoRegistryRef: "synthetic:registry-stage-e",
    transferEligibility: "VALID",
    warehouseId: "synthetic-warehouse",
    warehouseReceiptHash: HASH_C,
    currentCertificateHash: HASH_B,
    currentCertificateVersion: 1,
    currentOwnerCommitment: HASH_C,
    encumbranceStatus: "CLEAR",
    oracleStatus: "VALID",
    updatedAt: observedAt,
  });
  runtime.recordStore.appendCertificate({
    assetId: "stage-e-asset",
    tokenId: "1",
    certificateVersion: 1,
    certificateHash: HASH_B,
    previousCertificateHash: null,
    wenbaoChangeRef: "synthetic:change-stage-e",
    warehouseReceiptHash: HASH_C,
    effectiveAt: observedAt,
    status: "CURRENT",
  });
  runtime.recordStore.putWarehouse({
    assetId: "stage-e-asset",
    warehouseId: "synthetic-warehouse",
    warehouseReceiptHash: HASH_C,
    warehouseStatus: "IN_CUSTODY",
    holderCommitment: HASH_C,
    observedAt,
  });
  runtime.stateEngine.transition({
    subjectId: "stage-e-asset",
    to: "VALID",
    reasonHash: HASH_A,
    evidenceVersion: 1,
    occurredAt: observedAt,
  });

  const server = createApp({
    config: { environment: "production", externalWritesEnabled: false },
    sourceRegistry: runtime.sourceRegistry,
    runtime,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const historyBefore = runtime.recordStore.certificateHistory("stage-e-asset");
    const response = await fetch(`${base}/v1/rwa/assets/stage-e-asset`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "VALID");
    assert.equal(body.asset.assetFingerprintHash, HASH_A);
    assert.equal(body.currentCertificate.certificateHash, HASH_B);
    assert.equal(body.warehouse.warehouseReceiptHash, HASH_C);
    const inspectKeys = (value) => {
      if (Array.isArray(value)) return value.forEach(inspectKeys);
      if (value && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          assert.equal(FORBIDDEN_PUBLIC_KEYS.test(key), false, `prohibited public field: ${key}`);
          inspectKeys(nested);
        }
      }
    };
    inspectKeys(body);

    for (const forbiddenQuery of ["kyc=clear", "marketPrice=100"]) {
      const rejected = await fetch(`${base}/v1/rwa/assets/stage-e-asset?${forbiddenQuery}`);
      assert.equal(rejected.status, 400);
      assert.match((await rejected.json()).errorCode, /SUBJECT_COMPLIANCE_OUT_OF_SCOPE|FINANCIAL_OUTPUT_PROHIBITED/);
    }
    const writeAttempt = await fetch(`${base}/v1/rwa/assets/stage-e-asset`, { method: "POST" });
    assert.equal(writeAttempt.status, 405);
    assert.deepEqual(runtime.recordStore.certificateHistory("stage-e-asset"), historyBefore);
    assert.equal(runtime.stateEngine.current("stage-e-asset"), "VALID");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
