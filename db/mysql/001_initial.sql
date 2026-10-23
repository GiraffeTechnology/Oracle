-- Giraffe RWA Oracle logical production schema.
-- No server address, credential, identity document or source evidence is embedded here.

CREATE TABLE source_authorities (
  source_id VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(200) NOT NULL,
  source_kind ENUM('REGISTRY','CERTIFICATE_AUTHORITY','WAREHOUSE') NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  key_set_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE schema_versions (
  schema_id VARCHAR(128) PRIMARY KEY,
  schema_hash CHAR(64) NOT NULL UNIQUE,
  status ENUM('ACTIVE','DEPRECATED','REVOKED') NOT NULL,
  effective_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE assets (
  asset_id VARCHAR(128) PRIMARY KEY,
  asset_fingerprint_hash CHAR(64) NOT NULL UNIQUE,
  wenbao_registry_ref VARCHAR(256) NOT NULL,
  classification_code VARCHAR(64) NULL,
  transfer_eligibility VARCHAR(32) NOT NULL,
  warehouse_id VARCHAR(128) NOT NULL,
  warehouse_receipt_hash CHAR(64) NOT NULL UNIQUE,
  current_certificate_hash CHAR(64) NOT NULL UNIQUE,
  current_certificate_version BIGINT UNSIGNED NOT NULL,
  current_owner_commitment CHAR(64) NOT NULL,
  encumbrance_status VARCHAR(64) NOT NULL,
  oracle_status VARCHAR(32) NOT NULL,
  evidence_version BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  source_authority VARCHAR(64) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE certificate_versions (
  asset_id VARCHAR(128) NOT NULL,
  token_id VARCHAR(128) NOT NULL,
  certificate_version BIGINT UNSIGNED NOT NULL,
  certificate_hash CHAR(64) NOT NULL UNIQUE,
  previous_certificate_hash CHAR(64) NULL,
  wenbao_change_ref VARCHAR(256) NOT NULL,
  warehouse_receipt_hash CHAR(64) NOT NULL,
  effective_at TIMESTAMP(6) NOT NULL,
  superseded_at TIMESTAMP(6) NULL,
  certificate_status ENUM('CURRENT','SUPERSEDED','REVOKED') NOT NULL,
  source_authority VARCHAR(64) NOT NULL,
  PRIMARY KEY (asset_id, certificate_version),
  CONSTRAINT fk_certificate_asset FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
) ENGINE=InnoDB;

CREATE TABLE warehouse_records (
  asset_id VARCHAR(128) PRIMARY KEY,
  warehouse_id VARCHAR(128) NOT NULL,
  warehouse_receipt_hash CHAR(64) NOT NULL UNIQUE,
  warehouse_status VARCHAR(32) NOT NULL,
  holder_commitment CHAR(64) NULL,
  encumbrance_status VARCHAR(64) NOT NULL,
  observed_at TIMESTAMP(6) NOT NULL,
  evidence_version BIGINT UNSIGNED NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  source_authority VARCHAR(64) NOT NULL,
  CONSTRAINT fk_warehouse_asset FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
) ENGINE=InnoDB;

CREATE TABLE token_bindings (
  asset_id VARCHAR(128) PRIMARY KEY,
  chain_id VARCHAR(64) NOT NULL,
  contract_ref VARCHAR(128) NOT NULL,
  token_id VARCHAR(128) NOT NULL,
  bound_at TIMESTAMP(6) NOT NULL,
  UNIQUE KEY uq_token_reference (chain_id, contract_ref, token_id),
  CONSTRAINT fk_token_binding_asset FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
) ENGINE=InnoDB;

CREATE TABLE attestations (
  attestation_id CHAR(36) PRIMARY KEY,
  asset_id VARCHAR(128) NOT NULL,
  envelope_hash CHAR(64) NOT NULL UNIQUE,
  signature TEXT NOT NULL,
  schema_version VARCHAR(128) NOT NULL,
  chain_id VARCHAR(64) NOT NULL,
  contract_ref VARCHAR(128) NOT NULL,
  token_id VARCHAR(128) NOT NULL,
  purpose VARCHAR(128) NOT NULL,
  fact_type VARCHAR(128) NOT NULL,
  fact_value_hash CHAR(64) NOT NULL,
  source_authority VARCHAR(64) NOT NULL,
  source_record_hash CHAR(64) NOT NULL,
  observed_at TIMESTAMP(6) NOT NULL,
  nonce VARCHAR(128) NOT NULL UNIQUE,
  revocation_ref VARCHAR(256) NULL,
  signer_set_id VARCHAR(64) NOT NULL,
  valid_from TIMESTAMP(6) NOT NULL,
  expires_at TIMESTAMP(6) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  INDEX idx_attestation_asset_current (asset_id, expires_at),
  CONSTRAINT fk_attestation_asset FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
) ENGINE=InnoDB;

CREATE TABLE revocations (
  attestation_id CHAR(36) PRIMARY KEY,
  reason_hash CHAR(64) NOT NULL,
  authority_id VARCHAR(64) NOT NULL,
  revoked_at TIMESTAMP(6) NOT NULL,
  CONSTRAINT fk_revocation_attestation FOREIGN KEY (attestation_id) REFERENCES attestations(attestation_id)
) ENGINE=InnoDB;

CREATE TABLE settlements (
  settlement_id VARCHAR(128) PRIMARY KEY,
  asset_id VARCHAR(128) NOT NULL,
  chain_id VARCHAR(64) NOT NULL,
  contract_ref VARCHAR(128) NOT NULL,
  token_id VARCHAR(128) NOT NULL,
  seller_wallet VARCHAR(128) NOT NULL,
  buyer_wallet VARCHAR(128) NOT NULL,
  snapshot_hash CHAR(64) NOT NULL UNIQUE,
  external_execution_ref VARCHAR(256) NOT NULL,
  old_certificate_hash CHAR(64) NOT NULL,
  new_certificate_hash CHAR(64) NULL,
  wenbao_change_ref VARCHAR(256) NULL,
  failure_reason_hash CHAR(64) NULL,
  settlement_status VARCHAR(32) NOT NULL,
  deadline_at TIMESTAMP(6) NOT NULL,
  started_at TIMESTAMP(6) NOT NULL,
  finalized_at TIMESTAMP(6) NULL,
  cancelled_at TIMESTAMP(6) NULL,
  disputed_at TIMESTAMP(6) NULL,
  timed_out_at TIMESTAMP(6) NULL,
  INDEX idx_settlement_deadline (settlement_status, deadline_at),
  CONSTRAINT fk_settlement_asset FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
) ENGINE=InnoDB;

CREATE TABLE audit_events (
  sequence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  subject_id VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  previous_hash CHAR(64) NOT NULL,
  event_hash CHAR(64) NOT NULL UNIQUE,
  occurred_at TIMESTAMP(6) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE outbox_events (
  event_id CHAR(36) PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  subject_id VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  published_at TIMESTAMP(6) NULL,
  dead_lettered_at TIMESTAMP(6) NULL,
  delivery_state_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  dead_letter_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  dead_letter_state_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  INDEX idx_outbox_pending (published_at, dead_lettered_at, created_at)
) ENGINE=InnoDB;

CREATE TABLE command_journal (
  idempotency_key VARCHAR(128) PRIMARY KEY,
  command_hash CHAR(64) NOT NULL,
  command_type VARCHAR(64) NOT NULL,
  command_status ENUM('PENDING','COMPLETED','FAILED') NOT NULL,
  result_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE production_state_snapshots (
  snapshot_id TINYINT UNSIGNED PRIMARY KEY,
  state_hash CHAR(64) NOT NULL,
  state_json JSON NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  CONSTRAINT chk_single_production_snapshot CHECK (snapshot_id = 1)
) ENGINE=InnoDB;



-- Source-receipt journal for fresh installations; matches migration 002.
-- InnoDB transaction-scoped row locks coordinate all processes and restarts.
-- Namespaced SHA-256 keys cover domain/token lanes, source/idempotency keys,
-- source/nonces, and chain/contract/segment identities. Do not delete lock rows
-- while a writer can run; deletion could split one logical lock into two.
CREATE TABLE IF NOT EXISTS source_receipt_journal_locks (
  lock_hash BINARY(32) PRIMARY KEY
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS source_receipt_journal (
  intent_hash BINARY(32) PRIMARY KEY,
  execution_reference VARBINARY(96) NOT NULL,
  source_id VARBINARY(128) NOT NULL,
  idempotency_key VARBINARY(128) NOT NULL,
  nonce_hash BINARY(32) NOT NULL,
  chain_id VARBINARY(78) NOT NULL,
  contract_address BINARY(20) NOT NULL,
  register_id BINARY(32) NOT NULL,
  token_id VARBINARY(78) NOT NULL,
  lane_hash BINARY(32) NOT NULL,
  segment_digest BINARY(32) NOT NULL,
  intent_json JSON NOT NULL,
  state ENUM('PREPARED','OBSOLETE','SUBMITTING','SUBMITTED','UNKNOWN','CONFIRMED','FAILED','REORGED','REJECTED') NOT NULL,
  transaction_hash BINARY(32) NULL,
  block_hash BINARY(32) NULL,
  block_number VARBINARY(78) NULL,
  projection_version VARBINARY(20) NULL,
  reason VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  UNIQUE KEY uq_source_receipt_execution (execution_reference),
  UNIQUE KEY uq_source_receipt_idempotency (source_id, idempotency_key),
  UNIQUE KEY uq_source_receipt_nonce (source_id, nonce_hash),
  UNIQUE KEY uq_source_receipt_segment (chain_id, contract_address, segment_digest),
  INDEX idx_source_receipt_lane (lane_hash, state),
  CONSTRAINT chk_source_receipt_confirmation CHECK (
    (state = 'CONFIRMED' AND transaction_hash IS NOT NULL AND block_hash IS NOT NULL AND block_number IS NOT NULL AND projection_version IS NOT NULL)
    OR (state = 'FAILED' AND transaction_hash IS NOT NULL AND block_hash IS NOT NULL AND block_number IS NOT NULL AND projection_version IS NULL)
    OR (state NOT IN ('CONFIRMED','FAILED') AND block_hash IS NULL AND block_number IS NULL AND projection_version IS NULL)
  ),
  CONSTRAINT chk_source_receipt_transaction CHECK (
    state NOT IN ('SUBMITTED','REORGED') OR transaction_hash IS NOT NULL
  ),
  CONSTRAINT chk_source_receipt_before_submission CHECK (
    state NOT IN ('PREPARED','OBSOLETE','SUBMITTING') OR transaction_hash IS NULL
  )
) ENGINE=InnoDB;
