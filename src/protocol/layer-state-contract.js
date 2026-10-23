import { readFile } from "node:fs/promises";
import { ORACLE_STATUSES } from "../domain/oracle-status.js";

const MAPPING_KEYS = ["NONE", "PENDING", "FINALIZED", "CANCELLED", "DISPUTED", "TIMED_OUT"];
const L3_STATUS_CODES = Object.freeze({ NONE: 0, PENDING: 1, FINALIZED: 2, CANCELLED: 3 });
const EXPECTED_MAPPINGS = Object.freeze({
  NONE: Object.freeze({ oracleStatus: "VALID", l3SettlementStatus: "NONE" }),
  PENDING: Object.freeze({ oracleStatus: "TRANSFER_PENDING", l3SettlementStatus: "PENDING" }),
  FINALIZED: Object.freeze({ oracleStatus: "VALID", l3SettlementStatus: "FINALIZED" }),
  CANCELLED: Object.freeze({ oracleStatus: "REVIEW_REQUIRED", l3SettlementStatus: "CANCELLED" }),
  DISPUTED: Object.freeze({ oracleStatus: "REVIEW_REQUIRED", l3SettlementStatus: "CANCELLED" }),
  TIMED_OUT: Object.freeze({ oracleStatus: "REVIEW_REQUIRED", l3SettlementStatus: "CANCELLED" }),
});
const PR13_EXACT_COMMIT = "5657661614dd1c9b03f65c5e6585bfd00ecbcc6e";
const BLOCKED_OPERATIONS = Object.freeze(["transfer", "redeem", "pledge", "relist"]);
const FINALIZATION_EVENTS = Object.freeze([
  "CertificateSuperseded",
  "Transfer",
  "SettlementFinalized",
]);

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_INVALID`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}_FIELDS_INVALID`);
}

function exactSet(actual, expected, label) {
  if (!Array.isArray(actual) || JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label}_INVALID`);
  }
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

/**
 * D-007 requires every reference to ERC content to name the commit it relies on, because the
 * proposal lives on PR #13's branch and keeps moving.
 *
 * This mapping was built against the superseded proposal and encodes the PRD's freeze model.
 * The current proposal reverses that position and carries a five-value status enum, so the
 * mapping is knowingly out of date on a point the product has not yet decided. Recording that
 * is the honest state; silently carrying an unlabelled mapping is not. The fields are
 * validated so the label cannot be dropped, and so the day someone updates the mapping they
 * must consciously restate what it maps to.
 */
function validateErcRevisionRef(ref) {
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) {
    throw new Error("LAYER_ERC_REVISION_REF_INVALID");
  }
  exactKeys(
    ref,
    [
      "mappedProposalTitle",
      "mappedProposalStatus",
      "archivePath",
      "supersededBy",
      "divergenceUnresolved",
      "divergenceNote",
    ],
    "LAYER_ERC_REVISION_REF",
  );
  if (ref.mappedProposalStatus !== "SUPERSEDED" && ref.mappedProposalStatus !== "CURRENT") {
    throw new Error("LAYER_ERC_REVISION_STATUS_INVALID");
  }
  if (ref.mappedProposalStatus === "SUPERSEDED") {
    const by = ref.supersededBy;
    if (by === null || typeof by !== "object") throw new Error("LAYER_ERC_SUPERSEDED_BY_MISSING");
    if (by.commit !== PR13_EXACT_COMMIT) {
      throw new Error("LAYER_ERC_SUPERSEDED_COMMIT_INVALID");
    }
    if (!Array.isArray(by.settlementStatusEnum) || by.settlementStatusEnum.length === 0) {
      throw new Error("LAYER_ERC_SUPERSEDED_ENUM_INVALID");
    }
    if (ref.divergenceUnresolved !== true) {
      throw new Error("LAYER_ERC_DIVERGENCE_MUST_BE_DECLARED");
    }
  }
  return ref;
}

export function validateLayerStateMapping(mapping) {
  exactKeys(
    mapping,
    [
      "schemaVersion",
      "contractId",
      "oracleStatuses",
      "l3SettlementStatuses",
      "settlementMappings",
      "pendingRules",
      "finalizationRules",
      "noneSemantics",
      "wenbaoProfileRef",
      "l3ProfileRef",
      "ercRevisionRef",
    ],
    "LAYER_STATE_MAPPING",
  );
  validateErcRevisionRef(mapping.ercRevisionRef);
  if (mapping.schemaVersion !== 1 || mapping.contractId !== "giraffe-oracle/layer-state-mapping-v1") {
    throw new Error("LAYER_STATE_MAPPING_ID_INVALID");
  }
  exactSet(mapping.oracleStatuses, ORACLE_STATUSES, "LAYER_ORACLE_STATUS_INVENTORY");
  exactKeys(mapping.l3SettlementStatuses, Object.keys(L3_STATUS_CODES), "LAYER_L3_STATUS_INVENTORY");
  for (const [state, code] of Object.entries(L3_STATUS_CODES)) {
    if (mapping.l3SettlementStatuses[state] !== code) throw new Error(`LAYER_L3_STATUS_CODE_INVALID:${state}`);
  }
  exactKeys(mapping.settlementMappings, MAPPING_KEYS, "LAYER_SETTLEMENT_MAPPING_INVENTORY");
  for (const state of MAPPING_KEYS) {
    exactKeys(mapping.settlementMappings[state], ["oracleStatus", "l3SettlementStatus"], `LAYER_MAPPING_${state}`);
    const expected = EXPECTED_MAPPINGS[state];
    const actual = mapping.settlementMappings[state];
    if (
      actual.oracleStatus !== expected.oracleStatus ||
      actual.l3SettlementStatus !== expected.l3SettlementStatus
    ) {
      throw new Error(`LAYER_SETTLEMENT_MAPPING_INVALID:${state}`);
    }
  }
  exactKeys(mapping.pendingRules, ["ownerRemainsFrom", "blockedOperations"], "LAYER_PENDING_RULES");
  if (mapping.pendingRules.ownerRemainsFrom !== true) throw new Error("LAYER_PENDING_OWNER_RULE_INVALID");
  exactSet(mapping.pendingRules.blockedOperations, BLOCKED_OPERATIONS, "LAYER_PENDING_OPERATIONS");
  exactKeys(
    mapping.finalizationRules,
    ["atomic", "certificateVersionIncrement", "requiredEvents"],
    "LAYER_FINALIZATION_RULES",
  );
  if (mapping.finalizationRules.atomic !== true || mapping.finalizationRules.certificateVersionIncrement !== 1) {
    throw new Error("LAYER_FINALIZATION_ATOMICITY_INVALID");
  }
  exactSet(mapping.finalizationRules.requiredEvents, FINALIZATION_EVENTS, "LAYER_FINALIZATION_EVENTS");
  exactKeys(
    mapping.noneSemantics,
    ["meansNoIncompleteSettlementObserved", "prerequisiteOracleVerificationRequired"],
    "LAYER_NONE_SEMANTICS",
  );
  if (
    mapping.noneSemantics.meansNoIncompleteSettlementObserved !== true ||
    mapping.noneSemantics.prerequisiteOracleVerificationRequired !== true
  ) {
    throw new Error("LAYER_NONE_SEMANTICS_INVALID");
  }
  if (
    mapping.wenbaoProfileRef !== "config/settlement.wenbao-sandbox.json" ||
    mapping.l3ProfileRef !== "config/l3.protocol.wd-0.1.1.json"
  ) {
    throw new Error("LAYER_PROFILE_REFERENCE_INVALID");
  }
  return freeze(structuredClone(mapping));
}

export async function loadLayerStateMapping(fileName) {
  const text = await readFile(fileName, { encoding: "utf8", flag: "r" });
  return validateLayerStateMapping(JSON.parse(text));
}

export function validateExternalConsumerStateContract(contract) {
  exactKeys(
    contract,
    [
      "schemaVersion",
      "contractId",
      "consumerClass",
      "implementationStatus",
      "agentBehaviorSelection",
      "signingAuthority",
      "privateKeyCustody",
      "delegatedSigning",
      "prohibitedAgentBehavior",
      "futureExchange",
      "currentSubprocesses",
      "marketplaceObservation",
      "oracleRuntimeCoupling",
      "verificationBoundary",
      "stateMappingRef",
      "pendingBlockedOperations",
    ],
    "EXTERNAL_CONSUMER_STATE_CONTRACT",
  );
  if (
    contract.schemaVersion !== 1 ||
    contract.contractId !== "giraffe-oracle/external-consumer-state-contract-v1" ||
    contract.consumerClass !== "EXTERNAL_CHAIN_AGENT"
  ) {
    throw new Error("EXTERNAL_CONSUMER_STATE_CONTRACT_ID_INVALID");
  }
  if (contract.implementationStatus !== "NOT_VERIFIED_EXTERNAL") {
    throw new Error("EXTERNAL_CONSUMER_IMPLEMENTATION_STATUS_INVALID");
  }
  if (
    contract.agentBehaviorSelection !== "A_NON_CUSTODIAL_USER_SIGNED" ||
    contract.signingAuthority !== "USER_WALLET_OR_SAFE_OWNERS_ONLY" ||
    contract.privateKeyCustody !== false ||
    contract.delegatedSigning !== false ||
    contract.prohibitedAgentBehavior !== "B_CUSTODIAL_OR_DELEGATED_SIGNING"
  ) {
    throw new Error("EXTERNAL_CONSUMER_NON_CUSTODIAL_BOUNDARY_INVALID");
  }
  exactKeys(
    contract.futureExchange,
    ["agentBehavior", "implementationStatus", "authorizationStatus"],
    "EXTERNAL_CONSUMER_FUTURE_EXCHANGE",
  );
  if (
    contract.futureExchange.agentBehavior !== "C_EXCHANGE" ||
    contract.futureExchange.implementationStatus !== "NOT_IMPLEMENTED" ||
    contract.futureExchange.authorizationStatus !== "NOT_AUTHORIZED"
  ) {
    throw new Error("EXTERNAL_CONSUMER_FUTURE_EXCHANGE_BOUNDARY_INVALID");
  }
  exactKeys(contract.currentSubprocesses, ["charity"], "EXTERNAL_CONSUMER_SUBPROCESSES");
  exactKeys(
    contract.currentSubprocesses.charity,
    ["parent", "custody", "signingAuthority", "stateConsistencyRequired"],
    "EXTERNAL_CONSUMER_CHARITY",
  );
  if (
    contract.currentSubprocesses.charity.parent !== "MARKET_AGENT" ||
    contract.currentSubprocesses.charity.custody !== "NON_CUSTODIAL" ||
    contract.currentSubprocesses.charity.signingAuthority !== "USER_WALLET_OR_SAFE_OWNERS_ONLY" ||
    contract.currentSubprocesses.charity.stateConsistencyRequired !== true
  ) {
    throw new Error("EXTERNAL_CONSUMER_CHARITY_BOUNDARY_INVALID");
  }
  exactKeys(
    contract.marketplaceObservation,
    ["access", "observations", "oracleAuthority", "sourceProviderRequired", "separateFromOracleEvidence"],
    "EXTERNAL_CONSUMER_MARKETPLACE_OBSERVATION",
  );
  exactSet(
    contract.marketplaceObservation.observations,
    ["LISTING_STATUS", "SALE_STATUS", "SALE_HISTORY"],
    "EXTERNAL_CONSUMER_MARKETPLACE_OBSERVATIONS",
  );
  if (
    contract.marketplaceObservation.access !== "READ_ONLY_PUBLIC" ||
    contract.marketplaceObservation.oracleAuthority !== false ||
    contract.marketplaceObservation.sourceProviderRequired !== true ||
    contract.marketplaceObservation.separateFromOracleEvidence !== true
  ) {
    throw new Error("EXTERNAL_CONSUMER_MARKETPLACE_BOUNDARY_INVALID");
  }
  if (
    contract.oracleRuntimeCoupling !== false ||
    contract.verificationBoundary !== "READ_ONLY_SDK_AND_PROOF_FORMAT" ||
    contract.stateMappingRef !== "config/layer-state-mapping.v1.json"
  ) {
    throw new Error("EXTERNAL_CONSUMER_BOUNDARY_INVALID");
  }
  exactSet(contract.pendingBlockedOperations, BLOCKED_OPERATIONS, "EXTERNAL_CONSUMER_PENDING_OPERATIONS");
  return freeze(structuredClone(contract));
}

export async function loadExternalConsumerStateContract(fileName) {
  const text = await readFile(fileName, { encoding: "utf8", flag: "r" });
  return validateExternalConsumerStateContract(JSON.parse(text));
}

export function mapLayerSettlementState(mapping, settlementState) {
  const valid = validateLayerStateMapping(mapping);
  const result = valid.settlementMappings[settlementState];
  if (!result) throw new Error(`LAYER_SETTLEMENT_STATE_UNKNOWN:${settlementState}`);
  return result;
}

export function verifyLayerSettlementObservation(mapping, observation) {
  const valid = validateLayerStateMapping(mapping);
  const result = mapLayerSettlementState(valid, observation?.settlementState);
  if (observation?.settlementState === "PENDING") {
    if (typeof observation.owner !== "string" || observation.owner.length === 0 || observation.owner !== observation.from) {
      throw new Error("LAYER_PENDING_OWNER_MISMATCH");
    }
    exactSet(observation.blockedOperations, valid.pendingRules.blockedOperations, "LAYER_PENDING_OPERATION_GATES");
  }
  if (observation?.settlementState === "FINALIZED") {
    if (observation.atomic !== true) throw new Error("LAYER_FINALIZATION_NOT_ATOMIC");
    if (
      !Number.isInteger(observation.previousCertificateVersion) ||
      observation.previousCertificateVersion < 0 ||
      observation.certificateVersion !==
        observation.previousCertificateVersion + valid.finalizationRules.certificateVersionIncrement
    ) {
      throw new Error("LAYER_FINALIZATION_VERSION_INVALID");
    }
    exactSet(observation.events, valid.finalizationRules.requiredEvents, "LAYER_FINALIZATION_EVENT_SET");
  }
  return result;
}

export function verifyLayerStateConsistency({ mapping, externalConsumer, protocolProfile, wenbaoProfile }) {
  const valid = validateLayerStateMapping(mapping);
  validateExternalConsumerStateContract(externalConsumer);
  exactKeys(protocolProfile?.settlementStatuses, Object.keys(L3_STATUS_CODES), "LAYER_PROTOCOL_STATUSES");
  exactKeys(protocolProfile?.oracleStatusMapping, Object.keys(L3_STATUS_CODES), "LAYER_PROTOCOL_MAPPINGS");
  for (const [state, code] of Object.entries(L3_STATUS_CODES)) {
    if (protocolProfile.settlementStatuses[state] !== code) throw new Error(`LAYER_PROTOCOL_CODE_DRIFT:${state}`);
    if (protocolProfile.oracleStatusMapping[state] !== valid.settlementMappings[state].oracleStatus) {
      throw new Error(`LAYER_PROTOCOL_MAPPING_DRIFT:${state}`);
    }
  }
  if (wenbaoProfile?.onTimeout !== "REVIEW_REQUIRED" || wenbaoProfile?.onDispute !== "REVIEW_REQUIRED") {
    throw new Error("LAYER_WENBAO_FAILURE_MAPPING_DRIFT");
  }
  return true;
}
