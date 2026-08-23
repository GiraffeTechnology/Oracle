export function verifyOracleAttestation(attestationService, attestation, expectedSubject, now) {
  if (!attestationService || typeof attestationService.verify !== "function") {
    throw new Error("VERIFIER_SERVICE_INVALID");
  }
  return attestationService.verify(attestation, { expectedSubject, now });
}

export function requireValidOracleAttestation(attestationService, attestation, expectedSubject, now) {
  const result = verifyOracleAttestation(attestationService, attestation, expectedSubject, now);
  if (!result.valid) throw new Error(`ATTESTATION_REJECTED:${result.errorCode}`);
  return attestation.envelope;
}

