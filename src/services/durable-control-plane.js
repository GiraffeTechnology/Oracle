import { evidenceHash } from "../domain/canonical-json.js";
import { captureProductionState } from "./production-state.js";

const WRITE_METHODS = Object.freeze(["verifyAsset", "bindToken", "issueAttestation", "requestRevocation", "approveAction", "requestSourceDisable", "executeSourceDisable", "requestSignerRotation", "executeSignerRotation", "reconcileSignerRotation", "exportAudit", "executeRevocation", "beginSettlement", "finalizeSettlement", "cancelSettlement", "disputeSettlement", "timeoutSettlement"]);

function durableInput(method, input) {
  if (method !== "exportAudit") return input;
  const { adminOperations: _capability, ...serializable } = input;
  return serializable;
}

export class DurableOracleControlPlane {
  constructor({ controlPlane, repository, runtime, dualControl }) {
    if (!controlPlane || typeof repository?.getCommand !== "function" || typeof repository.persistMutation !== "function" || !runtime?.operationalState || !dualControl) throw new Error("DURABLE_CONTROL_PLANE_DEPENDENCY_MISSING");
    this.controlPlane = controlPlane;
    this.repository = repository;
    this.runtime = runtime;
    this.dualControl = dualControl;
    this.inFlight = new Map();
    this.writeTail = Promise.resolve();
  }

  async execute(method, args) {
    return this.executeResolved(method, args, async () => args);
  }

  async executeResolved(method, commandInput, resolveOperationInput) {
    if (this.runtime.operationalState.compromised) throw new Error("DURABLE_STATE_COMPROMISED");
    if (this.runtime.operationalState.signerRecoveryRequired && method !== "reconcileSignerRotation") throw new Error("SIGNER_ROTATION_RECOVERY_REQUIRED");
    if (typeof commandInput?.idempotencyKey !== "string" || !commandInput.idempotencyKey || typeof resolveOperationInput !== "function") throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    const durableCommandHash = evidenceHash({ method, input: durableInput(method, commandInput) });
    if (typeof this.controlPlane.authorizeCommand !== "function") throw new Error("COMMAND_AUTHORIZATION_UNAVAILABLE");
    this.controlPlane.authorizeCommand(method, commandInput);
    const prior = await this.repository.getCommand(commandInput.idempotencyKey);
    if (prior) {
      if (prior.commandHash !== durableCommandHash) throw new Error("COMMAND_IDEMPOTENCY_CONFLICT");
      if (prior.status !== "COMPLETED") throw new Error("COMMAND_RECOVERY_REQUIRED");
      return Object.freeze({ commandHash: durableCommandHash, result: prior.result, replayed: true });
    }
    const active = this.inFlight.get(commandInput.idempotencyKey);
    if (active) {
      if (active.commandHash !== durableCommandHash) throw new Error("COMMAND_IDEMPOTENCY_CONFLICT");
      const committed = await active.promise;
      return Object.freeze({ ...committed, replayed: true });
    }
    const promise = this.#serialize(method, () => this.#executeAndPersist(method, commandInput, durableCommandHash, resolveOperationInput));
    this.inFlight.set(commandInput.idempotencyKey, { commandHash: durableCommandHash, promise });
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(commandInput.idempotencyKey)?.promise === promise) this.inFlight.delete(commandInput.idempotencyKey);
    }
  }

  #serialize(method, operation) {
    const guarded = () => {
      if (this.runtime.operationalState.compromised) throw new Error("DURABLE_STATE_COMPROMISED");
      if (this.runtime.operationalState.signerRecoveryRequired && method !== "reconcileSignerRotation") throw new Error("SIGNER_ROTATION_RECOVERY_REQUIRED");
      return operation();
    };
    const current = this.writeTail.then(guarded, guarded);
    this.writeTail = current.then(() => undefined, () => undefined);
    return current;
  }

  async #executeAndPersist(method, commandInput, durableCommandHash, resolveOperationInput) {
    const operationInput = await resolveOperationInput();
    const beforeAudit = this.runtime.auditJournal.list().length;
    const beforeOutbox = new Set(this.runtime.outbox.list().map(({ eventId }) => eventId));
    const result = await this.controlPlane[method](operationInput);
    if (result?.replayed === true) return result;
    const outboxEvents = this.runtime.outbox.list().filter(({ eventId }) => !beforeOutbox.has(eventId));
    try {
      await this.repository.persistMutation({
        method,
        idempotencyKey: commandInput.idempotencyKey,
        commandHash: durableCommandHash,
        input: durableInput(method, operationInput),
        result: result?.result ?? result,
        auditEvents: this.runtime.auditJournal.list().slice(beforeAudit),
        outboxEvents,
        stateSnapshot: captureProductionState(this.runtime, this.dualControl),
      });
      for (const { eventId } of outboxEvents) this.runtime.outbox.markDurable(eventId);
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

