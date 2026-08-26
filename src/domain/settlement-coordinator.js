import { OracleStatus } from "./oracle-status.js";
import { evidenceHash } from "./canonical-json.js";

const SHA256_HEX = /^[a-f0-9]{64}$/i;

function assertFailureReason(reasonHash) {
  if (!SHA256_HEX.test(reasonHash ?? "")) throw new Error("SETTLEMENT_REASON_HASH_INVALID");
}

export class SettlementCoordinator {
  #settlements = new Map();
  #intentHashes = new Map();

  constructor({ recordStore, stateEngine, auditJournal, tokenIndex = null, attestations = null, businessCalendar = null, settlementProfile = null, clock = () => new Date() }) {
    this.recordStore = recordStore;
    this.stateEngine = stateEngine;
    this.auditJournal = auditJournal;
    this.tokenIndex = tokenIndex;
    this.attestations = attestations;
    this.businessCalendar = businessCalendar;
    this.settlementProfile = settlementProfile;
    this.clock = clock;
  }

  begin(request) {
    if (Object.hasOwn(request ?? {}, "snapshotHash") || Object.hasOwn(request ?? {}, "t0SnapshotHash")) {
      throw new Error("SETTLEMENT_CALLER_SNAPSHOT_REFUSED");
    }
    if (Object.hasOwn(request ?? {}, "deadlineAt")) throw new Error("SETTLEMENT_CALLER_DEADLINE_REFUSED");
    const { settlementId, assetId, token, sellerWallet, buyerWallet, externalExecutionRef, oldCertificateHash, warehouseReceiptHash, actorId, evidenceVersion } = request ?? {};
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
    const targetBusinessDays = this.settlementProfile?.targetBusinessDays;
    if (!this.businessCalendar || !Number.isInteger(targetBusinessDays) || targetBusinessDays < 1 || !this.settlementProfile?.businessCalendarRef) throw new Error("SETTLEMENT_CALENDAR_PROFILE_REQUIRED");
    const deadline = this.businessCalendar.addBusinessDays(now, targetBusinessDays);
    if (![settlementId, actorId].every((value) => typeof value === "string" && value)) throw new Error("SETTLEMENT_SNAPSHOT_INCOMPLETE");
    const normalizedDeadlineAt = deadline.toISOString();
    const intent = Object.freeze({
      schemaVersion: "giraffe-settlement-intent.v1",
      settlementId,
      assetId,
      token: Object.freeze({ chainId: token.chainId, contract: token.contract, tokenId: token.tokenId }),
      sellerWallet,
      buyerWallet,
      externalExecutionRef,
      oldCertificateHash,
      warehouseReceiptHash,
      deadlineAt: normalizedDeadlineAt,
      businessCalendarRef: this.settlementProfile?.businessCalendarRef ?? null,
      targetBusinessDays: targetBusinessDays ?? null,
    });
    const intentHash = evidenceHash(intent);
    const existing = this.#settlements.get(settlementId);
    if (existing) {
      if (this.#intentHashes.get(settlementId) !== intentHash) throw new Error("SETTLEMENT_IDEMPOTENCY_CONFLICT");
      return existing;
    }
    const snapshotHash = evidenceHash({ ...intent, schemaVersion: "giraffe-settlement-snapshot.v1", observedAt: now.toISOString() });
    this.stateEngine.assertTransition({ subjectId: assetId, to: OracleStatus.TRANSFER_PENDING, evidenceVersion });
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
    const record = Object.freeze({ settlementId, assetId, token: Object.freeze({ ...token }), sellerWallet, buyerWallet, externalExecutionRef, snapshotHash, oldCertificateHash, warehouseReceiptHash, deadlineAt: normalizedDeadlineAt, businessCalendarRef: this.settlementProfile?.businessCalendarRef ?? null, targetBusinessDays: targetBusinessDays ?? null, status: "PENDING", startedAt: now.toISOString() });
    this.#settlements.set(settlementId, record);
    this.#intentHashes.set(settlementId, intentHash);
    this.auditJournal.append({ type: "settlement.started", subjectId: assetId, payloadHash: snapshotHash, actorId, occurredAt: now.toISOString() });
    return record;
  }

  finalize({ settlementId, certificate, registryChangeRef, snapshotHash, warehouseConfirmed, ownerBindingConfirmed, actorId, evidenceVersion }) {
    const current = this.#settlements.get(settlementId);
    if (!current || current.status !== "PENDING") throw new Error("SETTLEMENT_NOT_PENDING");
    if (!registryChangeRef || warehouseConfirmed !== true || ownerBindingConfirmed !== true) throw new Error("SETTLEMENT_CONFIRMATION_INCOMPLETE");
    if (certificate?.wenbaoChangeRef !== registryChangeRef || certificate?.warehouseReceiptHash !== current.warehouseReceiptHash) {
      throw new Error("SETTLEMENT_CERTIFICATE_EVIDENCE_MISMATCH");
    }
    if (certificate?.assetId !== current.assetId) throw new Error("SETTLEMENT_CERTIFICATE_ASSET_MISMATCH");
    if (certificate?.tokenId !== current.token.tokenId) throw new Error("SETTLEMENT_CERTIFICATE_TOKEN_MISMATCH");
    if (snapshotHash !== current.snapshotHash) throw new Error("SETTLEMENT_SNAPSHOT_EVIDENCE_MISMATCH");
    if (this.clock() > new Date(current.deadlineAt)) throw new Error("SETTLEMENT_DEADLINE_EXCEEDED");
    this.stateEngine.assertTransition({ subjectId: current.assetId, to: OracleStatus.VALID, evidenceVersion });
    this.recordStore.assertCertificate(certificate);
    this.recordStore.appendCertificate(certificate);
    const now = this.clock().toISOString();
    this.stateEngine.transition({ subjectId: current.assetId, to: OracleStatus.VALID, reasonHash: certificate.certificateHash, evidenceVersion, occurredAt: now });
    const finalized = Object.freeze({ ...current, status: "FINALIZED", registryChangeRef, newCertificateHash: certificate.certificateHash, finalizedAt: now });
    this.#settlements.set(settlementId, finalized);
    this.auditJournal.append({ type: "settlement.finalized", subjectId: current.assetId, payloadHash: certificate.certificateHash, actorId, occurredAt: now });
    return finalized;
  }

  cancel({ settlementId, reasonHash, actorId, evidenceVersion }) {
    assertFailureReason(reasonHash);
    const current = this.#settlements.get(settlementId);
    if (!current || current.status !== "PENDING") throw new Error("SETTLEMENT_NOT_PENDING");
    const now = this.clock().toISOString();
    this.stateEngine.transition({ subjectId: current.assetId, to: OracleStatus.REVIEW_REQUIRED, reasonHash, evidenceVersion, occurredAt: now });
    const cancelled = Object.freeze({ ...current, status: "CANCELLED", failureReasonHash: reasonHash, cancelledAt: now });
    this.#settlements.set(settlementId, cancelled);
    this.auditJournal.append({ type: "settlement.cancelled", subjectId: current.assetId, payloadHash: reasonHash, actorId, occurredAt: now });
    return cancelled;
  }

  dispute({ settlementId, reasonHash, actorId, evidenceVersion }) {
    assertFailureReason(reasonHash);
    const current = this.#settlements.get(settlementId);
    if (!current || current.status !== "PENDING") throw new Error("SETTLEMENT_NOT_PENDING");
    const now = this.clock().toISOString();
    this.stateEngine.transition({ subjectId: current.assetId, to: OracleStatus.REVIEW_REQUIRED, reasonHash, evidenceVersion, occurredAt: now });
    const disputed = Object.freeze({ ...current, status: "DISPUTED", failureReasonHash: reasonHash, disputedAt: now });
    this.#settlements.set(settlementId, disputed);
    this.auditJournal.append({ type: "settlement.disputed", subjectId: current.assetId, payloadHash: reasonHash, actorId, occurredAt: now });
    return disputed;
  }

  timeout({ settlementId, reasonHash, actorId, evidenceVersion }) {
    assertFailureReason(reasonHash);
    const current = this.#settlements.get(settlementId);
    if (!current || current.status !== "PENDING") throw new Error("SETTLEMENT_NOT_PENDING");
    if (this.clock() <= new Date(current.deadlineAt)) throw new Error("SETTLEMENT_DEADLINE_NOT_REACHED");
    const now = this.clock().toISOString();
    this.stateEngine.transition({ subjectId: current.assetId, to: OracleStatus.REVIEW_REQUIRED, reasonHash, evidenceVersion, occurredAt: now });
    const timedOut = Object.freeze({ ...current, status: "TIMED_OUT", failureReasonHash: reasonHash, timedOutAt: now });
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
