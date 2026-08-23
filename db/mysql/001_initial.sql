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
  registry_ref_hash CHAR(64) NOT NULL,
  owner_commitment CHAR(64) NULL,
  current_status VARCHAR(32) NOT NULL,
  evidence_version BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE certificate_versions (
  asset_id VARCHAR(128) NOT NULL,
  certificate_version BIGINT UNSIGNED NOT NULL,
  certificate_hash CHAR(64) NOT NULL UNIQUE,
  previous_certificate_hash CHAR(64) NULL,
  effective_at TIMESTAMP(6) NOT NULL,
  superseded_at TIMESTAMP(6) NULL,
  PRIMARY KEY (asset_id, certificate_version),
  CONSTRAINT fk_certificate_asset FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
) ENGINE=InnoDB;

CREATE TABLE warehouse_records (
  asset_id VARCHAR(128) PRIMARY KEY,
  warehouse_receipt_hash CHAR(64) NOT NULL UNIQUE,
  warehouse_status VARCHAR(32) NOT NULL,
  holder_commitment CHAR(64) NULL,
  evidence_version BIGINT UNSIGNED NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  CONSTRAINT fk_warehouse_asset FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
) ENGINE=InnoDB;

CREATE TABLE attestations (
  attestation_id CHAR(36) PRIMARY KEY,
  asset_id VARCHAR(128) NOT NULL,
  envelope_hash CHAR(64) NOT NULL UNIQUE,
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
  snapshot_hash CHAR(64) NOT NULL UNIQUE,
  settlement_status VARCHAR(32) NOT NULL,
  deadline_at TIMESTAMP(6) NOT NULL,
  registry_change_ref_hash CHAR(64) NULL,
  started_at TIMESTAMP(6) NOT NULL,
  finalized_at TIMESTAMP(6) NULL,
  cancelled_at TIMESTAMP(6) NULL,
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
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  INDEX idx_outbox_pending (published_at, created_at)
) ENGINE=InnoDB;

