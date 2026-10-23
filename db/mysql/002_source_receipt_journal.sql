-- Oracle implementation-specific durable source-receipt admission journal.
-- Apply after 001_initial.sql through the deployment's existing migration process.
-- This migration is additive. It does not authorize a production database run.

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
