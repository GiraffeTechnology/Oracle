# Operations and production gates

The normative synthetic NFR-004 load and fault profile is `config/nfr-004-load-profile.json`. An acceptance report must cover exactly 240,000 measured requests, all twelve fault cases, the declared latency/backlog/resource limits, and zero application 5xx or process restarts. A shorter loopback smoke test is preflight evidence only.

## Environments

- `development`: local, loopback only, no external writes.
- `test`: synthetic evidence and ephemeral signing keys only.
- `production`: starts only through an absolute, regular deployment module whose SHA-256 is pinned by the
  controlled host. The module supplies persistent storage, a synchronous protected signer boundary,
  authenticated fixed-reference sources, admin authentication and operations adapters. Missing or changed
  pins fail before the listener starts.

## Required production dependencies

- MySQL with encrypted transport, least-privilege service identity, point-in-time recovery and audit logging.
- Protected signing service or HSM; keys must never be supplied through source control or application logs.
- Durable queue/outbox consumer with idempotent delivery.
- Approved source adapters whose endpoint and credentials are injected by the controlled deployment layer.
- Central logs with field allowlists and retention controls.

The application stores each authoritative projection, audit/outbox delta, durable idempotency result and a
hash-verified recovery snapshot in one MySQL transaction. A durability failure marks the runtime compromised;
all readiness, query and write routes then return fail-closed until a clean restart restores the last committed
snapshot. Production verification accepts only fixed source record references and never caller-submitted facts.
The production readiness route also requires an affirmative result from the deployment-owned dependency health
boundary; a truthy adapter object alone is never considered ready.
Production writes are serialized across runtime mutation, snapshot capture and commit. A durability failure
poisons the runtime before the next queued write begins; queued work is rejected until a clean restart.

## Recovery objectives for production approval

### Read-only command recovery observation

The public object returned by `bootstrapProductionApplication` (and by
`assembleProductionApplication`) exposes the supported operator programmatic API:

```js
const observation = await assembly.inspectCommandRecovery(
  authenticatedRequest,
  'verifyAsset',
  { idempotencyKey, evidenceReferences, evidenceVersion },
);
```

Invoke this only from a trusted operator integration in the existing managed
process. `authenticatedRequest` is verified afresh by the configured server-side
admin authenticator; the command input must not contain `actorId` or `adminOperations`
(including inherited properties). A submitted
actor is rejected rather than overriding the authenticated identity. Authentication
failure and changed roles fail closed before a command-store read. The current
actor must retain the original command permission and identity; another actor does
not reproduce the original command hash. Each observation uses its own copied,
immutable role snapshot, isolated from concurrent requests and the HTTP actor
registry. Audit recovery injects a server-owned `AdminOperations` using this same
request-local authorizer and enforces the existing export purpose/size gate; no
caller-supplied authorization capability is accepted.

Supply the original method and command fields (excluding `actorId` and `adminOperations`); only the
existing command method allowlist is accepted. Verification/finalization inputs
use the same canonicalization as their production write wrappers, without fetching
source records or invoking operations. The wrapper's two-argument
`controlPlane.inspectCommandRecovery(method, commandInput)` is for trusted in-process
callers only; operator integrations should use the authenticated assembly API above,
not reach through nested internal `controlPlane` properties.

The observation is available while the runtime is compromised and does not depend
on enabling external writes. It returns only `UNRESOLVED`, `CONFLICT`, or
`COMPLETED_OBSERVED`, together with `writeResumptionAllowed: false`. An absent or
pending record is unresolved, not proof of non-commit; a completed observation is
not approval to resume. No stored results or raw database/authenticator errors are
returned. Observation never clears compromised, retries the command, starts a
transaction, or changes existing background outbox behavior. Actual driver cleanup,
target identity, fencing and recovery approval remain separate requirements.

This is a programmatic operator interface, not a new HTTP endpoint or public browser
capability. Do not open existing write routes or relax their external-write gate to
reach it. Deploying an operator integration requires its own trusted host/interface
configuration; this source implementation does not constitute such a deployment.

- Proposed RPO: no acknowledged authoritative input may be lost.
- Proposed RTO: four hours for query restoration; final value requires operational approval.
- Quarterly restore, signer rotation and source-outage exercises.
- Reconciliation must compare asset, certificate, warehouse, settlement and audit-chain projections.

## Go/no-go

The repository is not sufficient to authorize production. Production requires accepted security, privacy
and legal reviews; verified backups; signer ceremony; source contracts; deployment inventory; rollback;
and written approval for each real asset class and jurisdiction.

