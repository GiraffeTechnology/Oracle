import { readFile } from "node:fs/promises";

const DEPLOYMENT_REF = /^deployment:\/\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+$/;
const SOURCE_KINDS = new Set(["REGISTRY", "CERTIFICATE_AUTHORITY", "WAREHOUSE"]);
const REQUIRED_SOURCE_KINDS = [...SOURCE_KINDS];

function requireExactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_INVALID`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}_UNKNOWN_FIELD:${key}`);
  }
  for (const key of allowed) {
    if (!(key in value)) throw new Error(`${label}_MISSING_FIELD:${key}`);
  }
}

function requireDeploymentRef(value, label) {
  if (typeof value !== "string" || !DEPLOYMENT_REF.test(value)) throw new Error(`${label}_INVALID`);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function validateL2DeploymentProfile(profile) {
  requireExactKeys(profile, ["profileId", "service", "database", "signer", "sources", "events", "security", "retention", "operations"], "L2_PROFILE");
  if (profile.profileId !== "giraffe-oracle-l2/production-v1") throw new Error("L2_PROFILE_ID_UNSUPPORTED");

  requireExactKeys(profile.service, ["bindHost", "port", "publicBaseUrlRef", "timeZone"], "L2_SERVICE");
  if (profile.service.bindHost !== "localhost") throw new Error("L2_NON_LOOPBACK_BIND_REJECTED");
  if (!Number.isInteger(profile.service.port) || profile.service.port < 1024 || profile.service.port > 65535) throw new Error("L2_PORT_INVALID");
  requireDeploymentRef(profile.service.publicBaseUrlRef, "L2_PUBLIC_BASE_URL_REF");
  if (profile.service.timeZone !== "UTC") throw new Error("L2_SERVICE_TIME_ZONE_INVALID");

  requireExactKeys(profile.database, ["driver", "connectionRef", "schemaVersion", "tlsRequired", "appendOnlyAudit"], "L2_DATABASE");
  if (profile.database.driver !== "mysql" || profile.database.schemaVersion !== "oracle-db.v1" || profile.database.tlsRequired !== true || profile.database.appendOnlyAudit !== true) throw new Error("L2_DATABASE_POLICY_INVALID");
  requireDeploymentRef(profile.database.connectionRef, "L2_DATABASE_REF");

  requireExactKeys(profile.signer, ["provider", "signerSetRef", "algorithm", "privateMaterialExportable"], "L2_SIGNER");
  if (profile.signer.provider !== "protected-external" || profile.signer.algorithm !== "Ed25519" || profile.signer.privateMaterialExportable !== false) throw new Error("L2_SIGNER_POLICY_INVALID");
  requireDeploymentRef(profile.signer.signerSetRef, "L2_SIGNER_REF");

  if (!Array.isArray(profile.sources) || profile.sources.length !== 3) throw new Error("L2_SOURCES_INVALID");
  const kinds = new Set();
  const ids = new Set();
  for (const source of profile.sources) {
    requireExactKeys(source, ["sourceId", "kind", "transportRef", "keySetRef", "schemaVersions"], "L2_SOURCE");
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(source.sourceId) || ids.has(source.sourceId)) throw new Error("L2_SOURCE_ID_INVALID");
    if (!SOURCE_KINDS.has(source.kind) || kinds.has(source.kind)) throw new Error("L2_SOURCE_KIND_INVALID");
    if (!Array.isArray(source.schemaVersions) || source.schemaVersions.length === 0 || source.schemaVersions.some((value) => !/^[a-z0-9-]+\.v[1-9][0-9]*$/.test(value))) throw new Error("L2_SOURCE_SCHEMA_INVALID");
    requireDeploymentRef(source.transportRef, "L2_SOURCE_TRANSPORT_REF");
    requireDeploymentRef(source.keySetRef, "L2_SOURCE_KEYSET_REF");
    ids.add(source.sourceId);
    kinds.add(source.kind);
  }
  if (REQUIRED_SOURCE_KINDS.some((kind) => !kinds.has(kind))) throw new Error("L2_REQUIRED_SOURCE_MISSING");

  requireExactKeys(profile.events, ["publisherRef", "delivery", "deadLetterEnabled"], "L2_EVENTS");
  requireDeploymentRef(profile.events.publisherRef, "L2_EVENT_PUBLISHER_REF");
  if (profile.events.delivery !== "at-least-once" || profile.events.deadLetterEnabled !== true) throw new Error("L2_EVENT_POLICY_INVALID");

  requireExactKeys(profile.security, ["adminAuthenticationRef", "dualControlRequired", "callerEndpointsRejected", "sensitiveFieldsInLogs"], "L2_SECURITY");
  requireDeploymentRef(profile.security.adminAuthenticationRef, "L2_ADMIN_AUTH_REF");
  if (profile.security.dualControlRequired !== true || profile.security.callerEndpointsRejected !== true || profile.security.sensitiveFieldsInLogs !== false) throw new Error("L2_SECURITY_POLICY_INVALID");

  requireExactKeys(profile.retention, ["policyId", "evidenceDays", "auditDays", "identityDays"], "L2_RETENTION");
  if (profile.retention.policyId !== "oracle-retention-v1" || ![profile.retention.evidenceDays, profile.retention.auditDays, profile.retention.identityDays].every((value) => Number.isInteger(value) && value > 0)) throw new Error("L2_RETENTION_POLICY_INVALID");

  requireExactKeys(profile.operations, ["healthRef", "alertingRef", "backupRef", "disasterRecoveryRef"], "L2_OPERATIONS");
  for (const [key, value] of Object.entries(profile.operations)) requireDeploymentRef(value, `L2_OPERATIONS_${key.toUpperCase()}`);
  return deepFreeze(structuredClone(profile));
}

export async function loadL2DeploymentProfile(fileName) {
  const text = await readFile(fileName, { encoding: "utf8", flag: "r" });
  return validateL2DeploymentProfile(JSON.parse(text));
}

export function publicL2Profile(profile) {
  const valid = validateL2DeploymentProfile(profile);
  return Object.freeze({
    profileId: valid.profileId,
    databaseSchemaVersion: valid.database.schemaVersion,
    signerAlgorithm: valid.signer.algorithm,
    sourceKinds: Object.freeze(valid.sources.map(({ kind }) => kind).sort()),
    eventDelivery: valid.events.delivery,
    dualControlRequired: valid.security.dualControlRequired,
  });
}

