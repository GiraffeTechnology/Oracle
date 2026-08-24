# Giraffe RWA Oracle implementation status

## Current milestone

- Milestone: M6 L2–L3 configured candidate
- Iteration: 0–12
- Status: all 13 development iterations and repository-owned L2–L3 configuration are implemented; external production commissioning and approval blockers remain
- Network access used: no
- Production data used: no
- External writes: disabled by code
- Mainnet or blockchain writes: not implemented

## Implemented

- Oracle-only Node.js service skeleton using built-in modules only.
- Fail-closed configuration with development/test environments only.
- Loopback-only HTTP binding.
- External write enablement rejected.
- Public Oracle status vocabulary from the PRD.
- In-memory source registry with fixed source kinds and schema allowlists.
- Caller-supplied URL/endpoint fields rejected.
- Health, readiness and status-list endpoints.
- Repository scan for common credential material and non-loopback IPv4 literals.
- Synthetic unit and HTTP tests.
- Accepted Oracle-only architecture decision record.
- Initial trust-boundary threat model with iteration-mapped controls.
- Deterministic evidence hashing and versioned schema registry.
- Append-only asset, certificate, warehouse and audit projections.
- Strict Oracle state transitions and evidence-version ordering.
- Ed25519 synthetic attestation issue/verify, subject binding, expiry and revocation.
- T+0/T+N settlement begin/finalize/cancel coordination.
- Synthetic authority adapter and offline consumer SDK.
- Read-only asset, certificate and settlement APIs plus computational attestation verification.
- Read-only admin status UI with browser security headers.
- Logical MySQL schema, reliable outbox model, operations guide, release checklist and SBOM.
- Signed ingestion with source key-set lifecycle, time-window, nonce and command idempotency.
- RBAC control plane, dual-control revocation and protected production-port adapters.
- One-to-one token binding index, token eligibility API, outbox dispatcher, reconciliation and metrics.
- Complete non-secret L2 production profile with deployment-owned references and strict validation.
- L3 Working Draft v0.1.1 profile pinned by five artifact hashes, three required interface IDs and explicit state mapping.
- Artifact-byte, interface advertisement, pending-transfer and atomic-finalization compatibility gates.
- Redacted public L2/L3 profile endpoints and protected production dependency assembly.

## Verification baseline

```text
node --check: pass
node --test: 63 passed, 0 failed in the latest Oracle-scoped run
repository-scan: pass
```

## Remaining before production approval

- Run repository-owned CI after the pull request is opened; this task must not manually trigger or rerun CI.
- Commission production MySQL, protected signer infrastructure and durable event delivery.
- Resolve the configured deployment references to commissioned, contract-approved authenticated source adapters.
- Complete restore, source-outage, signer-rotation and incident-response exercises.
- Obtain independent security, privacy and legal acceptance plus written production go/no-go.

## Iteration coverage

| Iteration | Candidate result |
| --- | --- |
| I0 | Engineering baseline and safety defaults |
| I1 | Source and schema allowlists |
| I2 | Deterministic canonicalization and evidence hashing |
| I3 | Append-only record store and MySQL logical schema |
| I4 | Strict Oracle state machine |
| I5 | Synthetic attestation signing and offline verification |
| I6 | Read-only query API and minimal disclosure |
| I7 | Revocation registry and audit events |
| I8 | T+0/T+N settlement coordinator |
| I9 | Source adapter contracts, fixed references and complete deployment profile; real source commissioning blocked |
| I10 | Read-only admin UI and immutable audit journal |
| I11 | Consumer SDK plus pinned L3 protocol profile and compatibility gates |
| I12 | Security/operations docs, full non-secret production configuration, SBOM, container recipe and release gates |

