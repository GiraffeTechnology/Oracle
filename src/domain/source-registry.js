const SOURCE_KINDS = new Set(["REGISTRY", "CERTIFICATE_AUTHORITY", "WAREHOUSE"]);
const SAFE_IDENTIFIER = /^[a-z][a-z0-9-]{2,63}$/;
const SAFE_SCHEMA_VERSION = /^[a-z][a-z0-9._-]{2,127}$/;

function requireSafeIdentifier(value, errorCode) {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
    throw new Error(errorCode);
  }
  return value;
}

function normalizeSchemas(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("SOURCE_SCHEMA_REQUIRED");
  }

  const unique = [...new Set(values)];
  if (unique.some((value) => typeof value !== "string" || !SAFE_SCHEMA_VERSION.test(value))) {
    throw new Error("SOURCE_SCHEMA_INVALID");
  }
  return Object.freeze(unique.sort());
}

function normalizeSource(source) {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("SOURCE_INVALID");
  }
  if ("url" in source || "endpoint" in source || "rpcUrl" in source) {
    throw new Error("CALLER_SUPPLIED_ENDPOINT_REJECTED");
  }
  if (!SOURCE_KINDS.has(source.kind)) {
    throw new Error("SOURCE_KIND_INVALID");
  }
  if (typeof source.displayName !== "string" || source.displayName.trim().length < 2) {
    throw new Error("SOURCE_DISPLAY_NAME_INVALID");
  }

  return Object.freeze({
    id: requireSafeIdentifier(source.id, "SOURCE_ID_INVALID"),
    displayName: source.displayName.trim(),
    kind: source.kind,
    keySetId: requireSafeIdentifier(source.keySetId, "SOURCE_KEY_SET_INVALID"),
    schemaVersions: normalizeSchemas(source.schemaVersions),
    active: source.active === true,
  });
}

export class SourceRegistry {
  #sources = new Map();

  constructor(sources = []) {
    for (const source of sources) this.add(source);
  }

  add(source) {
    const normalized = normalizeSource(source);
    if (this.#sources.has(normalized.id)) throw new Error("SOURCE_ALREADY_EXISTS");
    this.#sources.set(normalized.id, normalized);
    return normalized;
  }

  requireActive(sourceId, schemaVersion) {
    const source = this.#sources.get(sourceId);
    if (!source) throw new Error("SOURCE_NOT_REGISTERED");
    if (!source.active) throw new Error("SOURCE_INACTIVE");
    if (!source.schemaVersions.includes(schemaVersion)) {
      throw new Error("SOURCE_SCHEMA_NOT_ALLOWED");
    }
    return source;
  }

  listPublic() {
    return [...this.#sources.values()].map(({ id, displayName, kind, schemaVersions, active }) => ({
      id,
      displayName,
      kind,
      schemaVersions: [...schemaVersions],
      active,
    }));
  }
}

