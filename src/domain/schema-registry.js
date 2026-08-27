const SAFE_VERSION = /^[a-z][a-z0-9._-]{2,127}$/;

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

function isRfc3339DateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText = "00", offsetMinuteText = "00"] = match;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText].map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return false;
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day && !Number.isNaN(Date.parse(value));
}

const MYSQL_TIMESTAMP_MIN_MS = Date.parse("1970-01-01T00:00:01.000Z");
const MYSQL_TIMESTAMP_MAX_MS = Date.parse("2038-01-19T03:14:07.499Z");

function validateProperty(field, value, definition) {
  const allowedTypes = Array.isArray(definition.type) ? definition.type : [definition.type];
  if (definition.type !== undefined && !allowedTypes.some((type) => matchesType(value, type))) {
    throw new Error(`PAYLOAD_FIELD_TYPE_INVALID:${field}`);
  }
  if (value === null) return;
  if (definition.enum && !definition.enum.includes(value)) throw new Error(`PAYLOAD_FIELD_ENUM_INVALID:${field}`);
  if (typeof value === "string") {
    if (definition.minLength !== undefined && value.length < definition.minLength) throw new Error(`PAYLOAD_FIELD_LENGTH_INVALID:${field}`);
    if (definition.maxLength !== undefined && value.length > definition.maxLength) throw new Error(`PAYLOAD_FIELD_LENGTH_INVALID:${field}`);
    if (definition.pattern && !definition.pattern.test(value)) throw new Error(`PAYLOAD_FIELD_PATTERN_INVALID:${field}`);
    if (definition.format === "date-time" && !isRfc3339DateTime(value)) throw new Error(`PAYLOAD_FIELD_FORMAT_INVALID:${field}`);
    if (definition.persistenceFormat === "mysql-timestamp") {
      const instant = Date.parse(value);
      if (!isRfc3339DateTime(value) || instant < MYSQL_TIMESTAMP_MIN_MS || instant > MYSQL_TIMESTAMP_MAX_MS) throw new Error(`PAYLOAD_FIELD_PERSISTENCE_RANGE_INVALID:${field}`);
    }
  }
  if (typeof value === "number") {
    if (definition.minimum !== undefined && value < definition.minimum) throw new Error(`PAYLOAD_FIELD_RANGE_INVALID:${field}`);
    if (definition.maximum !== undefined && value > definition.maximum) throw new Error(`PAYLOAD_FIELD_RANGE_INVALID:${field}`);
  }
}

export class SchemaRegistry {
  #schemas = new Map();

  register({ id, required = [], allowed = [], sensitive = [], properties = {} }) {
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
      properties: Object.freeze({ ...properties }),
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
      const definition = schema.properties[field];
      const nullAllowed = Array.isArray(definition?.type) && definition.type.includes("null");
      if (!(field in payload) || payload[field] === "" || (payload[field] === null && !nullAllowed)) {
        throw new Error(`PAYLOAD_REQUIRED_FIELD_MISSING:${field}`);
      }
    }
    for (const field of Object.keys(payload)) {
      if (!schema.allowed.includes(field)) throw new Error(`PAYLOAD_FIELD_NOT_ALLOWED:${field}`);
      const definition = schema.properties[field];
      if (definition) validateProperty(field, payload[field], definition);
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
  const assetId = Object.freeze({ type: "string", pattern: /^[a-zA-Z0-9_-]{3,128}$/ });
  const hash = Object.freeze({ type: "string", pattern: /^[a-f0-9]{64}$/ });
  const dateTime = Object.freeze({ type: "string", format: "date-time", persistenceFormat: "mysql-timestamp" });
  const shortString = Object.freeze({ type: "string", minLength: 1, maxLength: 128 });
  const status = Object.freeze({ type: "string", enum: ["VALID", "INVALID", "TRANSFER_PENDING", "FROZEN", "REVOKED", "EXPIRED", "REVIEW_REQUIRED", "NOT_VERIFIED"] });
  const registry = new SchemaRegistry();
  registry.register({
    id: "asset-record.v1",
    required: ["assetId", "assetFingerprintHash", "wenbaoRegistryRef", "transferEligibility", "warehouseId", "warehouseReceiptHash", "currentCertificateHash", "currentCertificateVersion", "currentOwnerCommitment", "encumbranceStatus", "oracleStatus", "updatedAt"],
    allowed: ["assetId", "assetFingerprintHash", "wenbaoRegistryRef", "classificationCode", "transferEligibility", "warehouseId", "warehouseReceiptHash", "currentCertificateHash", "currentCertificateVersion", "currentOwnerCommitment", "encumbranceStatus", "oracleStatus", "settlementId", "settlementSnapshotHash", "settlementBuyerCommitment", "updatedAt"],
    sensitive: ["currentOwnerCommitment", "warehouseId", "settlementBuyerCommitment"],
    properties: {
      assetId, assetFingerprintHash: hash, wenbaoRegistryRef: { type: "string", minLength: 1, maxLength: 256 },
      classificationCode: { type: "string", maxLength: 64 }, transferEligibility: status, warehouseId: shortString,
      warehouseReceiptHash: hash, currentCertificateHash: hash, currentCertificateVersion: { type: "integer", minimum: 1 },
      currentOwnerCommitment: hash, encumbranceStatus: { type: "string", maxLength: 64 }, oracleStatus: status,
      settlementId: assetId, settlementSnapshotHash: hash, settlementBuyerCommitment: hash, updatedAt: dateTime,
    },
  });
  registry.register({
    id: "certificate-record.v1",
    required: ["assetId", "tokenId", "certificateVersion", "certificateHash", "previousCertificateHash", "wenbaoChangeRef", "warehouseReceiptHash", "effectiveAt", "status"],
    allowed: ["assetId", "tokenId", "certificateVersion", "certificateHash", "previousCertificateHash", "wenbaoChangeRef", "warehouseReceiptHash", "effectiveAt", "supersededAt", "status", "settlementId", "settlementSnapshotHash", "settlementBuyerCommitment"],
    sensitive: ["settlementBuyerCommitment"],
    properties: {
      assetId, tokenId: shortString, certificateVersion: { type: "integer", minimum: 1 }, certificateHash: hash,
      previousCertificateHash: { type: ["string", "null"], pattern: /^[a-f0-9]{64}$/ },
      wenbaoChangeRef: { type: "string", minLength: 1, maxLength: 256 }, warehouseReceiptHash: hash,
      effectiveAt: dateTime, supersededAt: { type: ["string", "null"], format: "date-time", persistenceFormat: "mysql-timestamp" },
      status: { type: "string", enum: ["CURRENT", "SUPERSEDED", "REVOKED"] },
      settlementId: assetId, settlementSnapshotHash: hash, settlementBuyerCommitment: hash,
    },
  });
  registry.register({
    id: "warehouse-record.v1",
    required: ["assetId", "warehouseId", "warehouseReceiptHash", "warehouseStatus", "observedAt"],
    allowed: ["assetId", "warehouseId", "warehouseReceiptHash", "warehouseStatus", "holderCommitment", "encumbranceStatus", "settlementId", "settlementSnapshotHash", "settlementBuyerCommitment", "observedAt"],
    sensitive: ["holderCommitment", "warehouseId", "settlementBuyerCommitment"],
    properties: {
      assetId, warehouseId: shortString, warehouseReceiptHash: hash,
      warehouseStatus: { type: "string", enum: ["IN_CUSTODY", "FROZEN", "RELEASE_PENDING", "RELEASED", "REVIEW_REQUIRED"] },
      holderCommitment: hash, encumbranceStatus: { type: "string", maxLength: 64 },
      settlementId: assetId, settlementSnapshotHash: hash, settlementBuyerCommitment: hash, observedAt: dateTime,
    },
  });
  return registry;
}
