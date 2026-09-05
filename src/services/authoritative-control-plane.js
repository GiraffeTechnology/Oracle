import { evidenceHash } from "../domain/canonical-json.js";
import { sealAuthenticatedEvidence } from "./evidence-authentication.js";

const RECORD_KINDS = Object.freeze({
  asset: Object.freeze({ schemaVersion: "asset-record.v1", sourceKind: "REGISTRY", portName: "registrySource" }),
  certificate: Object.freeze({ schemaVersion: "certificate-record.v1", sourceKind: "CERTIFICATE_AUTHORITY", portName: "certificateSource" }),
  warehouse: Object.freeze({ schemaVersion: "warehouse-record.v1", sourceKind: "WAREHOUSE", portName: "warehouseSource" }),
});

const FINALIZATION_INPUT_FIELDS = new Set(["settlementId", "snapshotHash", "evidenceVersion", "assetReference", "certificateReference", "warehouseReference"]);

function verificationCommandInput({ actorId, idempotencyKey, evidenceReferences, evidenceVersion }) {
  if (!evidenceReferences || Object.keys(evidenceReferences).some((key) => !Object.hasOwn(RECORD_KINDS, key))) throw new Error("AUTHORITATIVE_REFERENCES_REQUIRED");
  const fixedEvidenceReferences = Object.freeze(Object.fromEntries(Object.keys(RECORD_KINDS).map((name) => [name, evidenceReferences[name]])));
  return { actorId, idempotencyKey, evidenceReferences: fixedEvidenceReferences, evidenceVersion };
}

function finalizationCommandInput({ actorId, idempotencyKey, request }) {
  if (!request || Object.keys(request).some((key) => !FINALIZATION_INPUT_FIELDS.has(key))) throw new Error("AUTHORITATIVE_FINALIZATION_INPUT_INVALID");
  const fixedRequest = Object.freeze(Object.fromEntries([...FINALIZATION_INPUT_FIELDS].map((name) => [name, request[name]])));
  return { actorId, idempotencyKey, request: fixedRequest };
}

function assertFixedReference(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{2,255}$/.test(value) || /^(?:https?|wss?):/i.test(value)) throw new Error("AUTHORITATIVE_REFERENCE_INVALID");
  return value;
}

async function fetchAuthenticated(port, reference, expected) {
  if (!port || typeof port.fetchByFixedReference !== "function") throw new Error("AUTHORITATIVE_SOURCE_PORT_INVALID");
  const response = await port.fetchByFixedReference(assertFixedReference(reference));
  if (response?.authenticated !== true || response.sourceId !== expected.sourceId || response.schemaVersion !== expected.schemaVersion || !response.record) throw new Error("AUTHORITATIVE_SOURCE_AUTHENTICATION_FAILED");
  const record = structuredClone(response.record);
  if (response.recordHash !== evidenceHash(record)) throw new Error("AUTHORITATIVE_SOURCE_HASH_MISMATCH");
  return Object.freeze(record);
}

export class AuthoritativeOracleControlPlane {
  constructor({ controlPlane, sourcePorts, sourceDefinitions }) {
    if (!controlPlane || !sourcePorts || !Array.isArray(sourceDefinitions)) throw new Error("AUTHORITATIVE_CONTROL_PLANE_DEPENDENCY_MISSING");
    this.controlPlane = controlPlane;
    this.sourcePorts = sourcePorts;
    this.sourceDefinitions = sourceDefinitions;
  }

  async verifyAsset({ actorId, idempotencyKey, evidenceReferences, evidenceVersion }) {
    const commandInput = verificationCommandInput({ actorId, idempotencyKey, evidenceReferences, evidenceVersion });
    const fixedEvidenceReferences = commandInput.evidenceReferences;
    return this.controlPlane.executeResolved("verifyAsset", commandInput, async () => {
      const records = {};
      const evidenceSources = {};
      await Promise.all(Object.entries(RECORD_KINDS).map(async ([name, definition]) => {
        const source = this.sourceDefinitions.find(({ kind }) => kind === definition.sourceKind);
        if (!source) throw new Error("AUTHORITATIVE_SOURCE_DEFINITION_MISSING");
        records[name] = await fetchAuthenticated(this.sourcePorts[definition.portName], fixedEvidenceReferences[name], { sourceId: source.sourceId, schemaVersion: definition.schemaVersion });
        evidenceSources[name] = source.sourceId;
      }));
      return { actorId, idempotencyKey, ...records, evidenceSources, evidenceAuthentication: sealAuthenticatedEvidence({ records, evidenceSources }), evidenceVersion };
    });
  }

  async finalizeSettlement({ actorId, idempotencyKey, request }) {
    const commandInput = finalizationCommandInput({ actorId, idempotencyKey, request });
    const fixedRequest = commandInput.request;
    return this.controlPlane.executeResolved("finalizeSettlement", commandInput, async () => {
      const records = {};
      const evidenceSources = {};
      await Promise.all(Object.entries(RECORD_KINDS).map(async ([name, definition]) => {
        const source = this.sourceDefinitions.find(({ kind }) => kind === definition.sourceKind);
        if (!source) throw new Error("AUTHORITATIVE_SOURCE_DEFINITION_MISSING");
        records[name] = await fetchAuthenticated(this.sourcePorts[definition.portName], fixedRequest[`${name}Reference`], { sourceId: source.sourceId, schemaVersion: definition.schemaVersion });
        evidenceSources[name] = source.sourceId;
      }));
      const { assetReference, certificateReference, warehouseReference, ...safeRequest } = fixedRequest;
      void assetReference;
      void certificateReference;
      void warehouseReference;
      return { actorId, idempotencyKey, request: { ...safeRequest, ...records, evidenceSources, evidenceRecordHashes: Object.freeze(Object.fromEntries(Object.entries(records).map(([name, record]) => [name, evidenceHash(record)]))), evidenceAuthentication: sealAuthenticatedEvidence({ records, evidenceSources }) } };
    });
  }

  // Preserve the write wrapper's command identity without fetching evidence or
  // invoking the operation. Trusted callers supply an authenticated actor only.
  async inspectCommandRecovery(method, commandInput) {
    const input = method === "verifyAsset" ? verificationCommandInput(commandInput)
      : method === "finalizeSettlement" ? finalizationCommandInput(commandInput) : commandInput;
    return this.controlPlane.inspectCommandRecovery(method, input);
  }
}

for (const method of ["bindToken", "issueAttestation", "requestRevocation", "approveAction", "requestSourceDisable", "executeSourceDisable", "requestSignerRotation", "executeSignerRotation", "reconcileSignerRotation", "exportAudit", "executeRevocation", "beginSettlement", "cancelSettlement", "disputeSettlement", "timeoutSettlement"]) {
  AuthoritativeOracleControlPlane.prototype[method] = function delegate(args) {
    return this.controlPlane[method](args);
  };
}
