import { evidenceHash } from "../domain/canonical-json.js";
import { OracleStatus } from "../domain/oracle-status.js";
import { assertAssetFactsOnly } from "./product-boundary.js";

const SHA256_HEX = /^[a-f0-9]{64}$/i;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function controlledFailureCode(error, fallback) {
  const candidate = typeof error?.code === "string" ? error.code : error?.message;
  return SAFE_ERROR_CODE.test(candidate ?? "") ? candidate : fallback;
}

function assertRotationEvidence(result) {
  if (result?.oldSignerRejected !== true || result?.newSignerAccepted !== true || result?.rotationAudited !== true || result?.auditChainVerified !== true || result?.dualApprovalVerified !== true || result?.rollbackVerified !== true || result?.rollbackWindowSeconds < 3600 || result?.timelockSeconds < 300 || result?.privateMaterialObserved !== false || result?.networkUsed !== false || result?.transactionSigned !== false) throw new Error("SIGNER_ROTATION_BROKER_RESULT_INVALID");
  return result;
}

export class OracleControlPlane {
  constructor({ runtime, authorizer, dualControl, commandJournal, outbox, signerRotationBroker = null, clock = () => new Date() }) {
    Object.assign(this, { runtime, authorizer, dualControl, commandJournal, outbox, signerRotationBroker, clock });
  }

  verifyAsset({ actorId, idempotencyKey, asset, certificate, warehouse, evidenceVersion }) {
    this.authorizer.require(actorId, "asset:verify");
    assertAssetFactsOnly({ asset, certificate, warehouse });
    return this.commandJournal.execute(idempotencyKey, { type: "asset.verify", asset, certificate, warehouse, evidenceVersion }, () => {
      this.runtime.recordStore.assertAsset(asset);
      this.runtime.recordStore.assertCertificate(certificate);
      this.runtime.recordStore.assertWarehouse(warehouse);
      this.runtime.stateEngine.assertTransition({ subjectId: asset.assetId, to: OracleStatus.VALID, evidenceVersion });
      this.runtime.recordStore.putAsset(asset);
      this.runtime.recordStore.appendCertificate(certificate);
      this.runtime.recordStore.putWarehouse(warehouse);
      const now = this.clock().toISOString();
      this.runtime.stateEngine.transition({ subjectId: asset.assetId, to: OracleStatus.VALID, reasonHash: evidenceHash({ asset, certificate, warehouse }), evidenceVersion, occurredAt: now });
      const event = this.runtime.auditJournal.append({ type: "asset.verified", subjectId: asset.assetId, payloadHash: evidenceHash({ asset, certificate, warehouse }), actorId, occurredAt: now });
      this.outbox.enqueue({ eventType: "asset.verified", subjectId: asset.assetId, payloadHash: event.eventHash, createdAt: now });
      return Object.freeze({ assetId: asset.assetId, status: OracleStatus.VALID, evidenceVersion });
    });
  }

  issueAttestation({ actorId, idempotencyKey, request }) {
    this.authorizer.require(actorId, "attestation:issue");
    assertAssetFactsOnly(request);
    if (this.runtime.stateEngine.current(request.subject.assetId) !== OracleStatus.VALID) throw new Error("ASSET_NOT_VALID_FOR_ATTESTATION");
    return this.commandJournal.execute(idempotencyKey, { type: "attestation.issue", request }, () => {
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

  requestRevocation({ actorId, actionId, attestationId, reasonHash, idempotencyKey = null }) {
    this.authorizer.require(actorId, "attestation:revoke");
    if (!SHA256_HEX.test(reasonHash ?? "")) throw new Error("REVOCATION_REASON_HASH_INVALID");
    const operation = () => {
      if (this.runtime.revocations.isRevoked(attestationId)) throw new Error("ATTESTATION_ALREADY_REVOKED");
      return this.dualControl.request({ actionId, actionType: "ATTESTATION_REVOKE", subjectId: attestationId, payloadHash: reasonHash, requestedBy: actorId, requestedAt: this.clock().toISOString() });
    };
    return idempotencyKey ? this.commandJournal.execute(idempotencyKey, { type: "attestation.revocation.request", actionId, attestationId, reasonHash }, operation) : operation();
  }

  approveAction({ actorId, actionId }) {
    this.authorizer.require(actorId, "action:approve");
    return this.dualControl.approve(actionId, { approvedBy: actorId, approvedAt: this.clock().toISOString() });
  }

  requestSourceDisable({ actorId, actionId, sourceId, reasonHash }) {
    this.authorizer.require(actorId, "source:disable");
    if (!SHA256_HEX.test(reasonHash ?? "")) throw new Error("SOURCE_DISABLE_REASON_HASH_INVALID");
    this.runtime.sourceRegistry.requireActive(sourceId, this.runtime.sourceRegistry.listPublic().find(({ id }) => id === sourceId)?.schemaVersions?.[0]);
    return this.dualControl.request({ actionId, actionType: "SOURCE_DISABLE", subjectId: sourceId, payloadHash: reasonHash, requestedBy: actorId, requestedAt: this.clock().toISOString() });
  }

  executeSourceDisable({ actorId, actionId, sourceId, reasonHash }) {
    this.authorizer.require(actorId, "source:disable");
    if (!SHA256_HEX.test(reasonHash ?? "")) throw new Error("SOURCE_DISABLE_REASON_HASH_INVALID");
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
  }

  requestSignerRotation({ actorId, actionId, fromSignerSetId, toSignerSetId, rotationDigest }) {
    this.authorizer.require(actorId, "signer:rotate");
    if (![actionId, fromSignerSetId, toSignerSetId].every((value) => typeof value === "string" && value) || fromSignerSetId === toSignerSetId || !SHA256_HEX.test(rotationDigest ?? "")) throw new Error("SIGNER_ROTATION_REQUEST_INVALID");
    return this.dualControl.request({ actionId, actionType: "SIGNER_ROTATE", subjectId: `${fromSignerSetId}->${toSignerSetId}`, payloadHash: rotationDigest, requestedBy: actorId, requestedAt: this.clock().toISOString() });
  }

  async executeSignerRotation({ actorId, actionId, fromSignerSetId, toSignerSetId, rotationDigest }) {
    this.authorizer.require(actorId, "signer:rotate");
    if (![actionId, fromSignerSetId, toSignerSetId].every((value) => typeof value === "string" && value) || fromSignerSetId === toSignerSetId || !SHA256_HEX.test(rotationDigest ?? "")) throw new Error("SIGNER_ROTATION_REQUEST_INVALID");
    if (!this.signerRotationBroker?.rotate) throw new Error("SIGNER_ROTATION_BROKER_UNAVAILABLE");
    const subjectId = `${fromSignerSetId}->${toSignerSetId}`;
    const occurredAt = this.clock().toISOString();
    this.dualControl.beginExecution(actionId, { actionType: "SIGNER_ROTATE", subjectId, payloadHash: rotationDigest, executedBy: actorId, executionStartedAt: occurredAt });
    try {
      const result = assertRotationEvidence(await this.signerRotationBroker.rotate({ actionId, fromSignerSetId, toSignerSetId, rotationDigest }));
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
      this.dualControl.markRecoveryRequired(actionId, { failedAt: this.clock().toISOString(), errorCode: controlledFailureCode(error, "SIGNER_ROTATION_RECOVERY_REQUIRED") });
      throw error;
    }
  }

  async reconcileSignerRotation({ actorId, actionId, fromSignerSetId, toSignerSetId, rotationDigest }) {
    this.authorizer.require(actorId, "signer:rotate");
    if (![actionId, fromSignerSetId, toSignerSetId].every((value) => typeof value === "string" && value) || fromSignerSetId === toSignerSetId || !SHA256_HEX.test(rotationDigest ?? "")) throw new Error("SIGNER_ROTATION_REQUEST_INVALID");
    if (!this.signerRotationBroker?.reconcile) throw new Error("SIGNER_ROTATION_RECONCILER_UNAVAILABLE");
    const subjectId = `${fromSignerSetId}->${toSignerSetId}`;
    const occurredAt = this.clock().toISOString();
    this.dualControl.beginRecovery(actionId, { actionType: "SIGNER_ROTATE", subjectId, payloadHash: rotationDigest, executedBy: actorId, recoveryStartedAt: occurredAt });
    try {
      const reconciliation = await this.signerRotationBroker.reconcile({ actionId, fromSignerSetId, toSignerSetId, rotationDigest });
      if (reconciliation?.applied === false && reconciliation?.safelyNotApplied === true) {
        this.dualControl.failExecution(actionId, { failedAt: this.clock().toISOString(), errorCode: "SIGNER_ROTATION_NOT_APPLIED" });
        return Object.freeze({ applied: false, safelyNotApplied: true, privateMaterialIncluded: false });
      }
      const result = assertRotationEvidence(reconciliation);
      this.runtime.auditJournal.append({ type: "signer.rotated", subjectId, payloadHash: rotationDigest, actorId, occurredAt });
      this.outbox.enqueue({ eventType: "signer.rotated", subjectId, payloadHash: rotationDigest, createdAt: occurredAt });
      this.dualControl.completeExecution(actionId, occurredAt);
      return Object.freeze({ applied: true, oldSignerRejected: true, newSignerAccepted: true, rotationAudited: true, auditChainVerified: true, privateMaterialIncluded: false, evidenceSha256: SHA256_HEX.test(result.evidenceSha256 ?? "") ? result.evidenceSha256.toLowerCase() : null });
    } catch (error) {
      this.dualControl.markRecoveryRequired(actionId, { failedAt: this.clock().toISOString(), errorCode: controlledFailureCode(error, "SIGNER_ROTATION_RECOVERY_REQUIRED") });
      throw error;
    }
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
      const result = this.runtime.settlements.finalize({ ...request, actorId });
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
