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
      "SELECT asset_id, asset_fingerprint_hash, wenbao_registry_ref, transfer_eligibility, warehouse_receipt_hash, current_certificate_hash, current_certificate_version, encumbrance_status, oracle_status, evidence_version, updated_at FROM assets WHERE asset_id = ?",
      [assetId],
    );
    return rows[0] ?? null;
  }

  async upsertAsset(connection, record) {
    const [conflicts] = await connection.execute(
      `SELECT asset_id FROM assets
       WHERE asset_id = ? OR asset_fingerprint_hash = ? OR warehouse_receipt_hash = ? OR current_certificate_hash = ?
       FOR UPDATE`,
      [record.assetId, record.assetFingerprintHash, record.warehouseReceiptHash, record.currentCertificateHash],
    );
    if (conflicts.some(({ asset_id: assetId }) => assetId !== record.assetId)) throw new Error("ASSET_UNIQUE_IDENTITY_CONFLICT");
    await connection.execute(
      `INSERT INTO assets
       (asset_id, asset_fingerprint_hash, wenbao_registry_ref, classification_code, transfer_eligibility, warehouse_id, warehouse_receipt_hash, current_certificate_hash, current_certificate_version, current_owner_commitment, encumbrance_status, oracle_status, evidence_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       wenbao_registry_ref = VALUES(wenbao_registry_ref), transfer_eligibility = VALUES(transfer_eligibility),
       warehouse_receipt_hash = VALUES(warehouse_receipt_hash), current_certificate_hash = VALUES(current_certificate_hash),
       current_certificate_version = VALUES(current_certificate_version), current_owner_commitment = VALUES(current_owner_commitment),
       encumbrance_status = VALUES(encumbrance_status), oracle_status = VALUES(oracle_status),
       evidence_version = VALUES(evidence_version), updated_at = VALUES(updated_at)`,
      [record.assetId, record.assetFingerprintHash, record.wenbaoRegistryRef, record.classificationCode ?? null, record.transferEligibility, record.warehouseId, record.warehouseReceiptHash, record.currentCertificateHash, record.currentCertificateVersion, record.currentOwnerCommitment, record.encumbranceStatus, record.oracleStatus, record.evidenceVersion, record.createdAt, record.updatedAt],
    );
  }

  async appendCertificate(connection, record) {
    await connection.execute(
      `INSERT INTO certificate_versions
       (asset_id, token_id, certificate_version, certificate_hash, previous_certificate_hash, wenbao_change_ref, warehouse_receipt_hash, effective_at, superseded_at, certificate_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.assetId, record.tokenId, record.certificateVersion, record.certificateHash, record.previousCertificateHash ?? null, record.wenbaoChangeRef, record.warehouseReceiptHash, record.effectiveAt, record.supersededAt ?? null, record.status],
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
