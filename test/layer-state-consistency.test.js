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

test("pending observation refuses only the perishable operations and lets the owner move", async () => {
  const mapping = await loadLayerStateMapping(MAPPING_FILE);
  const observation = {
    settlementState: "PENDING",
    owner: "holder-b",
    from: "holder-a",
    blockedOperations: ["pledge", "redeem"],
  };
  // holder-a sold to holder-b while the gap was open. ERC-8415 requires that to be possible, so
  // the observation is accepted rather than rejected for the owner having moved.
  assert.equal(verifyLayerSettlementObservation(mapping, observation).oracleStatus, "TRANSFER_PENDING");

  // Reverse checks: the two operations ERC-8415 says must stay available cannot be added back.
  for (const reinstated of ["transfer", "relist"]) {
    assert.throws(
      () =>
        verifyLayerSettlementObservation(mapping, {
          ...observation,
          blockedOperations: [...observation.blockedOperations, reinstated],
        }),
      /LAYER_PENDING_OPERATION_GATES_INVALID/,
    );
  }

  assert.throws(
    () => verifyLayerSettlementObservation(mapping, { ...observation, owner: "" }),
    /LAYER_PENDING_OWNER_MISSING/,
  );
});

test("the mapping cannot reinstate the freeze model", async () => {
  const mapping = await loadLayerStateMapping(MAPPING_FILE);
  assert.equal(mapping.pendingRules.ownerRemainsFrom, false);
  assert.deepEqual([...mapping.pendingRules.blockedOperations].sort(), ["pledge", "redeem"]);

  assert.throws(
    () =>
      validateLayerStateMapping({
        ...mapping,
        pendingRules: { ...mapping.pendingRules, ownerRemainsFrom: true },
      }),
    /LAYER_PENDING_OWNER_RULE_INVALID/,
  );
  assert.throws(
    () =>
      validateLayerStateMapping({
        ...mapping,
        pendingRules: {
          ...mapping.pendingRules,
          blockedOperations: ["transfer", "redeem", "pledge", "relist"],
        },
      }),
    /LAYER_PENDING_OPERATIONS_INVALID/,
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
 * The mapping must keep saying which proposal superseded the one it was originally built
 * against, and that reference is now a number rather than a branch commit: ERC-8415 is the
 * normative authority under AGENTS.md section 1, submitted upstream as ethereum/ERCs#2006.
 * The label is what stops the archived proposal under docs/erc/ from being read as current.
 */
test("layer state mapping names ERC-8415 as the proposal that supersedes it", async () => {
  const mapping = await loadLayerStateMapping(MAPPING_FILE);
  const ref = mapping.ercRevisionRef;
  assert.equal(ref.mappedProposalStatus, "SUPERSEDED");
  assert.equal(ref.supersededBy.ercNumber, 8415);
  assert.equal(ref.supersededBy.upstreamPullRequest, 2006);
  assert.equal(ref.supersededBy.pendingTransfersBlocked, false);
  assert.ok(
    ref.supersededBy.settlementStatusEnum.includes("ADMITTED"),
    "the standard's enum must be recorded so the difference from the archive stays visible",
  );
  assert.ok(
    !Object.hasOwn(ref, "divergenceUnresolved"),
    "the freeze divergence was settled by D-008; a field asserting it is open would be false",
  );
});

test("an undeclared or misnumbered ERC reference is rejected", async () => {
  const mapping = await loadLayerStateMapping(MAPPING_FILE);

  const withoutRef = { ...mapping };
  delete withoutRef.ercRevisionRef;
  assert.throws(() => validateLayerStateMapping(withoutRef), /LAYER_STATE_MAPPING/);

  for (const wrong of [{ ercNumber: 9999 }, { ercNumber: 8416 }, { upstreamPullRequest: 18 }]) {
    const misnumbered = {
      ...mapping,
      ercRevisionRef: {
        ...mapping.ercRevisionRef,
        supersededBy: { ...mapping.ercRevisionRef.supersededBy, ...wrong },
      },
    };
    assert.throws(
      () => validateLayerStateMapping(misnumbered),
      /LAYER_ERC_SUPERSEDED_REFERENCE_INVALID/,
    );
  }

  const freezeReinstated = {
    ...mapping,
    ercRevisionRef: {
      ...mapping.ercRevisionRef,
      supersededBy: { ...mapping.ercRevisionRef.supersededBy, pendingTransfersBlocked: true },
    },
  };
  assert.throws(
    () => validateLayerStateMapping(freezeReinstated),
    /LAYER_ERC_PENDING_TRANSFERS_MUST_NOT_BE_BLOCKED/,
  );
});
