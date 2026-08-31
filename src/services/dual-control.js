export class DualControlQueue {
  #actions = new Map();

  request({ actionId, actionType, subjectId, payloadHash, requestedBy, requestedAt }) {
    if (this.#actions.has(actionId)) throw new Error("ACTION_ALREADY_EXISTS");
    const action = Object.freeze({ actionId, actionType, subjectId, payloadHash, requestedBy, requestedAt, status: "PENDING", approvedBy: null, approvedAt: null });
    this.#actions.set(actionId, action);
    return action;
  }

  approve(actionId, { approvedBy, approvedAt }) {
    const current = this.#actions.get(actionId);
    if (!current || current.status !== "PENDING") throw new Error("ACTION_NOT_PENDING");
    if (current.requestedBy === approvedBy) throw new Error("DUAL_CONTROL_SELF_APPROVAL_REJECTED");
    const approved = Object.freeze({ ...current, status: "APPROVED", approvedBy, approvedAt });
    this.#actions.set(actionId, approved);
    return approved;
  }

  requireApproved(actionId, actionType, subjectId, payloadHash) {
    const action = this.#actions.get(actionId);
    if (!action || action.status !== "APPROVED") throw new Error("DUAL_CONTROL_APPROVAL_REQUIRED");
    if (action.actionType !== actionType || action.subjectId !== subjectId || action.payloadHash !== payloadHash) {
      throw new Error("DUAL_CONTROL_SCOPE_MISMATCH");
    }
    return action;
  }

  beginExecution(actionId, { actionType, subjectId, payloadHash, executedBy, executionStartedAt }) {
    const action = this.requireApproved(actionId, actionType, subjectId, payloadHash);
    const executing = Object.freeze({ ...action, status: "EXECUTING", executedBy, executionStartedAt, executedAt: null });
    this.#actions.set(actionId, executing);
    return executing;
  }

  completeExecution(actionId, executedAt) {
    const current = this.#actions.get(actionId);
    if (!current || !["EXECUTING", "RECOVERING"].includes(current.status)) throw new Error("ACTION_NOT_EXECUTING");
    const executed = Object.freeze({ ...current, status: "EXECUTED", executedAt });
    this.#actions.set(actionId, executed);
    return executed;
  }

  failExecution(actionId, { failedAt, errorCode }) {
    const current = this.#actions.get(actionId);
    if (!current || !["EXECUTING", "RECOVERING"].includes(current.status)) throw new Error("ACTION_NOT_EXECUTING");
    if (!failedAt || !errorCode) throw new Error("ACTION_FAILURE_INVALID");
    const failed = Object.freeze({ ...current, status: "FAILED", failedAt, errorCode });
    this.#actions.set(actionId, failed);
    return failed;
  }

  markRecoveryRequired(actionId, { failedAt, errorCode }) {
    const current = this.#actions.get(actionId);
    if (!current || !["EXECUTING", "RECOVERING"].includes(current.status)) throw new Error("ACTION_NOT_EXECUTING");
    if (!failedAt || !errorCode) throw new Error("ACTION_FAILURE_INVALID");
    const recovery = Object.freeze({ ...current, status: "RECOVERY_REQUIRED", failedAt, errorCode });
    this.#actions.set(actionId, recovery);
    return recovery;
  }

  beginRecovery(actionId, { actionType, subjectId, payloadHash, executedBy, recoveryStartedAt }) {
    const current = this.#actions.get(actionId);
    if (!current || current.status !== "RECOVERY_REQUIRED") throw new Error("ACTION_RECOVERY_NOT_REQUIRED");
    if (current.actionType !== actionType || current.subjectId !== subjectId || current.payloadHash !== payloadHash) throw new Error("DUAL_CONTROL_SCOPE_MISMATCH");
    const recovering = Object.freeze({ ...current, status: "RECOVERING", recoveryExecutedBy: executedBy, recoveryStartedAt });
    this.#actions.set(actionId, recovering);
    return recovering;
  }

  list() {
    return Object.freeze([...this.#actions.values()]);
  }

  exportState() { return Object.freeze({ actions: [...this.#actions.values()] }); }
  importState(state) {
    if (this.#actions.size || !Array.isArray(state?.actions)) throw new Error("DUAL_CONTROL_STATE_IMPORT_REJECTED");
    for (const action of state.actions) {
      if (!action.actionId || this.#actions.has(action.actionId)) throw new Error("DUAL_CONTROL_STATE_IMPORT_INVALID");
      this.#actions.set(action.actionId, Object.freeze({ ...action }));
    }
  }
}
