export const ConsumerStatus = Object.freeze({
  DRAFT: "DRAFT",
  VERIFIED: "VERIFIED",
  ACTIVE: "ACTIVE",
  TRANSFER_PENDING: "TRANSFER_PENDING",
  SETTLED: "SETTLED",
  FROZEN: "FROZEN",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  REVOKED: "REVOKED",
  REDEEMED: "REDEEMED",
});

const TRANSITIONS = Object.freeze({
  DRAFT: new Set(["VERIFIED", "REVIEW_REQUIRED"]),
  VERIFIED: new Set(["ACTIVE", "FROZEN", "REVIEW_REQUIRED", "REVOKED"]),
  ACTIVE: new Set(["TRANSFER_PENDING", "FROZEN", "REVIEW_REQUIRED", "REVOKED", "REDEEMED"]),
  TRANSFER_PENDING: new Set(["SETTLED", "ACTIVE", "FROZEN", "REVIEW_REQUIRED", "REVOKED"]),
  SETTLED: new Set(["ACTIVE", "FROZEN", "REVIEW_REQUIRED", "REVOKED"]),
  FROZEN: new Set(["REVIEW_REQUIRED", "REVOKED"]),
  REVIEW_REQUIRED: new Set(["VERIFIED", "FROZEN", "REVOKED"]),
  REVOKED: new Set(),
  REDEEMED: new Set(),
});

/**
 * D-008 classifies rights by whether the exercise can be undone, not by whether a settlement
 * happens to be in flight.
 *
 * An ungated operation is one the register can still correct after the fact: the token moves,
 * and whoever the register confirms for a past instant is who the right resolves to. A
 * perishable one cannot be corrected — delivery has happened, the token is burnt, the vote is
 * counted — so it must wait until the instant it relies on can no longer change.
 *
 * Pledging counts as perishable even though a pledge can be released: it binds the asset to a
 * third party's claim during a period when the register has not said who owns it, which is the
 * harm, not the irreversibility of the bookkeeping.
 */
export const RightClass = Object.freeze({ UNGATED: "UNGATED", PERISHABLE: "PERISHABLE" });

const OPERATION_CLASS = Object.freeze({
  transfer: RightClass.UNGATED,
  relist: RightClass.UNGATED,
  redeem: RightClass.PERISHABLE,
  pledge: RightClass.PERISHABLE,
});

/**
 * Statuses in which the token exists and is not halted. TRANSFER_PENDING is here: under D-008 a
 * settlement in flight no longer blocks ordinary transfer. FROZEN, REVIEW_REQUIRED and REVOKED
 * are not: those are ORACLE-004's emergency freeze, which answers an authority-status failure
 * rather than a settlement, and D-008 deliberately leaves it alone.
 */
const LIVE_STATUSES = new Set([
  ConsumerStatus.ACTIVE,
  ConsumerStatus.TRANSFER_PENDING,
  ConsumerStatus.SETTLED,
]);

export class SyntheticConsumerStateMachine {
  #state = new Map();
  #history = [];
  /** tokenRef -> { openedAt } while a registry change is in flight, absent once closed. */
  #gaps = new Map();
  /** tokenRef -> [{ effectiveAt, holder }], append-only, effectiveAt strictly increasing. */
  #entries = new Map();

  current(tokenRef) {
    return this.#state.get(tokenRef) ?? ConsumerStatus.DRAFT;
  }

  /** Number of registry changes still in flight for this token: 0 or 1 in this model. */
  openGapOf(tokenRef) {
    return this.#gaps.has(tokenRef) ? 1 : 0;
  }

  openGap(tokenRef, { openedAt }) {
    if (!Number.isFinite(openedAt)) throw new Error("CONSUMER_GAP_INSTANT_INVALID");
    if (this.#gaps.has(tokenRef)) return this.#gaps.get(tokenRef);
    const gap = Object.freeze({ openedAt });
    this.#gaps.set(tokenRef, gap);
    return gap;
  }

  /**
   * Admitting the register's answer: append the entry and close the gap. The entry's
   * effectiveAt closes the previous interval, so instants inside it become final.
   */
  closeGap(tokenRef, { effectiveAt, holder }) {
    if (!Number.isFinite(effectiveAt) || !holder) throw new Error("CONSUMER_ENTRY_INVALID");
    const entries = this.#entries.get(tokenRef) ?? [];
    const last = entries.at(-1);
    if (last && effectiveAt <= last.effectiveAt) throw new Error("CONSUMER_ENTRY_NOT_INCREASING");
    entries.push(Object.freeze({ effectiveAt, holder }));
    this.#entries.set(tokenRef, entries);
    this.#gaps.delete(tokenRef);
    return entries.at(-1);
  }

  /**
   * CONSUMER-006: cancelling a gap admits nothing. The gap closes so the token is not stuck,
   * but no entry is appended, so every instant the gap covered stays NOT final. Treating
   * cancellation as a determination is the mistake this method exists to prevent.
   */
  cancelGap(tokenRef) {
    return this.#gaps.delete(tokenRef);
  }

  /** The holder the register confirms for an instant, or null while none is confirmed. */
  holderAsOf(tokenRef, instant) {
    const entries = this.#entries.get(tokenRef) ?? [];
    let confirmed = null;
    for (const entry of entries) {
      if (entry.effectiveAt <= instant) confirmed = entry.holder;
      else break;
    }
    return confirmed;
  }

  /**
   * An instant is final when no later entry could still change its answer: some admitted entry
   * already takes effect after it, and no gap is open that could admit one at or before it.
   */
  isFinalAsOf(tokenRef, instant) {
    const gap = this.#gaps.get(tokenRef);
    if (gap !== undefined && gap.openedAt <= instant) return false;
    const entries = this.#entries.get(tokenRef) ?? [];
    return entries.some((entry) => entry.effectiveAt > instant);
  }

  /**
   * D-008: `transfer` is never refused for a settlement in flight — the ERC this project is
   * submitting states that ordinary ERC-721 transfers MUST NOT be blocked while a projection
   * gap is open. What a pending settlement refuses is the perishable exercise, and it refuses
   * that exercise only, never the token's transferability.
   */
  assertOperationAllowed(tokenRef, operation, { instant } = {}) {
    const rightClass = OPERATION_CLASS[operation];
    if (rightClass === undefined) throw new Error("CONSUMER_OPERATION_INVALID");

    const status = this.current(tokenRef);
    if (!LIVE_STATUSES.has(status)) {
      throw new Error(`CONSUMER_OPERATION_BLOCKED:${status}:${operation}`);
    }
    if (rightClass === RightClass.UNGATED) return true;

    if (!Number.isFinite(instant)) throw new Error("CONSUMER_PERISHABLE_INSTANT_REQUIRED");
    if (this.openGapOf(tokenRef) > 0) {
      throw new Error(`CONSUMER_PERISHABLE_GAP_OPEN:${operation}`);
    }
    if (!this.isFinalAsOf(tokenRef, instant)) {
      throw new Error(`CONSUMER_PERISHABLE_NOT_FINAL:${operation}`);
    }
    return true;
  }

  transition({ tokenRef, to, attestation, verify }) {
    if (!tokenRef || !Object.hasOwn(ConsumerStatus, to)) throw new Error("CONSUMER_STATE_INVALID");
    if (!attestation || typeof verify !== "function" || verify(attestation) !== true) {
      throw new Error("CONSUMER_ATTESTATION_REQUIRED");
    }
    const from = this.current(tokenRef);
    if (!TRANSITIONS[from]?.has(to)) throw new Error(`CONSUMER_TRANSITION_REJECTED:${from}:${to}`);
    if (from === ConsumerStatus.REDEEMED) throw new Error("REDEEMED_TERMINAL");
    const entry = Object.freeze({ tokenRef, from, to, attestationId: attestation.attestationId });
    this.#state.set(tokenRef, to);
    this.#history.push(entry);
    return entry;
  }

  history(tokenRef) {
    return this.#history.filter((entry) => entry.tokenRef === tokenRef);
  }
}
