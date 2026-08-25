import { OracleStatus } from "./oracle-status.js";

export class SettlementCoordinator {
  #settlements = new Map();

  constructor({ recordStore, stateEngine, auditJournal, tokenIndex = null, attestations = null, clock = () => new Date() }) {
    this.recordStore = recordStore;
    this.stateEngine = stateEngine;
    this.auditJournal = auditJournal;
    this.tokenIndex = tokenIndex;
    this.attestations = attestations;
    this.clock = clock;
  }

  begin({ settlementId, assetId, token, sellerWallet, buyerWallet, externalExecutionRef, snapshotHash, oldCertificateHash, warehouseReceiptHash, deadlineAt, actorId, evidenceVersion }) {
    if (this.#settlements.has(settlementId)) return this.#settlements.get(settlementId);
    const certificate = this.recordStore.currentCertificate(assetId);
    const warehouse = this.recordStore.getWarehouse(assetId);
    if (!this.recordStore.getAsset(assetId) || !certificate || !warehouse) {
      throw new Error("SETTLEMENT_EVIDENCE_INCOMPLETE");
    }
    if (!token?.chainId || !token.contract || !token.tokenId || !sellerWallet || !buyerWallet || !externalExecutionRef) {
      throw new Error("SETTLEMENT_SNAPSHOT_INCOMPLETE");
    }
    const binding = this.tokenIndex?.byToken(token.chainId, token.contract, token.tokenId);
    if (!binding || binding.assetId !== assetId) throw new Error("SETTLEMENT_TOKEN_BINDING_INVALID");
    if (oldCertificateHash !== certificate.certificateHash || warehouseReceiptHash !== warehouse.warehouseReceiptHash) {
      throw new Error("SETTLEMENT_SNAPSHOT_CONFLICT");
    }
    const now = this.clock();
    const deadline = new Date(deadlineAt);
    if (!Number.isFinite(deadline.getTime()) || deadline <= now) throw new Error("SETTLEMENT_DEADLINE_INVALID");
    this.stateEngine.assertTransition({ subjectId: assetId, to: OracleStatus.TRANSFER_PENDING, evidenceVersion });
    if (![snapshotHash, actorId].every((value) => typeof value === "string" && value)) throw new Error("SETTLEMENT_SNAPSHOT_INCOMPLETE");
    this.stateEngine.transition({
      subjectId: assetId,
      to: OracleStatus.TRANSFER_PENDING,
      reasonHash: snapshotHash,
      evidenceVersion,
      occurredAt: now.toISOString(),
    });
    this.attestations?.revokeBySubject({
      assetId,
      purpose: "transfer-eligibility",
      reasonHash: snapshotHash,
      revokedAt: now.toISOString(),
      authorityId: actorId,
    });
    const record = Object.freeze({ settlementId, assetId, token: Object.freeze({ ...token }), sellerWallet, buyerWallet, externalExecutionRef, snapshotHash, oldCertificateHash, warehouseReceiptHash, deadlineAt, status: "PENDING", startedAt: now.toISOString() });
    this.#settlements.set(settlementId, record);
    this.auditJournal.append({ type: "settlement.started", subjectId: assetId, payloadHash: snapshotHash, actorId, occurredAt: now.toISOString() });
    return record;
  }

  finalize({ settlementId, certificate, registryChangeRef, warehouseConfirmed, ownerBindingConfirmed, actorId, evidenceVersion }) {
    const current = this.#settlements.get(settlementId);
    if (!current || current.status !== "PENDING") throw new Error("SETTLEMENT_NOT_PENDING");
    if (!registryChangeRef || warehouseConfirmed !== true || ownerBindingConfirmed !== true) throw new Error("SETTLEMENT_CONFIRMATION_INCOMPLETE");
    if (certificate?.wenbaoChangeRef !== registryChangeRef || certificate?.warehouseReceiptHash !== current.warehouseReceiptHash) {
      throw new Error("SETTLEMENT_CERTIFICATE_EVIDENCE_MISMATCH");
    }
    if (certificate?.assetId !== current.assetId) throw new Error("SETTLEMENT_CERTIFICATE_ASSET_MISMATCH");
    if (this.clock() > new Date(current.deadlineAt)) throw new Error("SETTLEMENT_DEADLINE_EXCEEDED");
    this.stateEngine.assertTransition({ subjectId: current.assetId, to: OracleStatus.VALID, evidenceVersion });
    this.recordStore.assertCertificate(certificate);
    this.recordStore.appendCertificate(certificate);
    const now = this.clock().toISOString();
    this.stateEngine.transition({ subjectId: current.assetId, to: OracleStatus.VALID, reasonHash: certificate.certificateHash, evidenceVersion, occurredAt: now });
    const finalized = Object.freeze({ ...current, status: "FINALIZED", registryChangeRef, finalizedAt: now });
    this.#settlements.set(settlementId, finalized);
    this.auditJournal.append({ type: "settlement.finalized", subjectId: current.assetId, payloadHash: certificate.certificateHash, actorId, occurredAt: now });
    return finalized;
  }

  cancel({ settlementId, reasonHash, actorId, evidenceVersion }) {
    const current = this.#settlements.get(settlementId);
    if (!current || current.status !== "PENDING") throw new Error("SETTLEMENT_NOT_PENDING");
    const now = this.clock().toISOString();
    this.stateEngine.transition({ subjectId: current.assetId, to: OracleStatus.REVIEW_REQUIRED, reasonHash, evidenceVersion, occurredAt: now });
    const cancelled = Object.freeze({ ...current, status: "CANCELLED", reasonHash, cancelledAt: now });
    this.#settlements.set(settlementId, cancelled);
    this.auditJournal.append({ type: "settlement.cancelled", subjectId: current.assetId, payloadHash: reasonHash, actorId, occurredAt: now });
    return cancelled;
  }

  dispute({ settlementId, reasonHash, actorId, evidenceVersion }) {
    const current = this.#settlements.get(settlementId);
    if (!current || current.status !== "PENDING") throw new Error("SETTLEMENT_NOT_PENDING");
    const now = this.clock().toISOString();
    this.stateEngine.transition({ subjectId: current.assetId, to: OracleStatus.REVIEW_REQUIRED, reasonHash, evidenceVersion, occurredAt: now });
    const disputed = Object.freeze({ ...current, status: "DISPUTED", reasonHash, disputedAt: now });
    this.#settlements.set(settlementId, disputed);
    this.auditJournal.append({ type: "settlement.disputed", subjectId: current.assetId, payloadHash: reasonHash, actorId, occurredAt: now });
    return disputed;
  }

  timeout({ settlementId, reasonHash, actorId, evidenceVersion }) {
    const current = this.#settlements.get(settlementId);
    if (!current || current.status !== "PENDING") throw new Error("SETTLEMENT_NOT_PENDING");
    if (this.clock() <= new Date(current.deadlineAt)) throw new Error("SETTLEMENT_DEADLINE_NOT_REACHED");
    const now = this.clock().toISOString();
    this.stateEngine.transition({ subjectId: current.assetId, to: OracleStatus.REVIEW_REQUIRED, reasonHash, evidenceVersion, occurredAt: now });
    const timedOut = Object.freeze({ ...current, status: "TIMED_OUT", reasonHash, timedOutAt: now });
    this.#settlements.set(settlementId, timedOut);
    this.auditJournal.append({ type: "settlement.timed-out", subjectId: current.assetId, payloadHash: reasonHash, actorId, occurredAt: now });
    return timedOut;
  }

  get(settlementId) {
    return this.#settlements.get(settlementId) ?? null;
  }

  byAsset(assetId) {
    return [...this.#settlements.values()].reverse().find((record) => record.assetId === assetId) ?? null;
  }
}
