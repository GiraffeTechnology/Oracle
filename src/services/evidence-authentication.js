import { evidenceHash } from "../domain/canonical-json.js";

const authenticatedBundles = new WeakSet();

export function sealAuthenticatedEvidence({ records, evidenceSources }) {
  const seal = Object.freeze({
    recordHashes: Object.freeze(Object.fromEntries(Object.entries(records).map(([name, record]) => [name, evidenceHash(record)]))),
    evidenceSources: Object.freeze({ ...evidenceSources }),
  });
  authenticatedBundles.add(seal);
  return seal;
}

export function assertAuthenticatedEvidence(seal, { records, evidenceSources }) {
  if (!authenticatedBundles.has(seal)) throw new Error("AUTHENTICATED_EVIDENCE_REQUIRED");
  for (const [name, record] of Object.entries(records)) {
    if (seal.recordHashes[name] !== evidenceHash(record) || seal.evidenceSources[name] !== evidenceSources[name]) throw new Error("AUTHENTICATED_EVIDENCE_SCOPE_MISMATCH");
  }
  return true;
}
