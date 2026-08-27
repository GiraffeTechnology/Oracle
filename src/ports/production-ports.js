function abstractMethod(name) {
  throw new Error(`PORT_NOT_IMPLEMENTED:${name}`);
}

export class OracleRepositoryPort {
  transaction() { return abstractMethod("repository.transaction"); }
  getAsset() { return abstractMethod("repository.getAsset"); }
  appendCertificate() { return abstractMethod("repository.appendCertificate"); }
  appendAuditEvent() { return abstractMethod("repository.appendAuditEvent"); }
  recordOutboxAttempt() { return abstractMethod("repository.recordOutboxAttempt"); }
  recordOutboxDeadLetterAttempt() { return abstractMethod("repository.recordOutboxDeadLetterAttempt"); }
  markOutboxPublished() { return abstractMethod("repository.markOutboxPublished"); }
  markOutboxDeadLettered() { return abstractMethod("repository.markOutboxDeadLettered"); }
}

export class ProtectedSignerPort {
  signAttestation() { return abstractMethod("signer.signAttestation"); }
  publicSignerSet() { return abstractMethod("signer.publicSignerSet"); }
}

export class SourceTransportPort {
  fetchByFixedReference() { return abstractMethod("source.fetchByFixedReference"); }
  health() { return abstractMethod("source.health"); }
}

export class EventPublisherPort {
  publish() { return abstractMethod("events.publish"); }
  publishDeadLetter() { return abstractMethod("events.publishDeadLetter"); }
}

export function assertProductionPorts(ports) {
  const required = ["repository", "signer", "registrySource", "certificateSource", "warehouseSource", "eventPublisher", "monitoring", "alerting"];
  for (const name of required) {
    if (!ports?.[name]) throw new Error(`PRODUCTION_PORT_MISSING:${name}`);
  }
  return true;
}


