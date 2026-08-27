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
  for (const name of COMPONENTS) runtime[name].importState(snapshot.state.components[name]);
  dualControl.importState(snapshot.state.dualControl);
  return true;
}
