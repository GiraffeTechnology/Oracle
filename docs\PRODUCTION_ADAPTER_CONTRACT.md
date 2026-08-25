# Production adapter contract

Production adapters are deployment-owned implementations of the interfaces in `src/ports`. They must not
accept caller-selected network endpoints or credentials.

## Repository

- MySQL transactions must atomically update the current projection, append immutable history, append the
  audit event and enqueue the outbox event.
- Connection material is injected by the controlled deployment system and is never returned by health APIs.
- Reads used for attestation issuance must use a consistent transaction snapshot.

## Protected signer

- Production private keys remain in an HSM or equivalently protected signing service.
- The application submits only the canonical envelope hash and receives a signature plus public signer-set ID.
- Signer policy independently checks environment, schema, purpose, subject and maximum TTL.

## Sources

- Each source adapter has a fixed deployment registration and certificate/key pinning policy.
- A business request supplies only an approved source record reference, never an endpoint.
- Timeouts, schema disagreement and identity failure return unavailable/conflict, never guessed facts.

## Event publisher

- Publishes only outbox events after database commit.
- Delivery is at-least-once; consumers must use `eventId` for idempotency.
- Payloads contain hashes and non-sensitive status only.

The current PR contains interfaces and synthetic implementations, not production credentials or endpoints.
