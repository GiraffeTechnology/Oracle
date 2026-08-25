import { evidenceHash } from "../domain/canonical-json.js";
import { OracleStatus } from "../domain/oracle-status.js";
import { assertAssetFactsOnly } from "./product-boundary.js";

export class OracleControlPlane {
  constructor({ runtime, authorizer, dualControl, commandJournal, outbox, clock = () => new Date() }) {
    Object.assign(this, { runtime, authorizer, dualControl, commandJournal, outbox, clock });
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

  requestRevocation({ actorId, actionId, attestationId, reasonHash }) {
    this.authorizer.require(actorId, "attestation:revoke");
    return this.dualControl.request({ actionId, actionType: "ATTESTATION_REVOKE", subjectId: attestationId, payloadHash: reasonHash, requestedBy: actorId, requestedAt: this.clock().toISOString() });
  }

  approveAction({ actorId, actionId }) {
    this.authorizer.require(actorId, "action:approve");
    return this.dualControl.approve(actionId, { approvedBy: actorId, approvedAt: this.clock().toISOString() });
  }

  executeRevocation({ actorId, actionId, attestationId, reasonHash }) {
    this.authorizer.require(actorId, "attestation:revoke");
    this.dualControl.requireApproved(actionId, "ATTESTATION_REVOKE", attestationId, reasonHash);
    const attestation = this.runtime.attestations.get(attestationId);
    if (!attestation) throw new Error("ATTESTATION_NOT_FOUND");
    const now = this.clock().toISOString();
    const revocation = this.runtime.revocations.revoke({ attestationId, reasonHash, revokedAt: now, authorityId: actorId });
    this.runtime.auditJournal.append({ type: "attestation.revoked", subjectId: attestation.envelope.subject.assetId, payloadHash: reasonHash, actorId, occurredAt: now });
    this.outbox.enqueue({ eventType: "attestation.revoked", subjectId: attestation.envelope.subject.assetId, payloadHash: reasonHash, createdAt: now });
    return revocation;
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
