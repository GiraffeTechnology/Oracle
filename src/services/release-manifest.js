import { createHash } from "node:crypto";
import { canonicalJson } from "../domain/canonical-json.js";
export function createReleaseManifest(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("RELEASE_FILES_INVALID");
  const entries = files.map(({ path, bytes }) => ({ path, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") })).sort((a, b) => a.path.localeCompare(b.path));
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries), manifestSha256: createHash("sha256").update(canonicalJson(entries)).digest("hex") });
}
export function verifyReleaseManifest(manifest, files) {
  const current = createReleaseManifest(files);
  return current.manifestSha256 === manifest.manifestSha256 && JSON.stringify(current.entries) === JSON.stringify(manifest.entries);
}

