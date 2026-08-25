import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { OracleStatus } from "../domain/oracle-status.js";

const HASH = /^[a-f0-9]{64}$/;
const INTERFACE_ID = /^0x[a-f0-9]{8}$/;
const ARTIFACT_KEYS = ["formalZhSha256", "formalEnSha256", "submissionCandidateSha256", "referenceImplementationSha256", "testVectorsSha256"];
const INTERFACE_KEYS = ["versionedCertificate", "deferredSettlement", "assetBoundTokenId"];
const EVENT_NAMES = ["CertificateInitialized", "CertificateSuperseded", "SettlementStarted", "SettlementFinalized", "SettlementCancelled", "Transfer"];
const STATUS_CODES = Object.freeze({ NONE: 0, PENDING: 1, FINALIZED: 2, CANCELLED: 3 });
const STATUS_MAPPING = Object.freeze({ NONE: OracleStatus.VALID, PENDING: OracleStatus.TRANSFER_PENDING, FINALIZED: OracleStatus.VALID, CANCELLED: OracleStatus.VALID });

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_INVALID`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}_FIELDS_INVALID`);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export function validateProtocolProfile(profile) {
  exactKeys(profile, ["profileId", "status", "productionClaimAllowed", "artifacts", "interfaces", "requiredAdvertisedInterfaces", "settlementStatuses", "events", "oracleStatusMapping", "rules"], "PROTOCOL_PROFILE");
  if (profile.profileId !== "giraffe-rwa-certificate-settlement/wd-0.1.1") throw new Error("PROTOCOL_PROFILE_ID_UNSUPPORTED");
  if (profile.status !== "working-draft" || profile.productionClaimAllowed !== false) throw new Error("PROTOCOL_DRAFT_BOUNDARY_INVALID");
  exactKeys(profile.artifacts, ARTIFACT_KEYS, "PROTOCOL_ARTIFACTS");
  if (ARTIFACT_KEYS.some((key) => !HASH.test(profile.artifacts[key]))) throw new Error("PROTOCOL_ARTIFACT_HASH_INVALID");
  exactKeys(profile.interfaces, INTERFACE_KEYS, "PROTOCOL_INTERFACES");
  if (INTERFACE_KEYS.some((key) => !INTERFACE_ID.test(profile.interfaces[key]))) throw new Error("PROTOCOL_INTERFACE_ID_INVALID");
  const interfaceIds = Object.values(profile.interfaces).sort();
  if (!Array.isArray(profile.requiredAdvertisedInterfaces) || JSON.stringify([...profile.requiredAdvertisedInterfaces].sort()) !== JSON.stringify(interfaceIds)) throw new Error("PROTOCOL_REQUIRED_INTERFACES_INVALID");
  exactKeys(profile.settlementStatuses, Object.keys(STATUS_CODES), "PROTOCOL_STATUSES");
  if (Object.entries(STATUS_CODES).some(([key, value]) => profile.settlementStatuses[key] !== value)) throw new Error("PROTOCOL_STATUS_CODE_INVALID");
  if (!Array.isArray(profile.events) || JSON.stringify([...profile.events].sort()) !== JSON.stringify([...EVENT_NAMES].sort())) throw new Error("PROTOCOL_EVENTS_INVALID");
  exactKeys(profile.oracleStatusMapping, Object.keys(STATUS_MAPPING), "PROTOCOL_STATUS_MAPPING");
  if (Object.entries(STATUS_MAPPING).some(([key, value]) => profile.oracleStatusMapping[key] !== value)) throw new Error("PROTOCOL_ORACLE_MAPPING_INVALID");
  exactKeys(profile.rules, ["ownerRemainsFromWhilePending", "allTransfersBlockedWhilePending", "finalizeAtomic", "certificateVersionIncrement", "cancelChangesCertificate", "errorsAreStableAbi", "eventOrderIsConsensus", "authorityDataEncoding"], "PROTOCOL_RULES");
  const rules = profile.rules;
  if (rules.ownerRemainsFromWhilePending !== true || rules.allTransfersBlockedWhilePending !== true || rules.finalizeAtomic !== true || rules.certificateVersionIncrement !== 1 || rules.cancelChangesCertificate !== false || rules.errorsAreStableAbi !== false || rules.eventOrderIsConsensus !== false || rules.authorityDataEncoding !== "abi.encode(uint64 validUntil,uint256 nonce,bytes signature)") throw new Error("PROTOCOL_RULES_INVALID");
  return freeze(structuredClone(profile));
}

export async function loadProtocolProfile(fileName) {
  const text = await readFile(fileName, { encoding: "utf8", flag: "r" });
  return validateProtocolProfile(JSON.parse(text));
}

export function publicProtocolProfile(profile) {
  const valid = validateProtocolProfile(profile);
  return Object.freeze({
    profileId: valid.profileId,
    status: valid.status,
    productionClaimAllowed: valid.productionClaimAllowed,
    artifacts: valid.artifacts,
    interfaces: valid.interfaces,
    requiredAdvertisedInterfaces: valid.requiredAdvertisedInterfaces,
  });
}

export function requireProtocolInterfaces(profile, advertisedInterfaces) {
  const valid = validateProtocolProfile(profile);
  const advertised = new Set(advertisedInterfaces ?? []);
  const missing = valid.requiredAdvertisedInterfaces.filter((interfaceId) => !advertised.has(interfaceId));
  if (missing.length > 0) throw new Error(`PROTOCOL_INTERFACE_MISSING:${missing.join(",")}`);
  return true;
}

export function mapProtocolSettlementStatus(profile, statusCode) {
  const valid = validateProtocolProfile(profile);
  const name = Object.entries(valid.settlementStatuses).find(([, code]) => code === statusCode)?.[0];
  if (!name) throw new Error("PROTOCOL_SETTLEMENT_STATUS_UNKNOWN");
  return valid.oracleStatusMapping[name];
}

export function verifyProtocolObservation(profile, observation) {
  const valid = validateProtocolProfile(profile);
  requireProtocolInterfaces(valid, observation?.advertisedInterfaces);
  const oracleStatus = mapProtocolSettlementStatus(valid, observation?.settlementStatus);
  if (observation.settlementStatus === valid.settlementStatuses.PENDING) {
    if (observation.owner !== observation.from) throw new Error("PROTOCOL_PENDING_OWNER_MISMATCH");
    if (observation.transfersBlocked !== true) throw new Error("PROTOCOL_PENDING_TRANSFER_GATE_MISSING");
  }
  if (observation.settlementStatus === valid.settlementStatuses.FINALIZED) {
    if (observation.atomic !== true) throw new Error("PROTOCOL_FINALIZE_NOT_ATOMIC");
    if (observation.certificateVersion !== observation.previousCertificateVersion + valid.rules.certificateVersionIncrement) throw new Error("PROTOCOL_CERTIFICATE_VERSION_INVALID");
    const events = new Set(observation.events ?? []);
    for (const required of ["CertificateSuperseded", "Transfer", "SettlementFinalized"]) {
      if (!events.has(required)) throw new Error(`PROTOCOL_FINALIZE_EVENT_MISSING:${required}`);
    }
  }
  return Object.freeze({ compatible: true, profileId: valid.profileId, oracleStatus });
}

export function verifyProtocolArtifactBytes(profile, artifacts) {
  const valid = validateProtocolProfile(profile);
  exactKeys(artifacts, ARTIFACT_KEYS, "PROTOCOL_ARTIFACT_BYTES");
  for (const key of ARTIFACT_KEYS) {
    const bytes = artifacts[key];
    if (!(bytes instanceof Uint8Array)) throw new Error(`PROTOCOL_ARTIFACT_BYTES_INVALID:${key}`);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== valid.artifacts[key]) throw new Error(`PROTOCOL_ARTIFACT_HASH_MISMATCH:${key}`);
  }
  return true;
}
