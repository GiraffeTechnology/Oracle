# Giraffe RWA Oracle PRD v0.3 and 13-Iteration Delivery Acceptance Map

> The authoritative requirements and acceptance rules are PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md v0.3 and ACCEPTANCE_RWA_ORACLE_ZH.md v0.3. I0–I12 define delivery order only; the machine map is config/iteration-acceptance.json and must not override or weaken ORACLE/CONSUMER/NFR requirements.

## 0. Document control

| Item | Content |
| --- | --- |
| Purpose | Map each of the PRD's 13 iterations to verifiable delivery criteria |
| Authoritative PRD | docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md v0.3 |
| Scope | Giraffe RWA Oracle L2 and its configuration, verification, and compatibility boundary with the independent L3 protocol |
| Iterations | I0–I12, 13 total |
| Delivery standard | Repeatable, auditable, reviewable, with visible failures |
| Status rule | An iteration without complete evidence must be BLOCKED or INCOMPLETE, never complete |
| Does not mean | Production launch, mainnet authorization, real-asset enablement, regulatory approval, or an official ERC number |

This file does not replace the PRD. The PRD decides what must be delivered; this file decides what evidence proves delivery. If they conflict, the stricter PRD requirement prevails. Do not lower PRD exit criteria by changing this file.

## 1. Definition of verifiable delivery

A feature counts toward iteration completion only when all of the following evidence exists:

1. **Implementation:** identifiable source, schema, migration, configuration, API, SDK, or operations artifact.
2. **Positive case:** normal input produces the PRD-required result.
3. **Negative cases:** unknown sources, invalid state, excess permission, replay, expiration, conflict, limit violation, and faults are rejected deterministically.
4. **Recovery:** failure creates no partial write; retries are idempotent; state agrees after service/dependency recovery.
5. **Security:** secrets, personal data, original certificates, real endpoints, and unapproved production configuration do not enter the repository, logs, or artifacts.
6. **Command:** a third party can repeat the documented verification command in a clean environment.
7. **Result:** record test count, pass/fail counts, blockers, time, environment, and tool versions.
8. **Integrity:** critical inputs, outputs, and release artifacts have SHA-256 or equivalent integrity evidence.
9. **Traceability:** every PRD requirement maps to tests, files, and acceptance results.
10. **Honest status:** inability to execute, external approval dependencies, or missing evidence are explicitly blocked; disclaimers do not substitute for tests.

None of these alone proves completion: code presence, a completion claim in documentation, empty interface implementations, mocks that only return success, an unexecuted test plan, a created PR, unread CI, or an unverifiable verbal report from another task.

## 2. Unified Definition of Done

The ten unified DoD requirements in PRD §22 apply to every iteration I0–I12.

| PRD DoD | Required standard | Minimum verifiable evidence |
| --- | --- | --- |
| Version consistency | PRD, ADR, schema, interface, and implementation use one version | Version-check script and file inventory; fail on mismatch |
| Test coverage | New paths have positive, negative, authorization, idempotency, replay, and recovery tests | Named-test list and run results |
| Engineering gates | lint, typecheck, unit, integration, secret, sensitive-field, and address scans pass | Repeatable commands, exit codes, reports |
| Data security | No credentials, private keys, personal data, original certificates, or production configuration | Repository/artifact/log scan results |
| Secure defaults | No default public writes, real sources, mainnet, or funds path | Configuration-negative and startup-gate tests |
| Testnet validation | ArtFi1–ArtFi9 use only valueless test assets; after approved gates, actual test-chain interactions are completed | Chain identity, simulation, receipt, finality, nonce, and mainnet-rejection evidence |
| Synchronized documents | Threat model, data flow, runbook, and rollback plan are synchronized | Document paths, versions, review record |
| Acceptance report | Report lists commands, results, limits, and incomplete items | Hashed per-iteration report |
| Explicit blockers | Failed items remain blocked | Machine-readable BLOCKED result and errorCode |
| Scope isolation | No responsibility for ERC numbering, NFT issuance, or financial business | Scope scan and negative API/code tests |
| Reproducible artifacts | Working tree and release artifacts are complete and reproducible | Clean-tree/manifest/SHA-256/rebuild comparison |

If any unified DoD item is unmet, the corresponding iteration must not be marked COMPLETE.

## 3. I0–I12 PRD and evidence map

### I0: Scope freeze and engineering baseline

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| Separate Oracle from ERC, trading, and financial business | ADR, directory, and dependency scans prove no ERC submission, NFT issuance, funds, or trade-execution entry point |
| Engineering skeleton, fixed runtime, and lockfile | Clean environment builds offline or from an approved cache with fixed Node/package manager and lockfile |
| lint/typecheck/unit/secret/IP/dependency audit | Each gate has its own command, nonzero failure code, and summary report |
| Synthetic environment; external writes disabled by default | Negative tests for development/test/production configuration; network and writes off by default |
| No sensitive data or retired branding | Repository and release-artifact scans pass |

**Completion:** engineering baseline builds reproducibly, all writes default to disabled, and every scan passes.

### I1: Schema registry and source registry

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| SourceAuthority/SourceKeySet/SchemaVersion/BusinessCalendar | Versioned models, serialization contracts, and unit tests |
| Source activation/deactivation, key rotation, schema compatibility | Lifecycle positive/negative tests, including retired/revoked/expired |
| Asset, certificate, warehouse receipt, owner commitment, freeze, change JSON Schemas | Independent validator runs; extra and sensitive fields are rejected |
| Reject unknown sources, arbitrary URLs, expired keys, unknown schemas | All ORACLE-001 negative vectors pass |

**Completion:** callers cannot select endpoints or bypass the registry; every source/schema fails closed.

### I2: Ingestion gateway and evidence normalization

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| Signature, time window, nonce, idempotency, replay, and size limits | Boundary and attack-vector test for each |
| JCS or approved equivalent canonicalization | Published specification, cross-implementation vectors, insertion-order-independence tests |
| Encoding, time, units, null values, and field ordering | Specification and single-byte-change tests |
| Isolated raw-evidence storage and public summaries | Evidence Vault port, no-public-read test, sensitive-field projection test |

**Completion:** identical semantic inputs yield identical digests; a one-byte change changes the digest; malicious/expired inputs are deterministically rejected.

### I3: Asset, certificate, and warehouse-receipt version store

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| Asset/Certificate/Warehouse/owner-commitment tables | Migrations, constraint checks, and database contract tests |
| Separate current projection from immutable history | Current/history query consistency; historical update/delete rejected |
| Uniqueness, concurrency, version, prior-hash constraints | Tests for concurrent writes, skipped versions, duplicate current records, wrong previous hash |
| Conflict detection and human-review queue | Conflict enters REVIEW_REQUIRED and cannot transition directly to VALID |

**Completion:** no two current rights records or skipped versions; history is immutable; conflicts require review.

### I4: Oracle state machine

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| Eight Oracle states | Enum exactly matches PRD |
| Transition table, permission matrix, reason codes | Versioned rules and test for each edge |
| Out-of-order, concurrent, duplicate, rollback, conflict, power-loss recovery | Positive/negative, idempotency, and fault-recovery tests |
| Source anomaly fails closed | Each dependency anomaly maps to a stricter state |

**Completion:** invalid transitions cause no partial writes, replay is idempotent, and audit events can rebuild state.

### I5: Proof issuance and offline verification

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| Versioned attestation envelope | Schema, canonicalization, and signature vectors |
| Bind chain/contract/token/asset/purpose/nonce/time | Reject cross-chain, cross-contract, cross-asset, cross-purpose, and expired replay |
| Signer set, threshold, rotation, offline verifier | Multisig threshold policy, rotation/retirement tests, offline verification package |
| No secrets or raw sensitive requests in logs | Log capture and artifact scans |

**Completion:** all ORACLE-003 cases pass; offline verification is complete; retired signers and replay fail.

### I6: Query API and minimum disclosure

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| Asset, token, history, eligibility, and proof interfaces | OpenAPI matches HTTP contract tests |
| Pagination, field authorization, cache, ETag, standard errors | Boundary, authorization, deterministic-response tests |
| Redaction, rate limits, purpose records, bulk-export gates | Tests for unauthorized inference, rate limits, export, and audit |
| No price/return/rating/collateral ratio/investment opinion | Schema/API/UI/log keyword gates |

**Completion:** ORACLE-002, ORACLE-005, ORACLE-006, PRIVACY-001 pass; unauthorized users cannot obtain or infer sensitive mappings.

### I7: Revocation, freeze, and subscription events

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| Revocation, emergency freeze, signer-set retirement | All query/verification paths immediately reject old proofs |
| Reliable outbox | Ordering, idempotency, retry, durable-recovery tests |
| Signed webhook/queue and dead letters | Signature, delivery ID, replay, maximum retry, and DLQ tests |
| Revocation-propagation latency metrics | Measurable SLI and threshold report |

**Completion:** ORACLE-004 passes; duplicate events have no duplicate effect; revocation propagation has quantitative evidence.

### I8: T+0 through T+N settlement coordination

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| Settlement/T+0/calendar/deadline | Versioned records; time-zone/holiday tests |
| Three complete evidence classes | Finalize is prohibited if any evidence is missing |
| finalize/cancel/dispute/timeout/compensation | Full state and failure-recovery tests |
| T+3 only in Wenbao Profile | No hard-coded generic code; profile version is verifiable |

**Completion:** remain Pending or stricter until complete; timeout/dispute must not describe the buyer as having completed rights.

### I9: Authoritative-source sandbox adapters

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| Registry, certificate, and warehouse sandbox adapters | Three independent contract-test suites |
| Capability, version, timeout, rate limit, circuit breaker | Success, rejection, and recovery test for each |
| Signed/error samples, schema evolution, disconnect recovery | Fixed fixtures and fault injection |
| Production parameters injected only by deployment layer | Repository scan and arbitrary-endpoint rejection test |

**Completion:** success, rejection, conflict, delay, offline, and recovery paths pass for all three sources; otherwise remain sandbox-only.

### I10: Administration, human review, immutable audit

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| Admin UI/API for sources, conflicts, revocation, rotation, reconciliation, and export | Per-function UI/API contract tests |
| RBAC/ABAC, dual review, sessions, second confirmation | Tests for excess privilege, self-approval, CSRF, replay, session fixation |
| Hash chain, export manifest, verification tool | Full replay and tamper detection |
| Prevent bulk export and log injection | Limit, authorization, escaping, and audit tests |

**Completion:** admins cannot directly set VALID, delete history, or bypass sources; AUDIT-001 passes.

### I11: SDK, downstream consumption, compatibility

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| Server SDK and offline verification package | Independent example consumer and offline test |
| Expired, revoked, out-of-order, cross-purpose replay | All rejected with stable errorCode |
| Optional read-only on-chain adapter | Read/verify only; cannot sign or broadcast |
| L3 Profile hash/interfaceId lock | Byte-level, ABI, interface, and state-mapping tests |
| Pending and atomic Finalize | Synthetic test; Hoodi test is additional public-network evidence |

**Completion:** all invalid proofs rejected; protocol drift fails closed; SDK has no trade or financial signing capability.

### I12: Security hardening, disaster recovery, production candidate

| PRD requirement | Verifiable delivery criteria |
| --- | --- |
| SAST, dependency, secret, container/IaC, API, penetration testing | Tool versions, rules, original reports, summaries, blockers |
| Performance, capacity, 72-hour stability, backlog, fault injection | Complete continuous-run report; short runs cannot replace 72 hours |
| Backup/PITR/failure domains/RPO/RTO/key rotation | Actual sandbox drills and integrity verification |
| DPIA, retention/deletion, incident response, go/no-go | Documents, owners, review conclusions, unaccepted risks |
| Reproducible build, SBOM, signed artifact, release manifest | Independent-build hash comparison and signature verification |

**Completion:** all P0 gates closed; independent security, privacy, and legal reviews have no unaccepted blockers; complete sandbox drills pass. Production sources, real assets, mainnet, and production switches still need separate approval; those external launch approvals cannot replace I12 evidence.

## 4. Final delivery package

The 13 iterations may be marked complete together only when the package is complete:

1. Authoritative PRD and this acceptance standard.
2. Machine-readable traceability manifest: config/iteration-acceptance.json.
3. One-command acceptance entry point: scripts/verify-iterations.mjs.
4. Per-iteration I0–I12 implementation, schema, migrations, configuration, tests, and documentation.
5. Raw automated test reports and exit codes.
6. I12 external/long-duration/drill evidence.
7. Release-file inventory, per-file SHA-256, SBOM, and reproducible-build proof.
8. iteration-acceptance-report.json with allComplete=true.
9. No secrets, personal data, real endpoints, mainnet writes, real-value assets, or unauthorized financial capability; test-chain evidence is not represented as mainnet results.
10. PR review record; CI is run by repository workflows, and this task does not substitute an unqueried CI result for local evidence.

## 5. Current status interpretation

The previous claim that “all 13 iterations are complete” used a lower standard: major development code existed and synthetic unit tests passed. That does not meet this document's definition of verifiable delivery and has been withdrawn.

Until the machine acceptance report exists with allComplete=true, the accurate status is:

> **The 13 iterations are being re-accepted against the PRD; existing implementation does not automatically equal completion, and missing evidence remains an explicit blocker.**
