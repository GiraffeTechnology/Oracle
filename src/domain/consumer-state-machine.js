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

export class SyntheticConsumerStateMachine {
  #state = new Map();
  #history = [];

  current(tokenRef) {
    return this.#state.get(tokenRef) ?? ConsumerStatus.DRAFT;
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
