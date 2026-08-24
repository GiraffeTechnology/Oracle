import { createHash, randomUUID } from "node:crypto";

export class EvidenceVaultPort {
  store() { throw new Error("PORT_NOT_IMPLEMENTED:evidence.store"); }
  retrieve() { throw new Error("PORT_NOT_IMPLEMENTED:evidence.retrieve"); }
}

export class SyntheticEvidenceVault extends EvidenceVaultPort {
  #records = new Map();

  store(bytes, { schemaVersion, sourceId }) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || !schemaVersion || !sourceId) throw new Error("EVIDENCE_INPUT_INVALID");
    const evidenceRef = `evidence:${randomUUID()}`;
    const evidenceSha256 = createHash("sha256").update(bytes).digest("hex");
    this.#records.set(evidenceRef, { bytes: Buffer.from(bytes), schemaVersion, sourceId, evidenceSha256 });
    return Object.freeze({ evidenceRef, evidenceSha256, byteLength: bytes.byteLength, schemaVersion, sourceId });
  }

  retrieve(evidenceRef, capability) {
    if (capability !== "evidence:read:synthetic") throw new Error("EVIDENCE_ACCESS_DENIED");
    const record = this.#records.get(evidenceRef);
    if (!record) throw new Error("EVIDENCE_NOT_FOUND");
    return Buffer.from(record.bytes);
  }
}

