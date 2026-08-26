const SAFE_VERSION = /^[a-z][a-z0-9._-]{2,127}$/;

export class SchemaRegistry {
  #schemas = new Map();

  register({ id, required = [], allowed = [], sensitive = [] }) {
    if (typeof id !== "string" || !SAFE_VERSION.test(id)) throw new Error("SCHEMA_ID_INVALID");
    if (this.#schemas.has(id)) throw new Error("SCHEMA_ALREADY_EXISTS");
    const allowedSet = new Set(allowed);
    for (const field of required) {
      if (!allowedSet.has(field)) throw new Error("SCHEMA_REQUIRED_NOT_ALLOWED");
    }
    const schema = Object.freeze({
      id,
      required: Object.freeze([...new Set(required)].sort()),
      allowed: Object.freeze([...allowedSet].sort()),
      sensitive: Object.freeze([...new Set(sensitive)].sort()),
    });
    this.#schemas.set(id, schema);
    return schema;
  }

  validate(id, payload) {
    const schema = this.#schemas.get(id);
    if (!schema) throw new Error("SCHEMA_NOT_REGISTERED");
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("PAYLOAD_INVALID");
    }
    for (const field of schema.required) {
      if (!(field in payload) || payload[field] === null || payload[field] === "") {
        throw new Error(`PAYLOAD_REQUIRED_FIELD_MISSING:${field}`);
      }
    }
    for (const field of Object.keys(payload)) {
      if (!schema.allowed.includes(field)) throw new Error(`PAYLOAD_FIELD_NOT_ALLOWED:${field}`);
    }
    return Object.freeze({ ...payload });
  }

  publicProjection(id, payload) {
    const schema = this.#schemas.get(id);
    if (!schema) throw new Error("SCHEMA_NOT_REGISTERED");
    return Object.fromEntries(
      Object.entries(payload).filter(([field]) => !schema.sensitive.includes(field)),
    );
  }
}

export function createDefaultSchemaRegistry() {
  const registry = new SchemaRegistry();
  registry.register({
    id: "asset-record.v1",
    required: ["assetId", "assetFingerprintHash", "wenbaoRegistryRef", "transferEligibility", "warehouseId", "warehouseReceiptHash", "currentCertificateHash", "currentCertificateVersion", "currentOwnerCommitment", "encumbranceStatus", "oracleStatus", "updatedAt"],
    allowed: ["assetId", "assetFingerprintHash", "wenbaoRegistryRef", "classificationCode", "transferEligibility", "warehouseId", "warehouseReceiptHash", "currentCertificateHash", "currentCertificateVersion", "currentOwnerCommitment", "encumbranceStatus", "oracleStatus", "updatedAt"],
    sensitive: ["currentOwnerCommitment", "warehouseId"],
  });
  registry.register({
    id: "certificate-record.v1",
    required: ["assetId", "tokenId", "certificateVersion", "certificateHash", "wenbaoChangeRef", "warehouseReceiptHash", "effectiveAt", "status"],
    allowed: ["assetId", "tokenId", "certificateVersion", "certificateHash", "previousCertificateHash", "wenbaoChangeRef", "warehouseReceiptHash", "effectiveAt", "supersededAt", "status"],
  });
  registry.register({
    id: "warehouse-record.v1",
    required: ["assetId", "warehouseId", "warehouseReceiptHash", "warehouseStatus", "observedAt"],
    allowed: ["assetId", "warehouseId", "warehouseReceiptHash", "warehouseStatus", "holderCommitment", "encumbranceStatus", "observedAt"],
    sensitive: ["holderCommitment", "warehouseId"],
  });
  return registry;
}
