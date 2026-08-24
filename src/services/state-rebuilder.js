import { StateEngine } from "../domain/state-engine.js";

export class StateRebuilder {
  rebuild(entries) {
    if (!Array.isArray(entries)) throw new Error("STATE_HISTORY_INVALID");
    const engine = new StateEngine();
    const ordered = [...entries].sort((a, b) => a.evidenceVersion - b.evidenceVersion);
    for (const entry of ordered) {
      engine.transition(entry);
    }
    return engine;
  }
}

