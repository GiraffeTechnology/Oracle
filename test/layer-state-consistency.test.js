import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  loadExternalConsumerStateContract,
  loadLayerStateMapping,
  mapLayerSettlementState,
  validateExternalConsumerStateContract,
  validateLayerStateMapping,
  verifyLayerSettlementObservation,
} from "../src/protocol/layer-state-contract.js";

const MAPPING_FILE = path.resolve("config/layer-state-mapping.v1.json");
const EXTERNAL_FILE = path.resolve("config/external-consumer-state-contract.v1.json");

test("layer state contract maps every settlement outcome fail closed", async () => {
  const mapping = await loadLayerStateMapping(MAPPING_FILE);
  assert.equal(mapping.oracleStatuses.length, 8);
  assert.deepEqual(mapLayerSettlementState(mapping, "PENDING"), {
    oracleStatus: "TRANSFER_PENDING",
    l3SettlementStatus: "PENDING",
  });
  assert.deepEqual(mapLayerSettlementState(mapping, "FINALIZED"), {
    oracleStatus: "VALID",
    l3SettlementStatus: "FINALIZED",
  });
  for (const state of ["CANCELLED", "DISPUTED", "TIMED_OUT"]) {
    assert.deepEqual(mapLayerSettlementState(mapping, state), {
      oracleStatus: "REVIEW_REQUIRED",
      l3SettlementStatus: "CANCELLED",
    });
  }
  assert.deepEqual(mapLayerSettlementState(mapping, "NONE"), {
    oracleStatus: "VALID",
    l3SettlementStatus: "NONE",
  });
  assert.equal(mapping.noneSemantics.prerequisiteOracleVerificationRequired, true);
  assert.throws(() => mapLayerSettlementState(mapping, "UNKNOWN"), /LAYER_SETTLEMENT_STATE_UNKNOWN/);
});

test("pending observation preserves owner and blocks all controlled operations", async () => {
  const mapping = await loadLayerStateMapping(MAPPING_FILE);
  const observation = {
    settlementState: "PENDING",
    owner: "holder-a",
    from: "holder-a",
    blockedOperations: ["transfer", "redeem", "pledge", "relist"],
  };
  assert.equal(verifyLayerSettlementObservation(mapping, observation).oracleStatus, "TRANSFER_PENDING");
  assert.throws(
    () => verifyLayerSettlementObservation(mapping, { ...observation, owner: "holder-b" }),
    /LAYER_PENDING_OWNER_MISMATCH/,
  );
  assert.throws(
    () => verifyLayerSettlementObservation(mapping, { ...observation, blockedOperations: ["transfer"] }),
    /LAYER_PENDING_OPERATION_GATES_INVALID/,
  );
});

test("finalized observation requires atomic version increment and complete event set", async () => {
  const mapping = await loadLayerStateMapping(MAPPING_FILE);
  const observation = {
    settlementState: "FINALIZED",
    atomic: true,
    previousCertificateVersion: 4,
    certificateVersion: 5,
    events: ["SettlementFinalized", "CertificateSuperseded", "Transfer"],
  };
  assert.equal(verifyLayerSettlementObservation(mapping, observation).oracleStatus, "VALID");
  assert.throws(
    () => verifyLayerSettlementObservation(mapping, { ...observation, certificateVersion: 6 }),
    /LAYER_FINALIZATION_VERSION_INVALID/,
  );
  assert.throws(
    () => verifyLayerSettlementObservation(mapping, { ...observation, events: ["SettlementFinalized"] }),
    /LAYER_FINALIZATION_EVENT_SET_INVALID/,
  );
});

test("temporary L3 status-code drift injection is rejected", async () => {
  const mapping = await loadLayerStateMapping(MAPPING_FILE);
  const codeDrift = structuredClone(mapping);
  codeDrift.l3SettlementStatuses.PENDING = 7;
  assert.throws(() => validateLayerStateMapping(codeDrift), /LAYER_L3_STATUS_CODE_INVALID:PENDING/);
});

test("temporary optimistic CANCELLED to VALID injection is rejected", async () => {
  const mapping = await loadLayerStateMapping(MAPPING_FILE);
  const optimisticCancellation = structuredClone(mapping);
  optimisticCancellation.settlementMappings.CANCELLED.oracleStatus = "VALID";
  assert.throws(
    () => validateLayerStateMapping(optimisticCancellation),
    /LAYER_SETTLEMENT_MAPPING_INVALID:CANCELLED/,
  );
});

test("temporary external VERIFIED claim injection is rejected", async () => {
  const contract = await loadExternalConsumerStateContract(EXTERNAL_FILE);
  assert.throws(
    () => validateExternalConsumerStateContract({ ...contract, implementationStatus: "VERIFIED" }),
    /EXTERNAL_CONSUMER_IMPLEMENTATION_STATUS_INVALID/,
  );
});

test("external consumer fixture fixes non-custodial market and charity boundaries", async () => {
  const contract = await loadExternalConsumerStateContract(EXTERNAL_FILE);
  assert.equal(contract.implementationStatus, "NOT_VERIFIED_EXTERNAL");
  assert.equal(contract.agentBehaviorSelection, "A_NON_CUSTODIAL_USER_SIGNED");
  assert.equal(contract.privateKeyCustody, false);
  assert.equal(contract.delegatedSigning, false);
  assert.equal(contract.currentSubprocesses.charity.parent, "MARKET_AGENT");
  assert.equal(contract.currentSubprocesses.charity.stateConsistencyRequired, true);
  assert.equal(contract.futureExchange.implementationStatus, "NOT_IMPLEMENTED");
  assert.equal(contract.futureExchange.authorizationStatus, "NOT_AUTHORIZED");
  assert.equal(contract.marketplaceObservation.oracleAuthority, false);
  assert.equal(contract.marketplaceObservation.sourceProviderRequired, true);
  assert.equal(contract.marketplaceObservation.separateFromOracleEvidence, true);
  assert.equal(contract.oracleRuntimeCoupling, false);

  assert.throws(
    () => validateExternalConsumerStateContract({ ...contract, privateKeyCustody: true }),
    /EXTERNAL_CONSUMER_NON_CUSTODIAL_BOUNDARY_INVALID/,
  );
  assert.throws(
    () =>
      validateExternalConsumerStateContract({
        ...contract,
        futureExchange: { ...contract.futureExchange, authorizationStatus: "AUTHORIZED" },
      }),
    /EXTERNAL_CONSUMER_FUTURE_EXCHANGE_BOUNDARY_INVALID/,
  );
  assert.throws(
    () =>
      validateExternalConsumerStateContract({
        ...contract,
        marketplaceObservation: { ...contract.marketplaceObservation, sourceProviderRequired: false },
      }),
    /EXTERNAL_CONSUMER_MARKETPLACE_BOUNDARY_INVALID/,
  );
});

/**
 * D-007: the mapping must keep saying which ERC revision it was built against. It encodes the
 * PRD's freeze model against the superseded proposal, while the current one keeps the token
 * trading — a disagreement the product has not settled. The label is what stops the mapping
 * from being read as current, so dropping it must fail rather than pass quietly.
 */
test("D-007 layer state mapping declares the ERC revision it maps to", async () => {
  const mapping = await loadLayerStateMapping(MAPPING_FILE);
  const ref = mapping.ercRevisionRef;
  assert.equal(ref.mappedProposalStatus, "SUPERSEDED");
  assert.match(ref.supersededBy.commit, /^[0-9a-f]{40}$/);
  assert.equal(ref.divergenceUnresolved, true);
  assert.ok(
    ref.supersededBy.settlementStatusEnum.includes("ADMITTED"),
    "the current proposal's enum must be recorded so the difference is visible",
  );
});

test("D-007 an undeclared or unpinned ERC revision is rejected", async () => {
  const mapping = await loadLayerStateMapping(MAPPING_FILE);

  const withoutRef = { ...mapping };
  delete withoutRef.ercRevisionRef;
  assert.throws(() => validateLayerStateMapping(withoutRef), /LAYER_STATE_MAPPING/);

  const unpinned = {
    ...mapping,
    ercRevisionRef: {
      ...mapping.ercRevisionRef,
      supersededBy: { ...mapping.ercRevisionRef.supersededBy, commit: "386d6d4" },
    },
  };
  assert.throws(() => validateLayerStateMapping(unpinned), /LAYER_ERC_SUPERSEDED_COMMIT_INVALID/);

  const divergenceHidden = {
    ...mapping,
    ercRevisionRef: { ...mapping.ercRevisionRef, divergenceUnresolved: false },
  };
  assert.throws(
    () => validateLayerStateMapping(divergenceHidden),
    /LAYER_ERC_DIVERGENCE_MUST_BE_DECLARED/,
  );
});
