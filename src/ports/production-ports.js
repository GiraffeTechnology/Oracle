function abstractMethod(name) {
  throw new Error(`PORT_NOT_IMPLEMENTED:${name}`);
}

export class OracleRepositoryPort {
  transaction() { return abstractMethod("repository.transaction"); }
  getAsset() { return abstractMethod("repository.getAsset"); }
  appendCertificate() { return abstractMethod("repository.appendCertificate"); }
  appendAuditEvent() { return abstractMethod("repository.appendAuditEvent"); }
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
}

export function assertProductionPorts(ports) {
  const required = ["repository", "signer", "registrySource", "certificateSource", "warehouseSource", "eventPublisher"];
  for (const name of required) {
    if (!ports?.[name]) throw new Error(`PRODUCTION_PORT_MISSING:${name}`);
  }
  return true;
}

