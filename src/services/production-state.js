import { evidenceHash } from "../domain/canonical-json.js";

const COMPONENTS = Object.freeze(["sourceRegistry", "recordStore", "stateEngine", "auditJournal", "revocations", "attestations", "tokenIndex", "outbox", "reviewQueue", "settlements"]);

export function captureProductionState(runtime, dualControl) {
  const state = { schemaVersion: "giraffe-production-state.v1", components: {}, dualControl: dualControl.exportState() };
  for (const name of COMPONENTS) state.components[name] = runtime[name].exportState();
  const stateHash = evidenceHash(state);
  return Object.freeze({ state: Object.freeze(state), stateHash });
}

export function restoreProductionState(runtime, dualControl, snapshot) {
  if (!snapshot) return false;
  if (snapshot.state?.schemaVersion !== "giraffe-production-state.v1" || snapshot.stateHash !== evidenceHash(snapshot.state)) throw new Error("PRODUCTION_STATE_SNAPSHOT_INVALID");
  const storedSignerSetId = snapshot.state.components?.attestations?.signerSetId;
  const activeSignerSetId = runtime.attestations.signerSetId;
  const signerMismatch = storedSignerSetId !== activeSignerSetId;
  let dualControlState = snapshot.state.dualControl;
  if (signerMismatch) {
    const subjectId = `${storedSignerSetId}->${activeSignerSetId}`;
    const candidates = dualControlState?.actions?.filter((action) => action.actionType === "SIGNER_ROTATE" && action.subjectId === subjectId && ["APPROVED", "EXECUTING", "RECOVERY_REQUIRED"].includes(action.status)) ?? [];
    if (candidates.length !== 1) throw new Error("SIGNER_ROTATION_STARTUP_RECOVERY_UNPROVABLE");
    dualControlState = Object.freeze({ actions: dualControlState.actions.map((action) => action.actionId === candidates[0].actionId ? Object.freeze({ ...action, status: "RECOVERY_REQUIRED", failedAt: action.failedAt ?? action.executionStartedAt ?? action.approvedAt, errorCode: "SIGNER_ROTATION_STARTUP_RECONCILIATION_REQUIRED" }) : action) });
  }
  for (const name of COMPONENTS) runtime[name].importState(snapshot.state.components[name], name === "attestations" ? { allowHistoricalSignerSet: signerMismatch } : undefined);
  dualControl.importState(dualControlState);
  runtime.operationalState.signerRecoveryRequired = signerMismatch;
  return true;
}

