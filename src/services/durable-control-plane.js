import { evidenceHash } from "../domain/canonical-json.js";
import { captureProductionState } from "./production-state.js";
import { MySqlTransactionError } from "../adapters/mysql-repository.js";

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

  // Read-only reconciliation observation, NOT permission to resume writes.
  // An absent record on an unverified/lagging target never proves non-commit.
  async inspectCommandRecovery(method, commandInput) {
    if (!WRITE_METHODS.includes(method)) throw new Error("COMMAND_METHOD_INVALID");
    if (typeof commandInput?.idempotencyKey !== "string" || commandInput.idempotencyKey.length < 1 || commandInput.idempotencyKey.length > 128) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    if (typeof this.controlPlane.authorizeCommand !== "function") throw new Error("COMMAND_AUTHORIZATION_UNAVAILABLE");
    this.controlPlane.authorizeCommand(method, commandInput);
    const commandHash = evidenceHash({ method, input: durableInput(method, commandInput) });
    let prior;
    try { prior = await this.repository.getCommand(commandInput.idempotencyKey); }
    catch { throw new Error("MYSQL_RECOVERY_READ_FAILED"); }
    const status = !prior ? "UNRESOLVED"
      : prior.commandHash !== commandHash ? "CONFLICT"
        : prior.status === "COMPLETED" ? "COMPLETED_OBSERVED" : "UNRESOLVED";
    return Object.freeze({ status, writeResumptionAllowed: false });
  }

  #failDurability(error) {
    this.runtime.operationalState.compromised = true;
    const failure = error instanceof MySqlTransactionError ? error : new Error("MYSQL_DURABILITY_FAILURE");
    this.runtime.operationalState.errorCode = failure.message;
    throw failure;
  }

  async executeResolved(method, commandInput, resolveOperationInput) {
    if (this.runtime.operationalState.compromised) throw new Error("DURABLE_STATE_COMPROMISED");
    if (this.runtime.operationalState.signerRecoveryRequired && method !== "reconcileSignerRotation") throw new Error("SIGNER_ROTATION_RECOVERY_REQUIRED");
    if (typeof commandInput?.idempotencyKey !== "string" || commandInput.idempotencyKey.length < 1 || commandInput.idempotencyKey.length > 128 || typeof resolveOperationInput !== "function") throw new Error("IDEMPOTENCY_KEY_REQUIRED");
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
    const beforeRevocations = new Set(this.runtime.revocations.exportState().items.map(({ attestationId }) => attestationId));
    let result;
    try {
      result = await this.controlPlane[method](operationInput);
    } catch (error) {
      if (method === "executeSignerRotation" && this.runtime.operationalState.signerRecoveryRequired) {
        if (typeof this.repository.persistRecoveryState !== "function") {
          this.runtime.operationalState.compromised = true;
          this.runtime.operationalState.errorCode = "MYSQL_DURABILITY_FAILURE";
          throw new Error("MYSQL_DURABILITY_FAILURE");
        }
        try {
          await this.repository.persistRecoveryState({
            method,
            idempotencyKey: commandInput.idempotencyKey,
            commandHash: durableCommandHash,
            stateSnapshot: captureProductionState(this.runtime, this.dualControl),
          });
        } catch (error) {
          this.#failDurability(error);
        }
      }
      throw error;
    }
    if (result?.replayed === true) return result;
    const outboxEvents = this.runtime.outbox.list().filter(({ eventId }) => !beforeOutbox.has(eventId));
    const revocations = this.runtime.revocations.exportState().items.filter(({ attestationId }) => !beforeRevocations.has(attestationId));
    try {
      await this.repository.persistMutation({
        method,
        idempotencyKey: commandInput.idempotencyKey,
        commandHash: durableCommandHash,
        input: durableInput(method, operationInput),
        result: result?.result ?? result,
        auditEvents: this.runtime.auditJournal.list().slice(beforeAudit),
        outboxEvents,
        revocations,
        stateSnapshot: captureProductionState(this.runtime, this.dualControl),
      });
      for (const { eventId } of outboxEvents) this.runtime.outbox.markDurable(eventId);
      return result;
    } catch (error) {
      this.#failDurability(error);
    }
  }
}

for (const method of WRITE_METHODS) {
  DurableOracleControlPlane.prototype[method] = function durable(args) {
    return this.execute(method, args);
  };
}
