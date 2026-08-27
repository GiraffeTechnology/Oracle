# Production adapter contract

Production adapters are deployment-owned implementations of the interfaces in `src/ports`. They must not
accept caller-selected network endpoints or credentials.

## Repository

- MySQL transactions must atomically update the current projection, append immutable history, append the
  audit event and enqueue the outbox event.
- Connection material is injected by the controlled deployment system and is never returned by health APIs.
- Reads used for attestation issuance must use a consistent transaction snapshot.
- Every committed mutation stores the durable idempotency result and a hash-verified runtime recovery snapshot
  in the same transaction. Startup rejects a changed snapshot; a commit failure blocks all non-liveness routes.

## Protected signer

- Production private keys remain in an HSM or equivalently protected signing service.
- The application submits only the canonical envelope hash and receives a signature plus public signer-set ID.
- The protected callback receives exactly the 32-byte SHA-256 of canonical envelope JSON, never the complete
  asset/token/fact envelope.
- Signer policy independently checks environment, schema, purpose, complete subject scope and maximum TTL
  through `authorizeAttestation` before any signing callback is invoked.
- A rotation is not complete when only the public signer-set identifier changes. The protected rotation
  adapter must atomically replace the runtime signing backend, verification backend and signer policy, then
  return only the activated public signer-set identifier and `privateMaterialIncluded=false`.
- The control plane never accepts a private key, mnemonic, key path or raw key reference. Runtime activation
  is performed through the deployment-owned `activateRuntime` broker operation and is fail-closed if the
  active runtime signer set does not exactly match the approved destination set.
- The resolved signer port is also the fixed rotation broker and must implement `rotate`, `reconcile` and
  `activateRuntime`; production startup fails before listening when any operation is absent.
- Runtime `signBytes` and `verifyBytes` callbacks are synchronous-only. The deployment adapter must expose a
  synchronous local protected-broker boundary; Promise/thenable results are rejected fail-closed and must not
  be coerced into signature bytes or truthy verification results.
- Startup also requires a synchronous `verifyHistoricalBytes(signerSetId, bytes, signature)` boundary backed
  by the protected public signer-set history. Recovery verifies every stored attestation with the signer set
  named in its envelope; it never tests historical records only against the currently active key.
- Every activation must atomically install a matching `ACTIVE` destination `SignerSetPolicy`; omission,
  mismatch, retirement or revocation fails before the active backend is changed.
- After activation, an attestation produced by the old backend must fail local verification and a newly
  issued attestation must advertise and verify under the new signer set. Ambiguous activation remains in
  `RECOVERY_REQUIRED` until the broker affirmatively reconciles `applied=true`. Reconciliation accepts only
  the exact approved source or destination runtime set and does not replay activation when the destination
  was already installed before an acknowledgement was lost.

## Sources

- Each source adapter has a fixed deployment registration and certificate/key pinning policy.
- A business request supplies only an approved source record reference, never an endpoint.
- Timeouts, schema disagreement and identity failure return unavailable/conflict, never guessed facts.

## Event publisher

- Publishes only outbox events after database commit.
- Production assembly installs the resolved publisher in the outbox dispatcher, and production startup starts
  its single non-overlapping drain worker. Failed publishes remain pending for retry; the dispatcher never
  turns an unacknowledged publish into a successful delivery.
- The publisher must also implement idempotent `publishDeadLetter(event)`. After the fixed retry limit, the
  dispatcher forwards the complete non-sensitive event to that durable channel and emits a monitoring event;
  a failed dead-letter publish remains pending and raises a stable monitoring failure.
- Delivery is at-least-once; consumers must use `eventId` for idempotency.
- Payloads contain hashes and non-sensitive status only.

## Readiness

- The deployment monitoring port supplies one fixed `checkReadiness` boundary covering MySQL, all three
  authoritative sources, the event publisher and required operations dependencies.
- Production `/readyz` returns 200 only for an affirmative result and returns a stable 503 error otherwise.
  Liveness remains separate and does not claim that dependencies are ready.

The current PR contains the production assembly, fixed-reference source gate, MySQL durability/recovery adapter
and synthetic tests. It contains no production credentials or endpoints; deployment-owned adapter modules must
be absolute regular files with exact SHA-256 pins and remain independently reviewable.

