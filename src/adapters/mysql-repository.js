export class MySqlOracleRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.getConnection !== "function") throw new Error("MYSQL_POOL_INVALID");
    this.pool = pool;
  }

  async transaction(operation) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await operation(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getAsset(assetId, connection = this.pool) {
    const [rows] = await connection.execute(
      "SELECT asset_id, asset_fingerprint_hash, registry_ref_hash, current_status, evidence_version, updated_at FROM assets WHERE asset_id = ?",
      [assetId],
    );
    return rows[0] ?? null;
  }

  async upsertAsset(connection, record) {
    await connection.execute(
      `INSERT INTO assets
       (asset_id, asset_fingerprint_hash, registry_ref_hash, owner_commitment, current_status, evidence_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       registry_ref_hash = VALUES(registry_ref_hash), owner_commitment = VALUES(owner_commitment),
       current_status = VALUES(current_status), evidence_version = VALUES(evidence_version), updated_at = VALUES(updated_at)`,
      [record.assetId, record.assetFingerprintHash, record.registryRefHash, record.ownerCommitment ?? null, record.currentStatus, record.evidenceVersion, record.createdAt, record.updatedAt],
    );
  }

  async appendCertificate(connection, record) {
    await connection.execute(
      `INSERT INTO certificate_versions
       (asset_id, certificate_version, certificate_hash, previous_certificate_hash, effective_at)
       VALUES (?, ?, ?, ?, ?)`,
      [record.assetId, record.certificateVersion, record.certificateHash, record.previousCertificateHash ?? null, record.effectiveAt],
    );
  }

  async appendAuditEvent(connection, event) {
    await connection.execute(
      `INSERT INTO audit_events
       (event_type, subject_id, payload_hash, actor_id, previous_hash, event_hash, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [event.type, event.subjectId, event.payloadHash, event.actorId, event.previousHash, event.eventHash, event.occurredAt],
    );
  }

  async enqueueOutbox(connection, event) {
    await connection.execute(
      `INSERT INTO outbox_events
       (event_id, event_type, subject_id, payload_hash, created_at, attempts)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [event.eventId, event.eventType, event.subjectId, event.payloadHash, event.createdAt],
    );
  }
}

