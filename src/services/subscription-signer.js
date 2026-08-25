import { sign, verify } from "node:crypto";
import { canonicalJson } from "../domain/canonical-json.js";

function bytes(envelope) { return Buffer.from(canonicalJson(envelope), "utf8"); }
export class SubscriptionSigner {
  constructor({ signerSetId, privateKey, publicKey }) {
    if (!signerSetId || !privateKey || !publicKey) throw new Error("SUBSCRIPTION_SIGNER_INVALID");
    Object.assign(this, { signerSetId, privateKey, publicKey });
  }
  issue({ deliveryId, eventId, payloadHash, issuedAt }) {
    if (![deliveryId, eventId, payloadHash, issuedAt].every(Boolean)) throw new Error("SUBSCRIPTION_ENVELOPE_INVALID");
    const envelope = Object.freeze({ schemaVersion: "giraffe-subscription.v1", signerSetId: this.signerSetId, deliveryId, eventId, payloadHash, issuedAt });
    return Object.freeze({ envelope, signature: sign(null, bytes(envelope), this.privateKey).toString("base64url") });
  }
  verify(candidate, expectedDeliveryId) {
    if (candidate?.envelope?.deliveryId !== expectedDeliveryId) return false;
    return verify(null, bytes(candidate.envelope), this.publicKey, Buffer.from(candidate.signature, "base64url"));
  }
}
