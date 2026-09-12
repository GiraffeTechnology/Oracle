import { createHash } from "node:crypto";

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("CANONICAL_NUMBER_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("CANONICAL_VALUE_UNSUPPORTED");
}

export function canonicalJson(value) {
  return canonicalize(value);
}

export function evidenceHash(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

