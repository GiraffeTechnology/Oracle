import { createAuditExport } from "./audit-export.js";
import { ExportGate } from "./export-gate.js";
import { evidenceHash } from "../domain/canonical-json.js";

export class AdminOperations {
  constructor({ runtime, sourceRegistry, authorizer, reviewQueue = null, dualControl = null, clock = () => new Date() }) {
    if (!runtime || !sourceRegistry || !authorizer) throw new Error("ADMIN_OPERATIONS_DEPENDENCY_MISSING");
    Object.assign(this, { runtime, sourceRegistry, authorizer, reviewQueue, dualControl, clock });
  }

  async snapshot(actorId) {
    this.authorizer.require(actorId, "audit:read");
    const auditEvents = this.runtime.auditJournal.list();
    const pendingOutbox = this.runtime.outbox?.pending?.(10000) ?? [];
    return Object.freeze({
      generatedAt: this.clock().toISOString(),
      sources: this.sourceRegistry.listPublic(),
      reviewQueue: this.reviewQueue?.list?.() ?? [],
      controlledActions: this.dualControl?.list?.() ?? [],
      signerSet: Object.freeze({
        signerSetId: this.runtime.attestations?.signerSetId ?? null,
        status: this.runtime.attestations?.signerPolicy?.record?.status ?? "SYNTHETIC_OR_EXTERNAL",
        privateMaterialIncluded: false,
      }),
      audit: Object.freeze({
        recordCount: auditEvents.length,
        headHash: auditEvents.at(-1)?.eventHash ?? "0".repeat(64),
        chainVerified: this.runtime.auditJournal.verify(),
      }),
      operations: Object.freeze({ pendingOutbox: pendingOutbox.length }),
    });
  }

  async exportAudit(actorId, purpose) {
    this.authorizer.require(actorId, "audit:export");
    const events = this.runtime.auditJournal.list();
    new ExportGate().authorize({ permission: "audit:export", purpose, recordCount: events.length });
    const createdAt = this.clock().toISOString();
    const exported = createAuditExport(events, {
      exportId: `audit-${this.clock().getTime()}`,
      purpose,
      createdAt,
    });
    this.runtime.auditJournal.append({
      type: "audit.exported",
      subjectId: exported.manifest.exportId,
      payloadHash: evidenceHash({ purpose, recordCount: exported.manifest.recordCount, recordsHash: exported.manifest.recordsHash }),
      actorId,
      occurredAt: createdAt,
    });
    return exported;
  }
}
