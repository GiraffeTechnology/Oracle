import { evidenceHash } from "../domain/canonical-json.js";

function safeText(value) {
  return typeof value === "string" && /^[=+\-@]/.test(value) ? `'${value}` : value;
}
export function createAuditExport(events, { exportId, purpose, createdAt }) {
  if (!Array.isArray(events) || !exportId || !purpose || !createdAt) throw new Error("AUDIT_EXPORT_INVALID");
  const records = events.map((event) => Object.fromEntries(Object.entries(event).map(([key, value]) => [key, safeText(value)])));
  const manifest = Object.freeze({ exportId, purpose, createdAt, recordCount: records.length, recordsHash: evidenceHash(records) });
  return Object.freeze({ manifest, records: Object.freeze(records), manifestHash: evidenceHash(manifest) });
}
export function verifyAuditExport(candidate) {
  return candidate?.manifest?.recordCount === candidate?.records?.length && candidate.manifest.recordsHash === evidenceHash(candidate.records) && candidate.manifestHash === evidenceHash(candidate.manifest);
}

