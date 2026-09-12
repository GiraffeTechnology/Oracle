export class RetentionPolicy {
  constructor({ policyId, evidenceDays, auditDays, identityDays }) {
    for (const value of [evidenceDays, auditDays, identityDays]) {
      if (!Number.isInteger(value) || value < 1 || value > 36500) throw new Error("RETENTION_DAYS_INVALID");
    }
    this.policyId = policyId;
    this.periods = Object.freeze({ evidence: evidenceDays, audit: auditDays, identity: identityDays });
  }

  expiresAt(kind, createdAt) {
    const days = this.periods[kind];
    if (!days) throw new Error("RETENTION_KIND_INVALID");
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) throw new Error("RETENTION_DATE_INVALID");
    date.setUTCDate(date.getUTCDate() + days);
    return date;
  }
}
