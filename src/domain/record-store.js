export class RecordStore {
  #assets = new Map();
  #certificates = new Map();
  #warehouse = new Map();
  #assetByFingerprint = new Map();
  #assetByCertificateHash = new Map();
  #assetByWarehouseReceiptHash = new Map();
  #provenance = new Map();

  #provenanceKey(kind, assetId) {
    return `${kind}:${assetId}`;
  }

  #storeProvenance(kind, assetId, provenance) {
    if (provenance === null) return;
    if (!provenance?.sourceId || !provenance?.schemaVersion) throw new Error("RECORD_PROVENANCE_INVALID");
    this.#provenance.set(this.#provenanceKey(kind, assetId), Object.freeze({ ...provenance }));
  }

  assertAsset(record) {
    if (!record?.assetId || !record.assetFingerprintHash) throw new Error("ASSET_RECORD_INCOMPLETE");
    const existing = this.#assets.get(record.assetId);
    if (existing && existing.assetFingerprintHash !== record.assetFingerprintHash) {
      throw new Error("ASSET_FINGERPRINT_CONFLICT");
    }
    const claimedBy = this.#assetByFingerprint.get(record.assetFingerprintHash);
    if (claimedBy && claimedBy !== record.assetId) throw new Error("ASSET_FINGERPRINT_ALREADY_CLAIMED");
    return true;
  }

  putAsset(record, provenance = null) {
    this.assertAsset(record);
    const stored = Object.freeze({ ...record });
    this.#assets.set(record.assetId, stored);
    this.#assetByFingerprint.set(record.assetFingerprintHash, record.assetId);
    this.#storeProvenance("REGISTRY", record.assetId, provenance);
    return stored;
  }

  assertCertificate(record) {
    if (!record?.assetId || !record.certificateHash || !Number.isInteger(record.certificateVersion)) {
      throw new Error("CERTIFICATE_RECORD_INCOMPLETE");
    }
    const claimedBy = this.#assetByCertificateHash.get(record.certificateHash);
    if (claimedBy && claimedBy !== record.assetId) throw new Error("CERTIFICATE_HASH_ALREADY_CLAIMED");
    const history = this.#certificates.get(record.assetId) ?? [];
    const current = history.at(-1);
    if (!current && (record.certificateVersion !== 1 || record.previousCertificateHash != null)) throw new Error("CERTIFICATE_INITIAL_VERSION_INVALID");
    if (current) {
      if (record.certificateVersion !== current.certificateVersion + 1) throw new Error("CERTIFICATE_VERSION_INVALID");
      if (record.previousCertificateHash !== current.certificateHash) throw new Error("CERTIFICATE_PREVIOUS_HASH_INVALID");
      if (record.certificateHash === current.certificateHash) throw new Error("CERTIFICATE_HASH_NOT_CHANGED");
    }
    if (history.some((item) => item.certificateHash === record.certificateHash)) {
      throw new Error("CERTIFICATE_HASH_ALREADY_USED");
    }
    return true;
  }

  appendCertificate(record, provenance = null) {
    this.assertCertificate(record);
    const history = this.#certificates.get(record.assetId) ?? [];
    const stored = Object.freeze({ ...record });
    this.#certificates.set(record.assetId, Object.freeze([...history, stored]));
    this.#assetByCertificateHash.set(record.certificateHash, record.assetId);
    this.#storeProvenance("CERTIFICATE_AUTHORITY", record.assetId, provenance);
    return stored;
  }

  replaceCurrentCertificate(record, provenance, supersededAt) {
    this.assertCertificate(record);
    if (typeof supersededAt !== "string" || !supersededAt) throw new Error("CERTIFICATE_SUPERSEDED_AT_INVALID");
    const history = this.#certificates.get(record.assetId) ?? [];
    const current = history.at(-1);
    if (!current || (current.status !== undefined && current.status !== "CURRENT")) throw new Error("CERTIFICATE_CURRENT_REQUIRED");
    const superseded = Object.freeze({ ...current, status: "SUPERSEDED", supersededAt });
    const stored = Object.freeze({ ...record, status: "CURRENT", supersededAt: null });
    this.#certificates.set(record.assetId, Object.freeze([...history.slice(0, -1), superseded, stored]));
    this.#assetByCertificateHash.set(record.certificateHash, record.assetId);
    this.#storeProvenance("CERTIFICATE_AUTHORITY", record.assetId, provenance);
    return stored;
  }

  assertWarehouse(record) {
    if (!record?.assetId || !record.warehouseReceiptHash) throw new Error("WAREHOUSE_RECORD_INCOMPLETE");
    const current = this.#warehouse.get(record.assetId);
    if (current && current.warehouseReceiptHash !== record.warehouseReceiptHash) {
      throw new Error("WAREHOUSE_RECEIPT_CONFLICT");
    }
    const claimedBy = this.#assetByWarehouseReceiptHash.get(record.warehouseReceiptHash);
    if (claimedBy && claimedBy !== record.assetId) throw new Error("WAREHOUSE_RECEIPT_ALREADY_CLAIMED");
    return true;
  }

  putWarehouse(record, provenance = null) {
    this.assertWarehouse(record);
    const stored = Object.freeze({ ...record });
    this.#warehouse.set(record.assetId, stored);
    this.#assetByWarehouseReceiptHash.set(record.warehouseReceiptHash, record.assetId);
    this.#storeProvenance("WAREHOUSE", record.assetId, provenance);
    return stored;
  }

  getAsset(assetId) {
    return this.#assets.get(assetId) ?? null;
  }

  certificateHistory(assetId) {
    return [...(this.#certificates.get(assetId) ?? [])];
  }

  currentCertificate(assetId) {
    return this.#certificates.get(assetId)?.at(-1) ?? null;
  }

  getWarehouse(assetId) {
    return this.#warehouse.get(assetId) ?? null;
  }

  provenance(kind, assetId) {
    return this.#provenance.get(this.#provenanceKey(kind, assetId)) ?? null;
  }

  exportState() {
    return Object.freeze({ assets: [...this.#assets.values()], certificates: [...this.#certificates.values()].flat(), warehouse: [...this.#warehouse.values()], provenance: [...this.#provenance.entries()] });
  }

  importState(state) {
    if (this.#assets.size || this.#certificates.size || this.#warehouse.size || !state) throw new Error("RECORD_STATE_IMPORT_REJECTED");
    const provenance = new Map(state.provenance ?? []);
    for (const asset of state.assets ?? []) this.putAsset(asset, provenance.get(this.#provenanceKey("REGISTRY", asset.assetId)) ?? null);
    for (const certificate of state.certificates ?? []) this.appendCertificate(certificate, provenance.get(this.#provenanceKey("CERTIFICATE_AUTHORITY", certificate.assetId)) ?? null);
    for (const warehouse of state.warehouse ?? []) this.putWarehouse(warehouse, provenance.get(this.#provenanceKey("WAREHOUSE", warehouse.assetId)) ?? null);
  }
}

