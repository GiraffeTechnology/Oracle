import { verify } from "node:crypto";
import { canonicalJson, evidenceHash } from "../domain/canonical-json.js";

const FORBIDDEN_KEYS = new Set(["url", "endpoint", "rpcUrl", "rpc_url", "command", "shell"]);

function rejectForbiddenKeys(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`CALLER_CONTROLLED_FIELD_REJECTED:${key}`);
    rejectForbiddenKeys(child);
  }
}

export class IngestionGateway {
  #idempotency = new Map();
  #nonces = new Set();

  constructor({ sourceRegistry, schemaRegistry, keySetRegistry, clock = () => new Date(), maxClockSkewSeconds = 300, maxPayloadBytes = 262144 }) {
    Object.assign(this, { sourceRegistry, schemaRegistry, keySetRegistry, clock, maxClockSkewSeconds, maxPayloadBytes });
  }

  ingest({ envelope, signature }) {
    if (!envelope || typeof signature !== "string") throw new Error("INGESTION_REQUEST_INVALID");
    rejectForbiddenKeys(envelope);
    const encoded = Buffer.from(canonicalJson(envelope), "utf8");
    if (encoded.length > this.maxPayloadBytes) throw new Error("INGESTION_PAYLOAD_TOO_LARGE");
    const issuedAt = new Date(envelope.issuedAt);
    const now = this.clock();
    if (Number.isNaN(issuedAt.getTime()) || Math.abs(now - issuedAt) > this.maxClockSkewSeconds * 1000) {
      throw new Error("INGESTION_TIME_WINDOW_INVALID");
    }
    if (!envelope.nonce || !envelope.idempotencyKey) throw new Error("INGESTION_REPLAY_FIELDS_REQUIRED");
    const source = this.sourceRegistry.requireActive(envelope.sourceId, envelope.schemaVersion);
    const keySet = this.keySetRegistry.requireValid(source.keySetId, issuedAt);
    if (!verify(null, encoded, keySet.publicKey, Buffer.from(signature, "base64url"))) {
      throw new Error("INGESTION_SIGNATURE_INVALID");
    }
    const validated = this.schemaRegistry.validate(envelope.schemaVersion, envelope.payload);
    const requestHash = evidenceHash(envelope);
    const prior = this.#idempotency.get(envelope.idempotencyKey);
    if (prior && prior.requestHash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
    if (prior) return Object.freeze({ ...prior, replayed: true });
    if (this.#nonces.has(`${envelope.sourceId}:${envelope.nonce}`)) throw new Error("NONCE_REPLAYED");
    this.#nonces.add(`${envelope.sourceId}:${envelope.nonce}`);
    const result = Object.freeze({
      sourceId: envelope.sourceId,
      schemaVersion: envelope.schemaVersion,
      requestHash,
      sourceRecordHash: evidenceHash(validated),
      publicPayload: Object.freeze(this.schemaRegistry.publicProjection(envelope.schemaVersion, validated)),
      receivedAt: now.toISOString(),
      replayed: false,
    });
    this.#idempotency.set(envelope.idempotencyKey, result);
    return result;
  }
}

