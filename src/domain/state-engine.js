import { OracleStatus } from "./oracle-status.js";

const TRANSITIONS = Object.freeze({
  [OracleStatus.NOT_VERIFIED]: new Set([OracleStatus.VALID, OracleStatus.INVALID, OracleStatus.REVIEW_REQUIRED]),
  [OracleStatus.VALID]: new Set([OracleStatus.TRANSFER_PENDING, OracleStatus.FROZEN, OracleStatus.REVOKED, OracleStatus.EXPIRED]),
  [OracleStatus.TRANSFER_PENDING]: new Set([OracleStatus.VALID, OracleStatus.FROZEN, OracleStatus.REVIEW_REQUIRED, OracleStatus.REVOKED]),
  [OracleStatus.FROZEN]: new Set([OracleStatus.VALID, OracleStatus.REVIEW_REQUIRED, OracleStatus.REVOKED]),
  [OracleStatus.REVIEW_REQUIRED]: new Set([OracleStatus.VALID, OracleStatus.INVALID, OracleStatus.FROZEN, OracleStatus.REVOKED]),
  [OracleStatus.EXPIRED]: new Set([OracleStatus.VALID, OracleStatus.REVOKED]),
  [OracleStatus.INVALID]: new Set([OracleStatus.REVIEW_REQUIRED]),
  [OracleStatus.REVOKED]: new Set(),
});

export class StateEngine {
  #states = new Map();
  #history = [];

  current(subjectId) {
    return this.#states.get(subjectId) ?? OracleStatus.NOT_VERIFIED;
  }

  transition({ subjectId, to, reasonHash, evidenceVersion, occurredAt }) {
    const from = this.current(subjectId);
    if (!TRANSITIONS[from]?.has(to)) throw new Error(`STATE_TRANSITION_REJECTED:${from}:${to}`);
    const previous = [...this.#history].reverse().find((entry) => entry.subjectId === subjectId);
    if (previous && evidenceVersion <= previous.evidenceVersion) throw new Error("EVIDENCE_VERSION_NOT_INCREASING");
    const entry = Object.freeze({ subjectId, from, to, reasonHash, evidenceVersion, occurredAt });
    this.#states.set(subjectId, to);
    this.#history.push(entry);
    return entry;
  }

  history(subjectId) {
    return this.#history.filter((entry) => entry.subjectId === subjectId);
  }
}
