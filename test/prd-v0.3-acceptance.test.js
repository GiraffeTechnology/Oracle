import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { createApp } from "../src/app.js";
import { renderAssetDetailHtml } from "../src/admin-ui.js";
import { loadConfig } from "../src/config.js";
import { AttestationService } from "../src/domain/attestation-service.js";
import { ConsumerStatus, SyntheticConsumerStateMachine } from "../src/domain/consumer-state-machine.js";
import { OracleStatus, ORACLE_STATUSES } from "../src/domain/oracle-status.js";
import { RecordStore } from "../src/domain/record-store.js";
import { RevocationRegistry } from "../src/domain/revocation-registry.js";
import { createSyntheticRuntime } from "../src/oracle-runtime.js";
import { assertAssetFactsOnly, assertOneToOneIssuanceRequest } from "../src/services/product-boundary.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const NOW = new Date("2026-08-24T00:00:00.000Z");

function validIssuance(overrides = {}) {
  return {
    quantity: 1,
    fractional: false,
    sharedClaim: false,
    assetRegistered: true,
    authorityConfirmed: true,
    warehouseReceiptValid: true,
    certificateValid: true,
    encumbranceClear: true,
    walletBindingValid: true,
    assetUnoccupied: true,
    ...overrides,
  };
}

function consumerAttestation(id = "attestation-1") {
  return { attestationId: id };
}

function accept() {
  return true;
}

async function listen(server, run) {
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    await run(`http://localhost:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("ORACLE-002 exposes exactly eight fail-closed public states", () => {
  assert.deepEqual(ORACLE_STATUSES, ["VALID", "INVALID", "TRANSFER_PENDING", "FROZEN", "REVOKED", "EXPIRED", "REVIEW_REQUIRED", "NOT_VERIFIED"]);
  for (const status of ORACLE_STATUSES) assert.equal(OracleStatus[status], status);
});

test("ORACLE-003 binds every attestation to chain contract token and purpose", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const service = new AttestationService({ signerSetId: "synthetic-signers", privateKey, publicKey, revocations: new RevocationRegistry(), clock: () => NOW });
  assert.throws(() => service.issue({ subject: { assetId: "asset-001", purpose: "transfer" }, sourceAuthority: "authority", sourceRecordHash: HASH_A, validForSeconds: 60, nonce: "n-1" }), /ATTESTATION_REQUEST_INVALID/);
  const attestation = service.issue({ subject: { assetId: "asset-001", chainId: "test-chain", contract: "test-contract", tokenId: "1", purpose: "transfer" }, factType: "TRANSFER_STATUS", factValue: "VALID", sourceAuthority: "authority", sourceRecordHash: HASH_A, validForSeconds: 60, nonce: "n-2", revocationRef: "revocations-v1" });
  for (const [field, value] of Object.entries({ chainId: "other-chain", contract: "other-contract", tokenId: "2", purpose: "other-purpose" })) {
    assert.equal(service.verify(attestation, { expectedSubject: { [field]: value }, now: NOW }).errorCode, "SUBJECT_MISMATCH");
  }
  assert.equal(attestation.envelope.sourceAuthority, "authority");
  assert.equal(attestation.envelope.revocationRef, "revocations-v1");
});

test("ORACLE-005 and ORACLE-006 reject subject-compliance and financial-output fields", () => {
  for (const field of ["kyc", "aml", "sanction", "suitability", "accredit", "jurisdictionEligibility", "licenseEligibility"]) {
    assert.throws(() => assertAssetFactsOnly({ [field]: "value" }), /SUBJECT_COMPLIANCE_OUT_OF_SCOPE/);
  }
  for (const field of ["valuation", "marketPrice", "pricePrediction", "collateralRatio", "liquidationPrice", "creditScore", "interestRate", "yieldRate", "liquidityCurve", "investmentAdvice"]) {
    assert.throws(() => assertAssetFactsOnly({ nested: { [field]: 1 } }), /FINANCIAL_OUTPUT_PROHIBITED/);
  }
});

test("ORACLE-005 constructed public query is explicitly refused", async () => {
  const runtime = createSyntheticRuntime();
  const server = createApp({ config: loadConfig({}), sourceRegistry: runtime.sourceRegistry, runtime });
  await listen(server, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/rwa/assets/asset-001?aml=unknown`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).errorCode, "SUBJECT_COMPLIANCE_OUT_OF_SCOPE");
  });
});

test("ORACLE-007 public API and UI omit owner and warehouse identity commitments", async () => {
  const runtime = createSyntheticRuntime();
  runtime.recordStore.putAsset({ assetId: "asset-private", wenbaoRegistryRef: "registry-ref", assetFingerprintHash: HASH_A, currentOwnerCommitment: HASH_B, warehouseId: "private-warehouse", updatedAt: NOW.toISOString() });
  runtime.recordStore.putWarehouse({ assetId: "asset-private", warehouseReceiptHash: HASH_C, warehouseId: "private-warehouse", holderCommitment: HASH_D, warehouseStatus: "IN_CUSTODY", observedAt: NOW.toISOString() });
  const server = createApp({ config: loadConfig({}), sourceRegistry: runtime.sourceRegistry, runtime });
  await listen(server, async (baseUrl) => {
    const api = JSON.stringify(await (await fetch(`${baseUrl}/v1/rwa/assets/asset-private`)).json());
    const page = await (await fetch(`${baseUrl}/assets/asset-private`)).text();
    for (const secret of [HASH_B, HASH_D, "private-warehouse"]) {
      assert.doesNotMatch(api, new RegExp(secret));
      assert.doesNotMatch(page, new RegExp(secret));
    }
    assert.match(page, /一物一证一 NFT/);
    assert.match(page, /不提供或参与 NFT 金融化/);
  });
});

test("CONSUMER-001 rejects duplicate claims and any non-1:1 issuance", () => {
  const store = new RecordStore();
  store.putAsset({ assetId: "asset-001", assetFingerprintHash: HASH_A });
  store.appendCertificate({ assetId: "asset-001", certificateHash: HASH_B, certificateVersion: 1 });
  store.putWarehouse({ assetId: "asset-001", warehouseReceiptHash: HASH_C });
  assert.throws(() => store.putAsset({ assetId: "asset-002", assetFingerprintHash: HASH_A }), /ASSET_FINGERPRINT_ALREADY_CLAIMED/);
  assert.throws(() => store.appendCertificate({ assetId: "asset-002", certificateHash: HASH_B, certificateVersion: 1 }), /CERTIFICATE_HASH_ALREADY_CLAIMED/);
  assert.throws(() => store.putWarehouse({ assetId: "asset-002", warehouseReceiptHash: HASH_C }), /WAREHOUSE_RECEIPT_ALREADY_CLAIMED/);
  assert.throws(() => assertOneToOneIssuanceRequest(validIssuance({ quantity: 100 })), /ONE_ASSET_ONE_TOKEN_REQUIRED/);
  assert.throws(() => assertOneToOneIssuanceRequest(validIssuance({ fractional: true })), /ONE_ASSET_ONE_TOKEN_REQUIRED/);
});

test("CONSUMER-002 checks every issuance prerequisite independently", () => {
  assert.equal(assertOneToOneIssuanceRequest(validIssuance()), true);
  for (const field of ["assetRegistered", "authorityConfirmed", "warehouseReceiptValid", "certificateValid", "encumbranceClear", "walletBindingValid", "assetUnoccupied"]) {
    assert.throws(() => assertOneToOneIssuanceRequest(validIssuance({ [field]: false })), new RegExp(`ISSUANCE_PREREQUISITE_MISSING:${field}`));
  }
});

test("CONSUMER-003 covers all nine lifecycle states and rejects illegal transitions", () => {
  const machine = new SyntheticConsumerStateMachine();
  const tokenRef = "test-chain/test-contract/1";
  assert.equal(machine.current(tokenRef), ConsumerStatus.DRAFT);
  for (const [index, to] of ["VERIFIED", "ACTIVE", "TRANSFER_PENDING", "SETTLED", "ACTIVE", "FROZEN", "REVIEW_REQUIRED", "REVOKED"].entries()) {
    machine.transition({ tokenRef, to, attestation: consumerAttestation(`a-${index}`), verify: accept });
  }
  assert.equal(machine.current(tokenRef), ConsumerStatus.REVOKED);
  assert.throws(() => machine.transition({ tokenRef, to: "ACTIVE", attestation: consumerAttestation(), verify: accept }), /CONSUMER_TRANSITION_REJECTED/);
  const redeemed = new SyntheticConsumerStateMachine();
  redeemed.transition({ tokenRef: "redeem", to: "VERIFIED", attestation: consumerAttestation("r1"), verify: accept });
  redeemed.transition({ tokenRef: "redeem", to: "ACTIVE", attestation: consumerAttestation("r2"), verify: accept });
  redeemed.transition({ tokenRef: "redeem", to: "REDEEMED", attestation: consumerAttestation("r3"), verify: accept });
  assert.equal(redeemed.current("redeem"), ConsumerStatus.REDEEMED);
  assert.throws(() => redeemed.transition({ tokenRef: "redeem", to: "ACTIVE", attestation: consumerAttestation("r4"), verify: accept }), /CONSUMER_TRANSITION_REJECTED|REDEEMED_TERMINAL/);
});

test("CONSUMER-004 and CONSUMER-009 fail closed without a verified attestation", () => {
  const machine = new SyntheticConsumerStateMachine();
  assert.throws(() => machine.transition({ tokenRef: "token", to: "VERIFIED", attestation: consumerAttestation(), verify: () => false }), /CONSUMER_ATTESTATION_REQUIRED/);
  assert.equal(machine.current("token"), ConsumerStatus.DRAFT);
  assert.throws(() => machine.transition({ tokenRef: "token", to: "TRANSFER_PENDING", attestation: consumerAttestation(), verify: accept }), /CONSUMER_TRANSITION_REJECTED/);
});

test("ORACLE-011 renders all four settlement presentation states without implying completed title", () => {
  const common = { asset: { assetId: "asset-ui", wenbaoRegistryRef: "registry" }, certificate: { certificateHash: HASH_A, certificateVersion: 1 }, warehouse: { warehouseReceiptHash: HASH_B }, status: "TRANSFER_PENDING" };
  assert.match(renderAssetDetailHtml({ ...common, settlement: null }), /成交锁定/);
  assert.match(renderAssetDetailHtml({ ...common, settlement: { status: "PENDING" } }), /登记处理中/);
  assert.match(renderAssetDetailHtml({ ...common, status: "VALID", settlement: { status: "FINALIZED" } }), /交割完成/);
  assert.match(renderAssetDetailHtml({ ...common, settlement: { status: "DISPUTED" } }), /交割失败\/争议/);
});

test("minimum write paths remain fail closed when external writes are disabled", async () => {
  const runtime = createSyntheticRuntime();
  const server = createApp({ config: loadConfig({}), sourceRegistry: runtime.sourceRegistry, runtime });
  await listen(server, async (baseUrl) => {
    for (const path of ["/v1/rwa/settlements", "/v1/rwa/settlements/settlement-001/finalize", "/v1/rwa/settlements/settlement-001/cancel", "/v1/rwa/revocations"]) {
      const response = await fetch(`${baseUrl}${path}`, { method: "POST", body: "{}" });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).errorCode, "ADMIN_WRITES_DISABLED");
    }
  });
});
