# Gap Audit Between the Repository and the PRD

| Item | Content |
| --- | --- |
| Basis | v0.3 of PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md and ACCEPTANCE_RWA_ORACLE_ZH.md |
| Audit scope | Entire repository: main, candidate branch, and feature/oracle-all-iterations |
| Method | Acceptance standard §8; evidence unit is a source-file path plus a named test |
| Audit date | 2026-08-25 |

> Unlike STATUS.md, which audits one commit using the six-value vocabulary in §2, this document audits repository-wide capability coverage and gaps. Under acceptance standard §3, cross-branch evidence cannot establish the status of a commit. This report therefore grants no VERIFIED status; it only states where evidence existed.

> **Update (2026-08-28; issue #5 handled):** The structural gap described here was closed by branch integration. Implementation, requirements, acceptance, and CI now share one commit. The I0–I12 to ORACLE/CONSUMER/NFR traceability map is in TRACEABILITY_ZH.md and enforced by scripts/check-scope-coverage.mjs. Post-integration local checks reported 23/24 engineering-side items verified (only NFR-004 awaited external evidence) and 217 tests passed. The sections below remain as a pre-integration record.

## 0. Post-integration review (2026-08-31, commit 0bb0d6d)

All three items in §6 category B, “actual functional gaps,” were closed. This section corrects the record; §§1–7 below remain the pre-integration record.

| Original category-B gap | Actual post-integration state | Evidence |
| --- | --- | --- |
| Terminal redemption semantics for CONSUMER-007 REDEEMED | Implemented and tested | src/domain/consumer-state-machine.js: REDEEMED has no outgoing transitions and raises REDEEMED_TERMINAL; test rejects REDEEMED → ACTIVE |
| ORACLE-011 asset-detail UI | Implemented and tested | renderAssetDetailHtml renders four transaction-period states (settlement locked / registry pending / settled / failed-disputed); named tests assert all four |
| ORACLE-005 entity compliance | Implemented and tested | src/services/product-boundary.js and docs/openapi.yaml; two named tests |

The pre-integration “zero REDEEMED hits across the repository” conclusion is obsolete because the state machine had not yet been committed on the feature branch.

### 0.1 New finding: weak referential specificity of requirement-to-test binding

All tests bound in config/prd-v0.4-acceptance.json exist and pass (no dangling references), so verify-prd-v0.4 reports 23/24. However, for 13 of 24 requirements, the bound test name never mentions its own ID. Most names are descriptive (for example, ORACLE-001 is bound to “requires a registered active source and approved schema”) and remain reviewable by a human. A more serious class binds a test whose name asserts a different requirement: CONSUMER-007 → CONSUMER-003; CONSUMER-008 → CONSUMER-004/009; ORACLE-009 → ORACLE-005/006; ORACLE-010 → CONSUMER-004/009.

This weakens per-ID evidence citation under acceptance standard §8.3 (“each claim must cite a file path and test name”). The machine check verifies only that a named test exists and passes; it does not verify that the test establishes that requirement. This was the principal methodological finding of this review.

### 0.2 Substantive mismatch fixed: CONSUMER-008

The other 12 issues are naming problems. CONSUMER-008 had a substantive mismatch between its evidence and requirement:

- Requirement (acceptance §4.2): an external event may trigger only a pending, verifiable T+0 intent; no order-book, matching, counterparty, or funds-control path exists.
- The originally bound test asserted fail-closed behavior without a valid proof and blocked operations while pending; it did not prove absence of those paths.

The gap itself existed: repository-wide search found zero orderbook/counterparty hits; the four matching hits were ordinary English prose such as “matching warehouse identities”; the three custody hits referred to IN_CUSTODY warehouse status, not financial custody. But no test would fail if such capabilities were added later.

Added test/consumer-008-external-market-boundary.test.js: it scans src/ for identifiers (avoiding false positives in ordinary English prose) and asserts that src/app.js route literals contain no trading or payment path. This was reverse-validated by injecting orderBook and observing test failure. The CONSUMER-008 binding in config/prd-v0.4-acceptance.json now points to that test.

**Recommendation:** add named tests or rename bindings for the remaining 12 items so every requirement can be cited independently. This does not change the current engineeringVerified=23 result; it is an evidence-auditability improvement.

## 1. Primary finding: the main gap was structural, not functional

feature/oracle-all-iterations implemented most PRD v0.3 L2 capabilities: 34 source modules, 12 test files, 83 passing tests, MySQL migrations, three JSON Schemas, four configuration profiles, and an SBOM.

However, no commit contained requirements, acceptance criteria, implementation, tests, and CI together:

| Branch | Present | Missing |
| --- | --- | --- |
| Candidate branch | PRD v0.3, acceptance standard, CI (4 jobs), traceability snapshot | Substantive implementation (only 3 read-only endpoints) |
| feature/oracle-all-iterations | Full implementation and 83 tests | No .github/ directory or CI; PRD was v0.4 and IDs were I0–I12 |

Under acceptance standard §3 (test results from another commit/branch are not evidence) and §8.1 (audit the exact commit SHA), no acceptable commit existed at that time. This was a branch and ID-system divergence, not an implementation issue.

A second structural gap was that feature used I0–I12 iteration IDs while PRD v0.3 used ORACLE/CONSUMER/NFR IDs, with no traceability map. Acceptance standard §8.4 requires bidirectional per-ID coverage, which could not then be checked mechanically.

## 2. L2 verification layer (ORACLE-*) coverage and gaps

| ID | Coverage | Evidence (feature branch) | Gap |
| --- | --- | --- | --- |
| ORACLE-001 | Sufficient | source-registry.js, schema-registry.js, key-set-registry.js, fixed-source-transport.js; tests for registered active sources/approved schemas, rejecting caller-supplied endpoints, revoked source keys failing closed, and OpenAPI excluding caller-selectable endpoints | Registry-change approval records were not wired to dual-control.js |
| ORACLE-002 | Partial | oracle-status.js exports exactly the eight PRD states; token-eligibility endpoint reflects Oracle status | No positive case for each of eight states; nine PRD fact queries not tested individually; missing partial-availability degradation test |
| ORACLE-003 | Sufficient | attestation-service.js, signer-set-policy.js, canonical-json.js, sdk/verifier.js; tests for subject binding, expiration, revocation, nonce reuse, insufficient threshold, cross-purpose replay | No named negative tests for cross-chain/contract/token replay or schema-version mismatch |
| ORACLE-004 | Sufficient | revocation-registry.js, outbox.js, outbox-dispatcher.js, subscription-signer.js, reason-code-registry.js; tests for independent approval, ordered retry, idempotent acknowledgment, delivery-ID signature binding | Downstream transfer rejection after revocation requires L3 validation; no quantified SLI report for revocation propagation delay |
| ORACLE-005 | Partial | export-gate.js, authorizer.js; test requires purpose and permission for export | KYC/AML/sanctions/jurisdictional-eligibility status proofs were not implemented; missing test that only status is returned without source details |
| ORACLE-006 | Sufficient | tests exclude financial opinions from public schemas and limit metrics to numeric counters/gauges; keyword gate also existed in this branch's CI | These were not on the same commit |
| ORACLE-007 | Sufficient | evidence-vault-port.js and sensitive-field stripping in schemas; tests expose only evidence digests, strip sensitive public fields, and omit key-set identifiers from public listings | No cross-border field-minimization list; scanning evidence was on this branch |
| ORACLE-008 | Sufficient | audit-journal.js, command-journal.js, audit-export.js, state-rebuilder.js, business-calendar.js; hash-chain, state-rebuild, tamper-resistant export/injection, and fault-injection invariant tests | Missing named tests for versioned T+3 calendar and UTC storage/time-zone display |
| ORACLE-009 | Sufficient | tests reject all write methods and SBOM confirms no third-party runtime components | Contract review is non-engineering work |
| ORACLE-010 | Sufficient | sdk/verifier.js and protocol-profile.js; tests for offline verification, both L3 interfaces plus ERC-8325, byte-level artifact validation, pending owner preservation, atomic finalize independent of event order | — |
| ORACLE-011 | Missing | Only admin-ui.js (admin dashboard; read-only and framing-protected) | No asset detail page: one-asset/one-NFT identity, certificate hash/version, warehouse receipt, T+0/T+3 progress, four distinct transaction-period states, visible source and expiration |

## 3. Downstream consumer constraints (CONSUMER-*; synthetic consumer demonstrates enforceability)

| ID | Coverage | Gap |
| --- | --- | --- |
| CONSUMER-001 | Sufficient | Tests for one-to-one/idempotent token binding and append-only certificate versions; fractionalization rejection lacked a named test |
| CONSUMER-002 | Partial | No individual missing-prerequisite negative tests for the seven issuance prerequisites |
| CONSUMER-003 | Partial | state-engine.js rejects illegal/non-increasing transitions; no complete coverage of legal transitions among nine states |
| CONSUMER-004 | Partial | Pending observation preserves owner and blocks transfers; snapshot-hash integrity, duplicate-event idempotency, pledge/re-listing rejection lacked named tests |
| CONSUMER-005 | Sufficient | Tests require complete evidence and certificate upgrade; L3 finalize observation verifies atomic version and event set |
| CONSUMER-006 | Partial | Of six scenarios, only timeout and dispute had named tests; rejection, data conflict, out-of-order, replay, and refund-trigger evidence were missing |
| CONSUMER-007 | Missing | Zero repository hits for REDEEMED/redeem: terminal redemption semantics were not implemented |
| CONSUMER-008 | Evidence only missing | Zero repository hits for order-book/matching (consistent with requirement), but no test proved their absence |
| CONSUMER-009 | Sufficient | Tests for offline verifier rejecting cross-purpose replay, production ports failing closed when dependencies are absent, and verification endpoint failing closed without a configured verifier |

## 4. Non-functional requirements (NFR-*)

| ID | Coverage | Gap |
| --- | --- | --- |
| NFR-001 | Sufficient | protected-signer.js, dual-control.js, signer-set-policy.js; tests that admin cannot directly set VALID and dual control rejects self-approval. No timelock or rollback drill record |
| NFR-002 | Sufficient | Tests reject nonce reuse, cross-purpose replay, append-only versioning, and non-increasing transitions. No per-field integrity tests for chainId/contract/tokenId/schema version |
| NFR-003 | Sufficient | Tests for fail-closed development defaults, rejecting non-loopback bind and external writes, production ports failing closed, and three adapters rejecting conflict/delay/offline |
| NFR-004 | Missing | backup-manifest.js, retention-policy.js, reconciler.js, and metrics.js existed with tests; no 99.9% load report or actual execution records for five drills (reconciliation, disaster recovery, key rotation, certificate conflict, source outage) |

## 5. Premise evidence (PREMISE-P1–P8)

Entirely missing at the time: repository search returned zero hits for premise/evidence materials. The eight PRD §1 premises had no written basis, collection date, review cycle, or owner. Under acceptance §4.4, any missing P1–P4 item blocks Stage F.

## 6. Gap categories and priority

**Category A — structural (highest priority and lowest cost)**

1. Branch integration: feature implementation and this branch's PRD/acceptance/CI had to land in one commit or no evidence would be valid.
2. ~~PRD version decision~~ Closed by D-001 in DECISIONS_ZH.md: v0.3 governs; map I0–I12 on integration.
3. Build I0–I12 to ORACLE/CONSUMER/NFR traceability so §8.4 can be enforced mechanically.
4. feature's verify-iterations.mjs had a reporter defect (pipeline output was TAP, while the assertion matched the check mark); adding --test-reporter=spec fixes it.

**Category B — actual functional gaps**

1. ORACLE-011 asset-detail UI (distinguish four transaction-period states).
2. CONSUMER-007 REDEEMED terminal redemption semantics.
3. ORACLE-005 entity-compliance status proof.

**Category C — implementation present, named tests missing**

ORACLE-002 positive cases for eight states; ORACLE-003 cross-chain/contract/token replay; ORACLE-008 calendar versioning and time zones; individual negative cases for CONSUMER-002/003/004/006; proof of absence for CONSUMER-008; and NFR-002 binding-field integrity.

**Category D — not solvable by engineering alone**

PREMISE-P1–P8 evidence; NFR-004 load testing and five drills; the three mutually exclusive ArtFi decisions in PRD §0.1; §0.2 contract signing; and legal go/no-go (PENDING-GATE).

## 7. Audit limitations

This audit did not assess correctness or security of the feature branch code (only coverage and evidence presence); it did not run load, penetration, or dependency audits, and did not verify MySQL migration behavior against a real database.
