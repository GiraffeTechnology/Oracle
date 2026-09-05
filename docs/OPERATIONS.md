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

## Opt-in process-local repository drain

`assembleProductionApplication({ repositoryDrainEnabled: true, ... })` supports an
opt-in source-level admission/drain interface. The default is `false`; production
bootstrap does not enable it. This is not a deployed cutover procedure.

The opt-in requires the concrete MySQL repository and its fixed pool. Commands and
whole outbox/background batches share one gate, one Durable write queue, and the
same-key in-flight deduplication map. Consumers receive scoped capabilities, not
the raw pool or repository. Admitted source requests remain tracked even when a
parallel sibling rejects early. Normal authorization/business rejections do not
poison admission; actual repository/driver failures independently close it.

Call `assembly.repositoryLifecycle.quiesce({ timeoutMs })` to stop new background
scheduling and close new command/batch admission. Readiness becomes false. A
normal drain waits for admitted work and cleanup. Failure or timeout is sticky
`BLOCKED`; late completions do not reopen admission. Already dispatched external
operations are not cancelled. A blocked gate prevents further repository,
publisher, source and queued command dispatch through these scoped interfaces.

HTTP admin writes rejected with `REPOSITORY_ADMISSION_CLOSED` or
`REPOSITORY_SCOPE_CLOSED` return 503, not an invalid-input 400. This does not add
automatic retries or a `Retry-After` promise. In particular, an unresolved prior
transaction must still be investigated through the controlled recovery procedure;
service unavailability never proves that a command was not committed.

The opt-in control plane also rechecks admission before each broker `rotate`,
`reconcile` and `activateRuntime` dispatch. Normal draining permits an admitted
flow to finish; `BLOCKED` prevents a new activation after a pending broker reply.
This does not cancel an already dispatched broker operation or prove rotation
was not applied. Recovery-required memory is not proof of persisted recovery;
closed repository admission never permits a bypass write. The authenticated
read-only command observation remains available without reopening admission.

The public admin facade permits authorized dashboard snapshots and export
authorization checks, but direct `adminOperations.exportAudit` is rejected.
Export only through `controlPlane.exportAudit`: the assembly injects a private,
server-owned capability and the existing Durable command persists the audit event.
Caller-supplied capabilities other than the assembly's public facade are rejected.

Authenticated recovery observation remains a separately counted read-only command
lookup; it neither unlocks writes nor authorizes pool closure. Snapshots always
report `poolCloseAllowed: false` and `writeResumptionAllowed: false`, including
after `DRAINED`. The deployment owner must not use its retained raw pool outside
the gate. No pool replacement, close, resume or promotion API is provided.

This process-local slice does not establish cross-process fencing, HTTP shutdown,
signer/custody lifecycle isolation, replication, real driver failure injection,
PITR, RPO/RTO or a target migration. Already dispatched signer internals and
production shutdown coordination remain separate work. Synthetic local tests and source
review are not target deployment evidence or human approval.

## Unwired HTTP shutdown coordinator

`createHttpShutdownCoordinator({ requestHandler, repositoryLifecycle })` creates
an owned HTTP server and a one-way `shutdown({ timeoutMs })` interface. It is not
connected to `createApp`, `main`, bootstrap or process signals. No deployment
flag enables it. This is a local source component, not a tested SIGTERM rollout.

The owner must return/await the handler's asynchronous business work or register
children with the supplied `track(() => operation())` capability before dispatch.
Response `finish`, client disconnect and the server-close callback do not erase
that work. The coordinator counts responses, handler work, registered children,
sockets and pending cleanup, and also requires a drained repository lifecycle.
Unregistered detached work and upgraded protocols are outside this contract.
Do not add bypass request listeners or re-listen on the owned server after shutdown.

Shutdown closes HTTP admission synchronously, invokes repository quiescence and
stops new connections. Existing keep-alive requests cannot start new handlers.
Concurrent calls share one close attempt and the earliest monotonic deadline;
an earlier deadline is propagated to repository quiescence. Normal admitted work
may finish. Timeout or failure is sticky `BLOCKED`, with late work still counted.
Idle-connection cleanup never destroys an active response or cancels business.
Terminal shutdown calls do not retry failed cleanup. There is no `process.exit`,
pool close, restart, target promotion or permission to resume writes; snapshots
always retain `poolCloseAllowed: false` and `writeResumptionAllowed: false`.

## Go/no-go

The repository is not sufficient to authorize production. Production requires accepted security, privacy
and legal reviews; verified backups; signer ceremony; source contracts; deployment inventory; rollback;
and written approval for each real asset class and jurisdiction.

