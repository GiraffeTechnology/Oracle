import { evidenceHash } from "../domain/canonical-json.js";

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

  async getCommand(idempotencyKey, connection = this.pool) {
    const [rows] = await connection.execute(
      "SELECT command_hash, command_status, result_json FROM command_journal WHERE idempotency_key = ?",
      [idempotencyKey],
    );
    const row = rows[0];
    return row ? Object.freeze({ commandHash: row.command_hash, status: row.command_status, result: typeof row.result_json === "string" ? JSON.parse(row.result_json) : row.result_json }) : null;
  }

  async loadStateSnapshot(connection = this.pool) {
    const [rows] = await connection.execute("SELECT state_json, state_hash FROM production_state_snapshots WHERE snapshot_id = 1");
    const row = rows[0];
    if (!row) return null;
    const storedState = typeof row.state_json === "string" ? JSON.parse(row.state_json) : row.state_json;
    if (evidenceHash(storedState) !== row.state_hash) throw new Error("PRODUCTION_STATE_SNAPSHOT_INVALID");
    const [deliveryRows] = await connection.execute("SELECT event_id, attempts, delivery_state_attempts, published_at, dead_lettered_at, dead_letter_attempts, dead_letter_state_attempts FROM outbox_events");
    const deliveryById = new Map(deliveryRows.map((delivery) => [delivery.event_id, delivery]));
    const state = structuredClone(storedState);
    state.components.outbox.events = state.components.outbox.events.map((event) => {
      const delivery = deliveryById.get(event.eventId);
      if (!delivery) return event;
      const timestamp = (value) => value instanceof Date ? value.toISOString() : value;
      return { ...event, attempts: Number(delivery.attempts), deliveryStateAttempts: Number(delivery.delivery_state_attempts ?? 0), deadLetterAttempts: Number(delivery.dead_letter_attempts ?? 0), deadLetterStateAttempts: Number(delivery.dead_letter_state_attempts ?? 0), publishedAt: timestamp(delivery.published_at) ?? null, deadLetteredAt: timestamp(delivery.dead_lettered_at) ?? null };
    });
    return Object.freeze({ state, stateHash: evidenceHash(state) });
  }

  async #persistOutboxUpdate(sql, parameters, { verifySql, verifyParameters, accept }) {
    return this.transaction(async (connection) => {
      const [result] = await connection.execute(sql, parameters);
      if (result?.affectedRows === 1) return result;
      const [rows] = await connection.execute(verifySql, verifyParameters);
      if (!accept(rows[0])) throw new Error("OUTBOX_DELIVERY_UPDATE_CONFLICT");
      return Object.freeze({ affectedRows: 0, idempotent: true });
    });
  }

  async recordOutboxAttempt(eventId, attempts) {
    if (!eventId || !Number.isInteger(attempts) || attempts < 1) throw new Error("OUTBOX_DELIVERY_UPDATE_INVALID");
    return this.#persistOutboxUpdate("UPDATE outbox_events SET attempts=GREATEST(attempts, ?) WHERE event_id=? AND published_at IS NULL AND dead_lettered_at IS NULL", [attempts, eventId], {
      verifySql: "SELECT attempts, published_at, dead_lettered_at FROM outbox_events WHERE event_id=?",
      verifyParameters: [eventId],
      accept: (row) => row && row.published_at == null && row.dead_lettered_at == null && Number(row.attempts) >= attempts,
    });
  }

  async recordOutboxDeliveryStateAttempt(eventId, attempts) {
    if (!eventId || !Number.isInteger(attempts) || attempts < 1) throw new Error("OUTBOX_DELIVERY_UPDATE_INVALID");
    return this.#persistOutboxUpdate("UPDATE outbox_events SET delivery_state_attempts=GREATEST(delivery_state_attempts, ?) WHERE event_id=? AND published_at IS NULL AND dead_lettered_at IS NULL", [attempts, eventId], {
      verifySql: "SELECT delivery_state_attempts, published_at, dead_lettered_at FROM outbox_events WHERE event_id=?",
      verifyParameters: [eventId],
      accept: (row) => row && row.published_at == null && row.dead_lettered_at == null && Number(row.delivery_state_attempts) >= attempts,
    });
  }

  async recordOutboxDeadLetterAttempt(eventId, attempts) {
    if (!eventId || !Number.isInteger(attempts) || attempts < 1) throw new Error("OUTBOX_DELIVERY_UPDATE_INVALID");
    return this.#persistOutboxUpdate("UPDATE outbox_events SET dead_letter_attempts=GREATEST(dead_letter_attempts, ?) WHERE event_id=? AND published_at IS NULL AND dead_lettered_at IS NULL", [attempts, eventId], {
      verifySql: "SELECT dead_letter_attempts, published_at, dead_lettered_at FROM outbox_events WHERE event_id=?",
      verifyParameters: [eventId],
      accept: (row) => row && row.published_at == null && row.dead_lettered_at == null && Number(row.dead_letter_attempts) >= attempts,
    });
  }

  async recordOutboxDeadLetterStateAttempt(eventId, attempts) {
    if (!eventId || !Number.isInteger(attempts) || attempts < 1) throw new Error("OUTBOX_DELIVERY_UPDATE_INVALID");
    return this.#persistOutboxUpdate("UPDATE outbox_events SET dead_letter_state_attempts=GREATEST(dead_letter_state_attempts, ?) WHERE event_id=? AND published_at IS NULL AND dead_lettered_at IS NULL", [attempts, eventId], {
      verifySql: "SELECT dead_letter_state_attempts, published_at, dead_lettered_at FROM outbox_events WHERE event_id=?",
      verifyParameters: [eventId],
      accept: (row) => row && row.published_at == null && row.dead_lettered_at == null && Number(row.dead_letter_state_attempts) >= attempts,
    });
  }

  async markOutboxPublished(eventId, publishedAt) {
    if (!eventId || !publishedAt) throw new Error("OUTBOX_DELIVERY_UPDATE_INVALID");
    return this.#persistOutboxUpdate("UPDATE outbox_events SET published_at=COALESCE(published_at, ?) WHERE event_id=? AND dead_lettered_at IS NULL", [publishedAt, eventId], {
      verifySql: "SELECT published_at, dead_lettered_at FROM outbox_events WHERE event_id=?",
      verifyParameters: [eventId],
      accept: (row) => row && row.published_at != null && row.dead_lettered_at == null,
    });
  }

  async markOutboxDeadLettered(eventId, deadLetteredAt) {
    if (!eventId || !deadLetteredAt) throw new Error("OUTBOX_DELIVERY_UPDATE_INVALID");
    return this.#persistOutboxUpdate("UPDATE outbox_events SET dead_lettered_at=COALESCE(dead_lettered_at, ?) WHERE event_id=? AND published_at IS NULL", [deadLetteredAt, eventId], {
      verifySql: "SELECT published_at, dead_lettered_at FROM outbox_events WHERE event_id=?",
      verifyParameters: [eventId],
      accept: (row) => row && row.published_at == null && row.dead_lettered_at != null,
    });
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
       (asset_id, asset_fingerprint_hash, wenbao_registry_ref, classification_code, transfer_eligibility, warehouse_id, warehouse_receipt_hash, current_certificate_hash, current_certificate_version, current_owner_commitment, encumbrance_status, oracle_status, evidence_version, created_at, updated_at, source_authority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       wenbao_registry_ref = VALUES(wenbao_registry_ref), classification_code = VALUES(classification_code), transfer_eligibility = VALUES(transfer_eligibility),
       warehouse_id = VALUES(warehouse_id),
       warehouse_receipt_hash = VALUES(warehouse_receipt_hash), current_certificate_hash = VALUES(current_certificate_hash),
       current_certificate_version = VALUES(current_certificate_version), current_owner_commitment = VALUES(current_owner_commitment),
       encumbrance_status = VALUES(encumbrance_status), oracle_status = VALUES(oracle_status),
       evidence_version = VALUES(evidence_version), updated_at = VALUES(updated_at), source_authority = VALUES(source_authority)`,
      [record.assetId, record.assetFingerprintHash, record.wenbaoRegistryRef, record.classificationCode ?? null, record.transferEligibility, record.warehouseId, record.warehouseReceiptHash, record.currentCertificateHash, record.currentCertificateVersion, record.currentOwnerCommitment, record.encumbranceStatus, record.oracleStatus, record.evidenceVersion, record.createdAt, record.updatedAt, record.sourceAuthority],
    );
  }

  async appendCertificate(connection, record) {
    await connection.execute(
      `INSERT INTO certificate_versions
       (asset_id, token_id, certificate_version, certificate_hash, previous_certificate_hash, wenbao_change_ref, warehouse_receipt_hash, effective_at, superseded_at, certificate_status, source_authority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.assetId, record.tokenId, record.certificateVersion, record.certificateHash, record.previousCertificateHash ?? null, record.wenbaoChangeRef, record.warehouseReceiptHash, record.effectiveAt, record.supersededAt ?? null, record.status, record.sourceAuthority],
    );
  }

  async appendRevocation(connection, record) {
    await connection.execute(
      "INSERT INTO revocations (attestation_id, reason_hash, authority_id, revoked_at) VALUES (?, ?, ?, ?)",
      [record.attestationId, record.reasonHash, record.authorityId, record.revokedAt],
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

  async persistMutation({ method, idempotencyKey, commandHash, input, result, auditEvents, outboxEvents, revocations = [], stateSnapshot }) {
    if (!method || !idempotencyKey || !commandHash || !Array.isArray(auditEvents) || !Array.isArray(outboxEvents) || !Array.isArray(revocations) || !stateSnapshot?.state || !stateSnapshot.stateHash) throw new Error("MYSQL_MUTATION_INVALID");
    return this.transaction(async (connection) => {
      await connection.execute(
        "INSERT INTO command_journal (idempotency_key, command_hash, command_type, command_status, created_at, updated_at) VALUES (?, ?, ?, 'PENDING', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [idempotencyKey, commandHash, method],
      );
      await this.#persistProjection(connection, method, input, result);
      for (const revocation of revocations) await this.appendRevocation(connection, revocation);
      for (const event of auditEvents) await this.appendAuditEvent(connection, event);
      for (const event of outboxEvents) await this.enqueueOutbox(connection, event);
      await connection.execute(
        "INSERT INTO production_state_snapshots (snapshot_id, state_hash, state_json, updated_at) VALUES (1, ?, ?, UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE state_hash=VALUES(state_hash), state_json=VALUES(state_json), updated_at=VALUES(updated_at)",
        [stateSnapshot.stateHash, JSON.stringify(stateSnapshot.state)],
      );
      await connection.execute(
        "UPDATE command_journal SET command_status = 'COMPLETED', result_json = ?, updated_at = UTC_TIMESTAMP(6) WHERE idempotency_key = ? AND command_hash = ? AND command_status = 'PENDING'",
        [JSON.stringify(result), idempotencyKey, commandHash],
      );
      return Object.freeze({ idempotencyKey, commandHash, persisted: true });
    });
  }

  async #persistProjection(connection, method, input, result) {
    if (method === "verifyAsset") {
      const now = input.asset.updatedAt;
      await this.upsertAsset(connection, { ...input.asset, evidenceVersion: input.evidenceVersion, createdAt: input.asset.createdAt ?? now, sourceAuthority: input.evidenceSources.asset });
      if (input.certificate.previousCertificateHash) {
        const [supersedeResult] = await connection.execute("UPDATE certificate_versions SET certificate_status='SUPERSEDED', superseded_at=? WHERE asset_id=? AND certificate_hash=? AND certificate_status='CURRENT'", [input.certificate.effectiveAt, input.certificate.assetId, input.certificate.previousCertificateHash]);
        if (supersedeResult?.affectedRows !== 1) throw new Error("CERTIFICATE_SUPERSEDE_CONFLICT");
      }
      await this.appendCertificate(connection, { ...input.certificate, sourceAuthority: input.evidenceSources.certificate });
      await connection.execute(
        `INSERT INTO warehouse_records
         (asset_id, warehouse_id, warehouse_receipt_hash, warehouse_status, holder_commitment, encumbrance_status, observed_at, evidence_version, updated_at, source_authority)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE warehouse_status=VALUES(warehouse_status), holder_commitment=VALUES(holder_commitment), encumbrance_status=VALUES(encumbrance_status), observed_at=VALUES(observed_at), evidence_version=VALUES(evidence_version), updated_at=VALUES(updated_at), source_authority=VALUES(source_authority)`,
        [input.warehouse.assetId, input.warehouse.warehouseId, input.warehouse.warehouseReceiptHash, input.warehouse.warehouseStatus, input.warehouse.holderCommitment ?? null, input.warehouse.encumbranceStatus ?? input.asset.encumbranceStatus, input.warehouse.observedAt, input.evidenceVersion, now, input.evidenceSources.warehouse],
      );
      return;
    }
    if (method === "bindToken") {
      const binding = result;
      await connection.execute("INSERT INTO token_bindings (asset_id, chain_id, contract_ref, token_id, bound_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6))", [binding.assetId, binding.chainId, binding.contract, binding.tokenId]);
      return;
    }
    if (method === "issueAttestation") {
      const { envelope, envelopeHash, signature } = result;
      await connection.execute(
        `INSERT INTO attestations (attestation_id, asset_id, envelope_hash, signature, schema_version, chain_id, contract_ref, token_id, purpose, fact_type, fact_value_hash, source_authority, source_record_hash, observed_at, nonce, revocation_ref, signer_set_id, valid_from, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [envelope.attestationId, envelope.subject.assetId, envelopeHash, signature, envelope.schemaVersion, envelope.subject.chainId, envelope.subject.contract, envelope.subject.tokenId, envelope.subject.purpose, envelope.factType, evidenceHash(envelope.factValue), envelope.sourceAuthority, envelope.sourceRecordHash, envelope.observedAt, envelope.nonce, envelope.revocationRef, envelope.signerSetId, envelope.validFrom, envelope.expiresAt, envelope.observedAt],
      );
      return;
    }

    if (["beginSettlement", "finalizeSettlement", "cancelSettlement", "disputeSettlement", "timeoutSettlement"].includes(method)) {
      const record = result;
      await connection.execute(
        `INSERT INTO settlements (settlement_id, asset_id, chain_id, contract_ref, token_id, seller_wallet, buyer_wallet, snapshot_hash, external_execution_ref, old_certificate_hash, new_certificate_hash, wenbao_change_ref, failure_reason_hash, settlement_status, deadline_at, started_at, finalized_at, cancelled_at, disputed_at, timed_out_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE new_certificate_hash=VALUES(new_certificate_hash), wenbao_change_ref=VALUES(wenbao_change_ref), failure_reason_hash=VALUES(failure_reason_hash), settlement_status=VALUES(settlement_status), finalized_at=VALUES(finalized_at), cancelled_at=VALUES(cancelled_at), disputed_at=VALUES(disputed_at), timed_out_at=VALUES(timed_out_at)`,
        [record.settlementId, record.assetId, record.token.chainId, record.token.contract, record.token.tokenId, record.sellerWallet, record.buyerWallet, record.snapshotHash, record.externalExecutionRef, record.oldCertificateHash, record.newCertificateHash ?? null, record.registryChangeRef ?? null, record.failureReasonHash ?? null, record.status, record.deadlineAt, record.startedAt, record.finalizedAt ?? null, record.cancelledAt ?? null, record.disputedAt ?? null, record.timedOutAt ?? null],
      );
      if (method === "finalizeSettlement") {
        const [supersedeResult] = await connection.execute("UPDATE certificate_versions SET certificate_status='SUPERSEDED', superseded_at=? WHERE asset_id=? AND certificate_hash=? AND certificate_status='CURRENT'", [record.finalizedAt, record.assetId, record.oldCertificateHash]);
        if (supersedeResult?.affectedRows !== 1) throw new Error("CERTIFICATE_SUPERSEDE_CONFLICT");
        await this.appendCertificate(connection, { ...input.request.certificate, status: "CURRENT", supersededAt: null, sourceAuthority: input.request.certificateSourceId });
        const [assetResult] = await connection.execute("UPDATE assets SET current_certificate_hash=?, current_certificate_version=?, current_owner_commitment=?, oracle_status='VALID', evidence_version=?, updated_at=? WHERE asset_id=?", [input.request.certificate.certificateHash, input.request.certificate.certificateVersion, input.request.newOwnerCommitment, input.request.evidenceVersion, record.finalizedAt, record.assetId]);
        if (assetResult?.affectedRows !== 1) throw new Error("ASSET_PROJECTION_CONFLICT");
      } else {
        const oracleStatus = method === "beginSettlement" ? "TRANSFER_PENDING" : "REVIEW_REQUIRED";
        const updatedAt = method === "beginSettlement" ? record.startedAt : record.cancelledAt ?? record.disputedAt ?? record.timedOutAt;
        const [assetResult] = await connection.execute("UPDATE assets SET oracle_status=?, evidence_version=?, updated_at=? WHERE asset_id=?", [oracleStatus, input.request.evidenceVersion, updatedAt, record.assetId]);
        if (assetResult?.affectedRows !== 1) throw new Error("ASSET_PROJECTION_CONFLICT");
      }
      return;
    }
    if (method === "executeSourceDisable") {
      const [disableResult] = await connection.execute("UPDATE source_authorities SET active=FALSE, updated_at=UTC_TIMESTAMP(6) WHERE source_id=?", [input.sourceId]);
      if (disableResult?.affectedRows !== 1) {
        const [rows] = await connection.execute("SELECT active FROM source_authorities WHERE source_id=? FOR UPDATE", [input.sourceId]);
        if (rows.length !== 1 || ![false, 0, "0"].includes(rows[0].active)) throw new Error("SOURCE_PROJECTION_CONFLICT");
      }
    }
  }
}


