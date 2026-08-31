import { evidenceHash } from "../domain/canonical-json.js";

export class SyntheticAuthorityAdapter {
  constructor({ sourceId, schemaRegistry, sourceRegistry }) {
    this.sourceId = sourceId;
    this.schemaRegistry = schemaRegistry;
    this.sourceRegistry = sourceRegistry;
  }

  ingest({ schemaVersion, payload }) {
    this.sourceRegistry.requireActive(this.sourceId, schemaVersion);
    const validated = this.schemaRegistry.validate(schemaVersion, payload);
    return Object.freeze({
      sourceId: this.sourceId,
      schemaVersion,
      sourceRecordHash: evidenceHash(validated),
      payload: validated,
      publicPayload: Object.freeze(this.schemaRegistry.publicProjection(schemaVersion, validated)),
    });
  }
}

