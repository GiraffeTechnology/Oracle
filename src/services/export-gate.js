const ALLOWED_PURPOSES = new Set(["regulatory-audit", "legal-disclosure", "internal-reconciliation"]);
export class ExportGate {
  authorize({ permission, purpose, recordCount }) {
    if (permission !== "audit:export") throw new Error("EXPORT_PERMISSION_DENIED");
    if (!ALLOWED_PURPOSES.has(purpose)) throw new Error("EXPORT_PURPOSE_INVALID");
    if (!Number.isInteger(recordCount) || recordCount < 1 || recordCount > 10000) throw new Error("EXPORT_SIZE_REJECTED");
    return Object.freeze({ purpose, recordCount, sensitiveFieldsIncluded: false });
  }
}

