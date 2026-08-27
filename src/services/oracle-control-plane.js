import { evidenceHash } from "../domain/canonical-json.js";
import { OracleStatus } from "../domain/oracle-status.js";
import { assertAssetFactsOnly } from "./product-boundary.js";
import { assertAuthenticatedEvidence } from "./evidence-authentication.js";

const SHA256_HEX = /^[a-f0-9]{64}$/i;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const FACT_BINDINGS = Object.freeze({
  TRANSFER_STATUS: Object.freeze({ sourceKind: "REGISTRY", field: "transferEligibility" }),
  ORACLE_STATUS: Object.freeze({ sourceKind: "REGISTRY", field: "oracleStatus" }),
  CERTIFICATE_STATUS: Object.freeze({ sourceKind: "CERTIFICATE_AUTHORITY", field: "status" }),
  CERTIFICATE_VERSION: Object.freeze({ sourceKind: "CERTIFICATE_AUTHORITY", field: "certificateVersion" }),
  WAREHOUSE_STATUS: Object.freeze({ sourceKind: "WAREHOUSE", field: "warehouseStatus" }),
  WAREHOUSE_ENCUMBRANCE_STATUS: Object.freeze({ sourceKind: "WAREHOUSE", field: "encumbranceStatus" }),
});
const SOURCE_SCHEMAS = Object.freeze({
  REGISTRY: "asset-record.v1",
  CERTIFICATE_AUTHORITY: "certificate-record.v1",
  WAREHOUSE: "warehouse-record.v1",
});

function resolveEvidenceSource(runtime, kind, explicitSourceId) {
  const candidates = runtime.sourceRegistry.listPublic().filter((source) => source.kind === kind);
  const source = explicitSourceId
    ? candidates.find(({ id }) => id === explicitSourceId)
    : candidates.length === 1 ? candidates[0] : null;
  if (!source) throw new Error(explicitSourceId ? "EVIDENCE_SOURCE_AUTHORITY_INVALID" : "EVIDENCE_SOURCE_AUTHORITY_REQUIRED");
  runtime.sourceRegistry.requireActive(source.id, SOURCE_SCHEMAS[kind]);
  return Object.freeze({ sourceId: source.id, schemaVersion: SOURCE_SCHEMAS[kind] });
}

function controlledFailureCode(error, fallback) {
  const candidate = typeof error?.code === "string" ? error.code : error?.message;
  return SAFE_ERROR_CODE.test(candidate ?? "") ? candidate : fallback;
}

function signerRotationSubject(actionId, fromSignerSetId, toSignerSetId, rotationDigest) {
  const subjectId = fromSignerSetId + "->" + toSignerSetId;
  if (typeof actionId !== "string" || actionId.length < 1 || actionId.length > 128 || typeof fromSignerSetId !== "string" || fromSignerSetId.length < 1 || fromSignerSetId.length > 64 || typeof toSignerSetId !== "string" || toSignerSetId.length < 1 || toSignerSetId.length > 64 || fromSignerSetId === toSignerSetId || subjectId.length > 128 || !SHA256_HEX.test(rotationDigest ?? "")) throw new Error("SIGNER_ROTATION_REQUEST_INVALID");
  return subjectId;
}

function assertRotationEvidence(result) {
  if (result?.oldSignerRejected !== true || result?.newSignerAccepted !== true || result?.rotationAudited !== true || result?.auditChainVerified !== true || result?.dualApprovalVerified !== true || result?.rollbackVerified !== true || !Number.isFinite(result?.rollbackWindowSeconds) || result.rollbackWindowSeconds < 3600 || !Number.isFinite(result?.timelockSeconds) || result.timelockSeconds < 300 || result?.privateMaterialObserved !== false || result?.networkUsed !== false || result?.transactionSigned !== false) throw new Error("SIGNER_ROTATION_BROKER_RESULT_INVALID");
  return result;
}

async function activateRuntimeSigner(signerRotationBroker, attestationService, scope) {
  if (typeof signerRotationBroker?.activateRuntime !== "function") throw new Error("SIGNER_RUNTIME_ACTIVATOR_UNAVAILABLE");
  const result = await signerRotationBroker.activateRuntime({ ...scope, attestationService });
  if (result?.signerSetId !== scope.toSignerSetId || result?.privateMaterialIncluded !== false || attestationService.signerSetId !== scope.toSignerSetId) throw new Error("SIGNER_RUNTIME_ACTIVATION_INVALID");
  return result;
}

export class OracleControlPlane {
  constructor({ runtime, authorizer, dualControl, commandJournal, outbox, signerRotationBroker = null, allowSyntheticEvidence = false, clock = () => new Date() }) {
    Object.assign(this, { runtime, authorizer, dualControl, commandJournal, outbox, signerRotationBroker, allowSyntheticEvidence, clock });
  }

  authorizeCommand(method, input) {
    if (method === "exportAudit") {
      if (typeof input.adminOperations?.authorizeExport !== "function") throw new Error("AUDIT_EXPORT_AUTHORIZATION_UNAVAILABLE");
      return input.adminOperations.authorizeExport(input.actorId, input.purpose);
    }
    const permissions = {
      verifyAsset: "asset:verify",
      bindToken: "token:bind",
      issueAttestation: "attestation:issue",
      requestRevocation: "attestation:revoke",
      executeRevocation: "attestation:revoke",
      approveAction: "action:approve",
      requestSourceDisable: "source:disable",
      executeSourceDisable: "source:disable",
      requestSignerRotation: "signer:rotate",
      executeSignerRotation: "signer:rotate",
      reconcileSignerRotation: "signer:rotate",
      beginSettlement: "settlement:manage",
      finalizeSettlement: "settlement:manage",
      cancelSettlement: "settlement:manage",
      disputeSettlement: "settlement:manage",
      timeoutSettlement: "settlement:manage",
    };
    const permission = permissions[method];
    if (!permission) throw new Error("COMMAND_AUTHORIZATION_UNAVAILABLE");
    return this.authorizer.require(input.actorId, permission);
  }

  verifyAsset({ actorId, idempotencyKey, asset, certificate, warehouse, evidenceSources = {}, evidenceAuthentication = null, evidenceVersion }) {
    this.authorizer.require(actorId, "asset:verify");
    assertAssetFactsOnly({ asset, certificate, warehouse });
    if (!asset?.assetId || certificate?.assetId !== asset.assetId || warehouse?.assetId !== asset.assetId) throw new Error("ASSET_EVIDENCE_ID_MISMATCH");
    if ((asset.currentCertificateHash !== undefined && asset.currentCertificateHash !== certificate.certificateHash) || (asset.currentCertificateVersion !== undefined && asset.currentCertificateVersion !== certificate.certificateVersion) || (asset.warehouseReceiptHash !== undefined && asset.warehouseReceiptHash !== warehouse.warehouseReceiptHash) || (certificate.warehouseReceiptHash !== undefined && certificate.warehouseReceiptHash !== warehouse.warehouseReceiptHash)) throw new Error("ASSET_EVIDENCE_BUNDLE_MISMATCH");
    this.runtime.schemaRegistry.validate("asset-record.v1", asset);
    this.runtime.schemaRegistry.validate("certificate-record.v1", certificate);
    this.runtime.schemaRegistry.validate("warehouse-record.v1", warehouse);
    if (certificate.status === "CURRENT" && certificate.supersededAt != null) throw new Error("CERTIFICATE_CURRENT_SUPERSEDED_AT_INVALID");
    if (!this.allowSyntheticEvidence) assertAuthenticatedEvidence(evidenceAuthentication, { records: { asset, certificate, warehouse }, evidenceSources });
    if (asset.oracleStatus !== OracleStatus.VALID || asset.transferEligibility !== OracleStatus.VALID || certificate.status !== "CURRENT" || warehouse.warehouseStatus !== "IN_CUSTODY" || asset.encumbranceStatus !== "CLEAR" || (warehouse.encumbranceStatus !== undefined && warehouse.encumbranceStatus !== "CLEAR")) throw new Error("ASSET_EVIDENCE_NOT_VALID");
    return this.commandJournal.execute(idempotencyKey, { type: "asset.verify", asset, certificate, warehouse, evidenceSources, evidenceVersion }, () => {
      const provenance = Object.freeze({
        REGISTRY: resolveEvidenceSource(this.runtime, "REGISTRY", evidenceSources.asset),
        CERTIFICATE_AUTHORITY: resolveEvidenceSource(this.runtime, "CERTIFICATE_AUTHORITY", evidenceSources.certificate),
        WAREHOUSE: resolveEvidenceSource(this.runtime, "WAREHOUSE", evidenceSources.warehouse),
      });
      this.runtime.recordStore.assertAsset(asset);
      this.runtime.recordStore.assertCertificate(certificate);
      this.runtime.recordStore.assertWarehouse(warehouse);
      this.runtime.stateEngine.assertTransition({ subjectId: asset.assetId, to: OracleStatus.VALID, evidenceVersion });
      const now = this.clock().toISOString();
      this.runtime.recordStore.putAsset(asset, provenance.REGISTRY);
      if (this.runtime.recordStore.currentCertificate(asset.assetId)) {
        this.runtime.recordStore.replaceCurrentCertificate(certificate, provenance.CERTIFICATE_AUTHORITY, certificate.effectiveAt);
      } else {
        this.runtime.recordStore.appendCertificate(certificate, provenance.CERTIFICATE_AUTHORITY);
      }
      this.runtime.recordStore.putWarehouse(warehouse, provenance.WAREHOUSE);
      this.runtime.stateEngine.transition({ subjectId: asset.assetId, to: OracleStatus.VALID, reasonHash: evidenceHash({ asset, certificate, warehouse }), evidenceVersion, occurredAt: now });
      const event = this.runtime.auditJournal.append({ type: "asset.verified", subjectId: asset.assetId, payloadHash: evidenceHash({ asset, certificate, warehouse }), actorId, occurredAt: now });
      this.outbox.enqueue({ eventType: "asset.verified", subjectId: asset.assetId, payloadHash: event.eventHash, createdAt: now });
      return Object.freeze({ assetId: asset.assetId, status: OracleStatus.VALID, evidenceVersion });
    });
  }

  issueAttestation({ actorId, idempotencyKey, request }) {
    this.authorizer.require(actorId, "attestation:issue");
    assertAssetFactsOnly(request);
    return this.commandJournal.execute(idempotencyKey, { type: "attestation.issue", request }, () => {
      if (this.runtime.stateEngine.current(request.subject.assetId) !== OracleStatus.VALID) throw new Error("ASSET_NOT_VALID_FOR_ATTESTATION");
      const binding = this.runtime.tokenIndex.byAsset(request.subject.assetId);
      if (!binding || binding.chainId !== request.subject.chainId || binding.contract !== request.subject.contract || binding.tokenId !== request.subject.tokenId) throw new Error("ATTESTATION_TOKEN_BINDING_MISMATCH");
      const source = this.runtime.sourceRegistry.listPublic().find(({ id }) => id === request.sourceAuthority);
      if (!source) throw new Error("SOURCE_NOT_REGISTERED");
      this.runtime.sourceRegistry.requireActive(source.id, source.schemaVersions[0]);
      const sourceRecord = source.kind === "REGISTRY"
        ? this.runtime.recordStore.getAsset(request.subject.assetId)
        : source.kind === "CERTIFICATE_AUTHORITY"
          ? this.runtime.recordStore.currentCertificate(request.subject.assetId)
          : this.runtime.recordStore.getWarehouse(request.subject.assetId);
      if (!sourceRecord) throw new Error("ATTESTATION_SOURCE_RECORD_NOT_FOUND");
      const provenance = this.runtime.recordStore.provenance(source.kind, request.subject.assetId);
      if (!provenance || provenance.sourceId !== source.id) throw new Error("ATTESTATION_SOURCE_AUTHORITY_MISMATCH");
      const expectedSourceHash = evidenceHash(sourceRecord);
      if (request.sourceRecordHash !== expectedSourceHash) throw new Error("ATTESTATION_SOURCE_RECORD_MISMATCH");
      const factBinding = FACT_BINDINGS[request.factType];
      if (!factBinding || factBinding.sourceKind !== source.kind || !Object.hasOwn(sourceRecord, factBinding.field) || !Object.is(request.factValue, sourceRecord[factBinding.field])) throw new Error("ATTESTATION_FACT_SOURCE_MISMATCH");
      const attestation = this.runtime.attestations.issue(request);
      const now = this.clock().toISOString();
      this.runtime.auditJournal.append({ type: "attestation.issued", subjectId: request.subject.assetId, payloadHash: attestation.envelopeHash, actorId, occurredAt: now });
      return attestation;
    });
  }

  bindToken({ actorId, idempotencyKey, binding }) {
    this.authorizer.require(actorId, "token:bind");
    if (this.runtime.stateEngine.current(binding.assetId) !== OracleStatus.VALID) throw new Error("ASSET_NOT_VALID_FOR_TOKEN_BINDING");
    return this.commandJournal.execute(idempotencyKey, { type: "token.bind", binding }, () => {
      const result = this.runtime.tokenIndex.bind(binding);
      const now = this.clock().toISOString();
      const payloadHash = evidenceHash(result);
      this.runtime.auditJournal.append({ type: "token.bound", subjectId: binding.assetId, payloadHash, actorId, occurredAt: now });
      this.outbox.enqueue({ eventType: "token.bound", subjectId: binding.assetId, payloadHash, createdAt: now });
      return result;
    });
  }

  exportAudit({ actorId, idempotencyKey, purpose, adminOperations }) {
    if (!adminOperations) throw new Error("ADMIN_OPERATIONS_DISABLED");
    adminOperations.authorizeExport(actorId, purpose);
    return this.commandJournal.execute(idempotencyKey, { type: "audit.export", actorId, purpose }, () => adminOperations.exportAudit(actorId, purpose));
  }

  requestRevocation({ actorId, actionId, attestationId, reasonHash, idempotencyKey = null }) {
    this.authorizer.require(actorId, "attestation:revoke");
    if (!SHA256_HEX.test(reasonHash ?? "")) throw new Error("REVOCATION_REASON_HASH_INVALID");
    const operation = () => {
      if (this.runtime.revocations.isRevoked(attestationId)) throw new Error("ATTESTATION_ALREADY_REVOKED");
      return this.dualControl.request({ actionId, actionType: "ATTESTATION_REVOKE", subjectId: attestationId, payloadHash: reasonHash, requestedBy: actorId, requestedAt: this.clock().toISOString() });
    };
    return idempotencyKey ? this.commandJournal.execute(idempotencyKey, { type: "attestation.revocation.request", actionId, attestationId, reasonHash }, operation) : operation();
  }

  approveAction({ actorId, actionId, idempotencyKey = null }) {
    this.authorizer.require(actorId, "action:approve");
    const operation = () => this.dualControl.approve(actionId, { approvedBy: actorId, approvedAt: this.clock().toISOString() });
    return idempotencyKey ? this.commandJournal.execute(idempotencyKey, { type: "controlled-action.approve", actionId }, operation) : operation();
  }

  requestSourceDisable({ actorId, actionId, sourceId, reasonHash, idempotencyKey = null }) {
    this.authorizer.require(actorId, "source:disable");
    if (!SHA256_HEX.test(reasonHash ?? "")) throw new Error("SOURCE_DISABLE_REASON_HASH_INVALID");
    const operation = () => {
      this.runtime.sourceRegistry.requireActive(sourceId, this.runtime.sourceRegistry.listPublic().find(({ id }) => id === sourceId)?.schemaVersions?.[0]);
      return this.dualControl.request({ actionId, actionType: "SOURCE_DISABLE", subjectId: sourceId, payloadHash: reasonHash, requestedBy: actorId, requestedAt: this.clock().toISOString() });
    };
    return idempotencyKey ? this.commandJournal.execute(idempotencyKey, { type: "source-disable.request", actionId, sourceId, reasonHash }, operation) : operation();
  }

  executeSourceDisable({ actorId, actionId, sourceId, reasonHash, idempotencyKey = null }) {
    this.authorizer.require(actorId, "source:disable");
    if (!SHA256_HEX.test(reasonHash ?? "")) throw new Error("SOURCE_DISABLE_REASON_HASH_INVALID");
    const operation = () => {
      const occurredAt = this.clock().toISOString();
      this.dualControl.beginExecution(actionId, { actionType: "SOURCE_DISABLE", subjectId: sourceId, payloadHash: reasonHash, executedBy: actorId, executionStartedAt: occurredAt });
      try {
        const source = this.runtime.sourceRegistry.setActive(sourceId, false);
        this.runtime.auditJournal.append({ type: "source.disabled", subjectId: sourceId, payloadHash: reasonHash, actorId, occurredAt });
        this.outbox.enqueue({ eventType: "source.disabled", subjectId: sourceId, payloadHash: reasonHash, createdAt: occurredAt });
        this.dualControl.completeExecution(actionId, occurredAt);
        return source;
      } catch (error) {
        this.dualControl.failExecution(actionId, { failedAt: this.clock().toISOString(), errorCode: controlledFailureCode(error, "SOURCE_DISABLE_FAILED") });
        throw error;
      }
    };
    return idempotencyKey ? this.commandJournal.execute(idempotencyKey, { type: "source-disable.execute", actionId, sourceId, reasonHash }, operation) : operation();
  }

  requestSignerRotation({ actorId, actionId, fromSignerSetId, toSignerSetId, rotationDigest, idempotencyKey = null }) {
    this.authorizer.require(actorId, "signer:rotate");
    const subjectId = signerRotationSubject(actionId, fromSignerSetId, toSignerSetId, rotationDigest);
    const operation = () => {
      if (this.runtime.attestations.signerSetId !== fromSignerSetId) throw new Error("SIGNER_ROTATION_SOURCE_NOT_ACTIVE");
      return this.dualControl.request({ actionId, actionType: "SIGNER_ROTATE", subjectId, payloadHash: rotationDigest, requestedBy: actorId, requestedAt: this.clock().toISOString() });
    };
    return idempotencyKey ? this.commandJournal.execute(idempotencyKey, { type: "signer-rotation.request", actionId, fromSignerSetId, toSignerSetId, rotationDigest }, operation) : operation();
  }

  async executeSignerRotation({ actorId, actionId, fromSignerSetId, toSignerSetId, rotationDigest, idempotencyKey = null }) {
    this.authorizer.require(actorId, "signer:rotate");
    const subjectId = signerRotationSubject(actionId, fromSignerSetId, toSignerSetId, rotationDigest);
    if (!this.signerRotationBroker?.rotate) throw new Error("SIGNER_ROTATION_BROKER_UNAVAILABLE");
    const operation = async () => {
      const runtimeSignerSetId = this.runtime.attestations.signerSetId;
      if (runtimeSignerSetId !== fromSignerSetId && runtimeSignerSetId !== toSignerSetId) throw new Error("SIGNER_ROTATION_RUNTIME_STATE_CONFLICT");
      const occurredAt = this.clock().toISOString();
      this.dualControl.beginExecution(actionId, { actionType: "SIGNER_ROTATE", subjectId, payloadHash: rotationDigest, executedBy: actorId, executionStartedAt: occurredAt });
      try {
      const result = assertRotationEvidence(await this.signerRotationBroker.rotate({ actionId, fromSignerSetId, toSignerSetId, rotationDigest }));
      await activateRuntimeSigner(this.signerRotationBroker, this.runtime.attestations, { actionId, fromSignerSetId, toSignerSetId, rotationDigest });
      this.runtime.auditJournal.append({ type: "signer.rotated", subjectId, payloadHash: rotationDigest, actorId, occurredAt });
      this.outbox.enqueue({ eventType: "signer.rotated", subjectId, payloadHash: rotationDigest, createdAt: occurredAt });
      this.dualControl.completeExecution(actionId, occurredAt);
      return Object.freeze({
      oldSignerRejected: true,
      newSignerAccepted: true,
      rotationAudited: true,
      auditChainVerified: true,
      dualApprovalVerified: true,
      timelockSeconds: result.timelockSeconds,
      rollbackWindowSeconds: result.rollbackWindowSeconds,
      rollbackVerified: true,
      privateMaterialObserved: false,
      networkUsed: false,
      transactionSigned: false,
      evidenceSha256: SHA256_HEX.test(result.evidenceSha256 ?? "") ? result.evidenceSha256.toLowerCase() : null,
      privateMaterialIncluded: false,
      });
      } catch (error) {
        this.runtime.operationalState.signerRecoveryRequired = true;
        this.dualControl.markRecoveryRequired(actionId, { failedAt: this.clock().toISOString(), errorCode: controlledFailureCode(error, "SIGNER_ROTATION_RECOVERY_REQUIRED") });
        throw error;
      }
    };
    return idempotencyKey ? this.commandJournal.execute(idempotencyKey, { type: "signer-rotation.execute", actionId, fromSignerSetId, toSignerSetId, rotationDigest }, operation) : operation();
  }

  async reconcileSignerRotation({ actorId, actionId, fromSignerSetId, toSignerSetId, rotationDigest, idempotencyKey = null }) {
    this.authorizer.require(actorId, "signer:rotate");
    const subjectId = signerRotationSubject(actionId, fromSignerSetId, toSignerSetId, rotationDigest);
    if (!this.signerRotationBroker?.reconcile) throw new Error("SIGNER_ROTATION_RECONCILER_UNAVAILABLE");
    const operation = async () => {
      const runtimeSignerSetId = this.runtime.attestations.signerSetId;
      if (runtimeSignerSetId !== fromSignerSetId && runtimeSignerSetId !== toSignerSetId) throw new Error("SIGNER_ROTATION_RUNTIME_STATE_CONFLICT");
      const occurredAt = this.clock().toISOString();
      this.dualControl.beginRecovery(actionId, { actionType: "SIGNER_ROTATE", subjectId, payloadHash: rotationDigest, executedBy: actorId, recoveryStartedAt: occurredAt });
      try {
      const reconciliation = await this.signerRotationBroker.reconcile({ actionId, fromSignerSetId, toSignerSetId, rotationDigest });
      if (reconciliation?.applied === false && reconciliation?.safelyNotApplied === true) {
        if (runtimeSignerSetId !== fromSignerSetId) throw new Error("SIGNER_ROTATION_RECONCILIATION_UNRESOLVED");
        this.runtime.operationalState.signerRecoveryRequired = false;
        this.dualControl.failExecution(actionId, { failedAt: this.clock().toISOString(), errorCode: "SIGNER_ROTATION_NOT_APPLIED" });
        return Object.freeze({ applied: false, safelyNotApplied: true, privateMaterialIncluded: false });
      }
      if (reconciliation?.applied !== true) throw new Error("SIGNER_ROTATION_RECONCILIATION_UNRESOLVED");
      const result = assertRotationEvidence(reconciliation);
      if (runtimeSignerSetId === fromSignerSetId) await activateRuntimeSigner(this.signerRotationBroker, this.runtime.attestations, { actionId, fromSignerSetId, toSignerSetId, rotationDigest });
      this.runtime.auditJournal.append({ type: "signer.rotated", subjectId, payloadHash: rotationDigest, actorId, occurredAt });
      this.outbox.enqueue({ eventType: "signer.rotated", subjectId, payloadHash: rotationDigest, createdAt: occurredAt });
      this.dualControl.completeExecution(actionId, occurredAt);
      this.runtime.operationalState.signerRecoveryRequired = false;
      return Object.freeze({ applied: true, oldSignerRejected: true, newSignerAccepted: true, rotationAudited: true, auditChainVerified: true, privateMaterialIncluded: false, evidenceSha256: SHA256_HEX.test(result.evidenceSha256 ?? "") ? result.evidenceSha256.toLowerCase() : null });
      } catch (error) {
        this.dualControl.markRecoveryRequired(actionId, { failedAt: this.clock().toISOString(), errorCode: controlledFailureCode(error, "SIGNER_ROTATION_RECOVERY_REQUIRED") });
        throw error;
      }
    };
    return idempotencyKey ? this.commandJournal.execute(idempotencyKey, { type: "signer-rotation.reconcile", actionId, fromSignerSetId, toSignerSetId, rotationDigest }, operation) : operation();
  }

  executeRevocation({ actorId, actionId, attestationId, reasonHash, idempotencyKey = null }) {
    this.authorizer.require(actorId, "attestation:revoke");
    if (!SHA256_HEX.test(reasonHash ?? "")) throw new Error("REVOCATION_REASON_HASH_INVALID");
    const operation = () => {
      if (this.runtime.revocations.isRevoked(attestationId)) throw new Error("ATTESTATION_ALREADY_REVOKED");
      const now = this.clock().toISOString();
      this.dualControl.beginExecution(actionId, { actionType: "ATTESTATION_REVOKE", subjectId: attestationId, payloadHash: reasonHash, executedBy: actorId, executionStartedAt: now });
      try {
      const attestation = this.runtime.attestations.get(attestationId);
      if (!attestation) throw new Error("ATTESTATION_NOT_FOUND");
      const revocation = this.runtime.revocations.revoke({ attestationId, reasonHash, revokedAt: now, authorityId: actorId });
      this.runtime.auditJournal.append({ type: "attestation.revoked", subjectId: attestation.envelope.subject.assetId, payloadHash: reasonHash, actorId, occurredAt: now });
      this.outbox.enqueue({ eventType: "attestation.revoked", subjectId: attestation.envelope.subject.assetId, payloadHash: reasonHash, createdAt: now });
      this.dualControl.completeExecution(actionId, now);
      return revocation;
      } catch (error) {
        this.dualControl.failExecution(actionId, { failedAt: this.clock().toISOString(), errorCode: controlledFailureCode(error, "ATTESTATION_REVOCATION_FAILED") });
        throw error;
      }
    };
    return idempotencyKey ? this.commandJournal.execute(idempotencyKey, { type: "attestation.revocation.execute", actionId, attestationId, reasonHash }, operation) : operation();
  }

  beginSettlement({ actorId, idempotencyKey, request }) {
    this.authorizer.require(actorId, "settlement:manage");
    return this.commandJournal.execute(idempotencyKey, { type: "settlement.begin", request }, () => {
      const result = this.runtime.settlements.begin({ ...request, actorId });
      this.outbox.enqueue({ eventType: "settlement.started", subjectId: result.assetId, payloadHash: result.snapshotHash, createdAt: result.startedAt });
      return result;
    });
  }

  finalizeSettlement({ actorId, idempotencyKey, request }) {
    this.authorizer.require(actorId, "settlement:manage");
    return this.commandJournal.execute(idempotencyKey, { type: "settlement.finalize", request }, () => {
      const certificateProvenance = resolveEvidenceSource(this.runtime, "CERTIFICATE_AUTHORITY", request.certificateSourceId);
      if (request.certificateSourceRecordHash !== evidenceHash(request.certificate)) throw new Error("SETTLEMENT_CERTIFICATE_SOURCE_RECORD_MISMATCH");
      if (!this.allowSyntheticEvidence) assertAuthenticatedEvidence(request.certificateAuthentication, { records: { certificate: request.certificate }, evidenceSources: { certificate: request.certificateSourceId } });
      this.runtime.schemaRegistry.validate("certificate-record.v1", request.certificate);
      if (request.certificate.status !== "CURRENT") throw new Error("SETTLEMENT_CERTIFICATE_NOT_CURRENT");
      const result = this.runtime.settlements.finalize({ ...request, certificateProvenance, actorId });
      this.outbox.enqueue({ eventType: "settlement.finalized", subjectId: result.assetId, payloadHash: request.certificate.certificateHash, createdAt: result.finalizedAt });
      return result;
    });
  }

  cancelSettlement({ actorId, idempotencyKey, request }) {
    this.authorizer.require(actorId, "settlement:manage");
    return this.commandJournal.execute(idempotencyKey, { type: "settlement.cancel", request }, () => {
      const result = this.runtime.settlements.cancel({ ...request, actorId });
      this.outbox.enqueue({ eventType: "settlement.cancelled", subjectId: result.assetId, payloadHash: request.reasonHash, createdAt: result.cancelledAt });
      this.outbox.enqueue({ eventType: "settlement.refund-required", subjectId: result.assetId, payloadHash: request.reasonHash, createdAt: result.cancelledAt });
      return result;
    });
  }

  disputeSettlement({ actorId, idempotencyKey, request }) {
    this.authorizer.require(actorId, "settlement:manage");
    return this.commandJournal.execute(idempotencyKey, { type: "settlement.dispute", request }, () => {
      const result = this.runtime.settlements.dispute({ ...request, actorId });
      this.#enqueueSettlementFailure(result, request.reasonHash, result.disputedAt, "settlement.disputed");
      return result;
    });
  }

  timeoutSettlement({ actorId, idempotencyKey, request }) {
    this.authorizer.require(actorId, "settlement:manage");
    return this.commandJournal.execute(idempotencyKey, { type: "settlement.timeout", request }, () => {
      const result = this.runtime.settlements.timeout({ ...request, actorId });
      this.#enqueueSettlementFailure(result, request.reasonHash, result.timedOutAt, "settlement.timed-out");
      return result;
    });
  }

  #enqueueSettlementFailure(result, reasonHash, createdAt, eventType) {
    this.outbox.enqueue({ eventType, subjectId: result.assetId, payloadHash: reasonHash, createdAt });
    this.outbox.enqueue({ eventType: "settlement.refund-required", subjectId: result.assetId, payloadHash: reasonHash, createdAt });
  }
}

