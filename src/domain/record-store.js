export class RecordStore {
  #assets = new Map();
  #certificates = new Map();
  #warehouse = new Map();

  putAsset(record) {
    const existing = this.#assets.get(record.assetId);
    if (existing && existing.assetFingerprintHash !== record.assetFingerprintHash) {
      throw new Error("ASSET_FINGERPRINT_CONFLICT");
    }
    const stored = Object.freeze({ ...record });
    this.#assets.set(record.assetId, stored);
    return stored;
  }

  appendCertificate(record) {
    const history = this.#certificates.get(record.assetId) ?? [];
    const current = history.at(-1);
    if (!current && record.certificateVersion !== 1) throw new Error("CERTIFICATE_INITIAL_VERSION_INVALID");
    if (current) {
      if (record.certificateVersion !== current.certificateVersion + 1) throw new Error("CERTIFICATE_VERSION_INVALID");
      if (record.previousCertificateHash !== current.certificateHash) throw new Error("CERTIFICATE_PREVIOUS_HASH_INVALID");
      if (record.certificateHash === current.certificateHash) throw new Error("CERTIFICATE_HASH_NOT_CHANGED");
    }
    if (history.some((item) => item.certificateHash === record.certificateHash)) {
      throw new Error("CERTIFICATE_HASH_ALREADY_USED");
    }
    const stored = Object.freeze({ ...record });
    this.#certificates.set(record.assetId, Object.freeze([...history, stored]));
    return stored;
  }

  putWarehouse(record) {
    const current = this.#warehouse.get(record.assetId);
    if (current && current.warehouseReceiptHash !== record.warehouseReceiptHash) {
      throw new Error("WAREHOUSE_RECEIPT_CONFLICT");
    }
    const stored = Object.freeze({ ...record });
    this.#warehouse.set(record.assetId, stored);
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
}

