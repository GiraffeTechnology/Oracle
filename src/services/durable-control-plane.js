import { evidenceHash } from "../domain/canonical-json.js";
import { captureProductionState } from "./production-state.js";

const WRITE_METHODS = Object.freeze(["verifyAsset", "bindToken", "issueAttestation", "requestRevocation", "approveAction", "requestSourceDisable", "executeSourceDisable", "requestSignerRotation", "executeSignerRotation", "reconcileSignerRotation", "exportAudit", "executeRevocation", "beginSettlement", "finalizeSettlement", "cancelSettlement", "disputeSettlement", "timeoutSettlement"]);

export class DurableOracleControlPlane {
  constructor({ controlPlane, repository, runtime, dualControl }) {
    if (!controlPlane || typeof repository?.getCommand !== "function" || typeof repository.persistMutation !== "function" || !runtime?.operationalState || !dualControl) throw new Error("DURABLE_CONTROL_PLANE_DEPENDENCY_MISSING");
    this.controlPlane = controlPlane;
    this.repository = repository;
    this.runtime = runtime;
    this.dualControl = dualControl;
  }

  async execute(method, args) {
    return this.executeResolved(method, args, async () => args);
  }

  async executeResolved(method, commandInput, resolveOperationInput) {
    if (this.runtime.operationalState.compromised) throw new Error("DURABLE_STATE_COMPROMISED");
    if (typeof commandInput?.idempotencyKey !== "string" || !commandInput.idempotencyKey || typeof resolveOperationInput !== "function") throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    const durableCommandHash = evidenceHash({ method, input: commandInput });
    const prior = await this.repository.getCommand(commandInput.idempotencyKey);
    if (prior) {
      if (prior.commandHash !== durableCommandHash) throw new Error("COMMAND_IDEMPOTENCY_CONFLICT");
      if (prior.status !== "COMPLETED") throw new Error("COMMAND_RECOVERY_REQUIRED");
      return Object.freeze({ commandHash: durableCommandHash, result: prior.result, replayed: true });
    }
    const operationInput = await resolveOperationInput();
    const beforeAudit = this.runtime.auditJournal.list().length;
    const beforeOutbox = new Set(this.runtime.outbox.list().map(({ eventId }) => eventId));
    const result = await this.controlPlane[method](operationInput);
    if (result?.replayed === true) return result;
    try {
      await this.repository.persistMutation({
        method,
        idempotencyKey: commandInput.idempotencyKey,
        commandHash: durableCommandHash,
        input: operationInput,
        result: result?.result ?? result,
        auditEvents: this.runtime.auditJournal.list().slice(beforeAudit),
        outboxEvents: this.runtime.outbox.list().filter(({ eventId }) => !beforeOutbox.has(eventId)),
        stateSnapshot: captureProductionState(this.runtime, this.dualControl),
      });
      return result;
    } catch {
      this.runtime.operationalState.compromised = true;
      this.runtime.operationalState.errorCode = "MYSQL_DURABILITY_FAILURE";
      throw new Error("MYSQL_DURABILITY_FAILURE");
    }
  }
}

for (const method of WRITE_METHODS) {
  DurableOracleControlPlane.prototype[method] = function durable(args) {
    return this.execute(method, args);
  };
}
