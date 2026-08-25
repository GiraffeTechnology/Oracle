export class FixedSourceTransportAdapter {
  constructor({ transport, sourceRegistration }) {
    if (!transport || typeof transport.fetch !== "function" || !sourceRegistration?.sourceId) {
      throw new Error("FIXED_SOURCE_TRANSPORT_INVALID");
    }
    this.transport = transport;
    this.registration = Object.freeze({ ...sourceRegistration });
  }

  async fetchByFixedReference(recordRef) {
    if (typeof recordRef !== "string" || !/^[a-zA-Z0-9._:-]{3,256}$/.test(recordRef)) {
      throw new Error("SOURCE_RECORD_REFERENCE_INVALID");
    }
    return this.transport.fetch({ sourceRegistrationId: this.registration.sourceId, recordRef });
  }

  async health() {
    return this.transport.health({ sourceRegistrationId: this.registration.sourceId });
  }
}
