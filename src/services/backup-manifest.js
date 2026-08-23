import { evidenceHash } from "../domain/canonical-json.js";

export function createBackupManifest({ backupId, createdAt, databaseSnapshotHash, auditHeadHash, schemaVersion, recordCounts }) {
  if (![backupId, createdAt, databaseSnapshotHash, auditHeadHash, schemaVersion].every((value) => typeof value === "string" && value)) {
    throw new Error("BACKUP_MANIFEST_INVALID");
  }
  if (!recordCounts || Object.values(recordCounts).some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("BACKUP_RECORD_COUNTS_INVALID");
  }
  const manifest = Object.freeze({ backupId, createdAt, databaseSnapshotHash, auditHeadHash, schemaVersion, recordCounts: Object.freeze({ ...recordCounts }) });
  return Object.freeze({ manifest, manifestHash: evidenceHash(manifest) });
}

export function verifyBackupManifest(candidate) {
  return Boolean(candidate?.manifest && candidate?.manifestHash === evidenceHash(candidate.manifest));
}

