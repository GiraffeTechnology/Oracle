# Giraffe RWA Oracle (L2) Delivery and Acceptance Standard

Version: v0.4 | Date: 2026-09-03 (v0.3: 2026-08-24)  
Companion documents: PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md (requirements), STATUS.md (evidence snapshot)

The sole substantive change in v0.4 is D-008: ERC-721 transfers are not blocked while registry processing is pending; rights are instead classified as deferrable or perishable. The affected acceptance scope is CONSUMER-004–009; see the matrix in §5. The requirement-ID set and numbering are unchanged.

## 1. Purpose and boundaries

This document defines how each PRD requirement is demonstrated, how stages advance, and when delivery may be claimed. It defines process only; it neither adds nor removes requirements. Any rule in this document that changes delivery content is a defect.

The requirement-ID system is in PRD §3.2. CONSUMER-* is implemented by the independent L3 project; this project's acceptance obligation is to prove that these constraints can be enforced on the Oracle side.

Entity compliance (KYC, AML, sanctions, jurisdictional eligibility, licensing, suitability) is not an acceptance item here. Relevant institutions retain their own business-compliance obligations. This document only accepts the negative fact that Oracle does not cross that boundary (ORACLE-005).

## 2. Status vocabulary

Only the following six values are allowed.

| Status | Meaning |
| --- | --- |
| VERIFIED | Requirement and acceptance evidence both exist on the same reviewed commit and environment |
| IMPLEMENTED-NOT-VERIFIED | Code exists, but required test or runtime evidence is missing |
| PENDING-GATE | In scope and scheduled, awaiting a named prerequisite (see §5) |
| BLOCKED | An unplanned external, security, legal, funding, or environment obstacle |
| NOT-IMPLEMENTED | Required behavior is missing |
| OUT-OF-SCOPE | Explicitly excluded by the PRD or by a signed scope change |

Difference between PENDING-GATE and BLOCKED: the former has a planned release condition (for example, mainnet deployment awaiting legal go/no-go); the latter is an unplanned obstacle requiring escalation (for example, an unavailable audit-firm schedule).

OUT-OF-SCOPE means excluded by contract only. It must not mean merely deferred, incomplete, or awaiting a prerequisite; doing so would silently remove paid scope.

“Complete,” “delivered,” “passed,” and “production-ready” are reserved terms and may be used only when all applicable acceptance items are VERIFIED on the same commit.

### 2.1 Legal go/no-go

Independent written approval for mainnet, real assets, real funds, and each jurisdiction is a legal gate, not an engineering gate. Its correct status is PENDING-GATE, with the prerequisite “independent written go/no-go signed.”

Passing all technical tests does not clear this gate; unlike a purely engineering project, this requirement must not be simplified away as an engineering convention. It also must not be relabeled OUT-OF-SCOPE: mainnet launch remains in scope.

## 3. Evidence rules

The following do not constitute delivery evidence:

- PRD statements, screenshots, prototypes, or design mockups;
- code present only in a local working directory;
- test results from another commit, branch, chain, or contract;
- simulated transactions without receipts;
- pages that render but cannot execute the function they claim;
- mock or fixture data represented as real data;
- operator statements without reproducible evidence.

Each claim must cite a file path, test name, CI run record, or transaction hash and receipt. If evidence is unavailable, record the status; do not infer, substitute, or fabricate.

All Stage A–E work uses synthetic data. Synthetic data is the correct form for this stage, not an evidence defect; claiming from synthetic results that a real asset was verified is a serious violation.

## 4. Acceptance matrix

### 4.1 L2 verification layer (implemented by this project; all items must be VERIFIED before Stage F)

| ID | Acceptance requirement | Minimum automated evidence |
| --- | --- | --- |
| ORACLE-001 | Approved sources only | Negative tests for unknown sources, arbitrary URLs/RPC/database addresses, and replacement endpoints; registry changes require approval records |
| ORACLE-002 | Accurate state queries | Positive cases for all eight states; degradation tests for expiration, conflict, source outage, and partial availability |
| ORACLE-003 | Verifiable proofs | Negative tests for insufficient signatures, nonce reuse, expiration, schema-version mismatch, and cross-chain/contract/token/purpose replay |
| ORACLE-004 | Immediate revocation effect | Query returns REVOKED after revocation; protocol transfer fails after revocation; idempotent event replay test; reason hash and operator trace |
| ORACLE-005 | Isolate entity-compliance conclusions | Gate scan confirms no KYC/AML/sanctions/jurisdictional-eligibility/suitability/licensing fields or endpoints in repository, schema, API response, interface paths, UI, or contracts; such queries must be rejected rather than return an empty value |
| ORACLE-006 | No financial outputs | Keyword and field-gate tests for API responses, schema, and UI copy (valuation/price/collateral ratio/returns/ratings/investment advice) |
| ORACLE-007 | No personal information on public surfaces | Scans of ABI, events, metadata, logs, database exports, and API responses; cross-border field-minimization review |
| ORACLE-008 | End-to-end traceability | Replay audit from T+0 to T+3 and certificate history; UTC storage/time-zone display tests; versioned T+3 calendar record |
| ORACLE-009 | Financial separation | Bidirectional code-and-contract review for absence of financial write APIs, financial signing paths, funds accounts, and transaction-volume fee paths |
| ORACLE-010 | Adapter fails closed | Correct proof verifies; expired/revoked proofs are rejected; replay binding enforced; dependency outage fails closed |
| ORACLE-011 | Factual UI display | Distinct display of four transaction-period states; source/observation/expiration times visible; misleading copy is gated |

### 4.2 Downstream consumer constraints (enforceability shown with a synthetic consumer)

| ID | Acceptance requirement | Minimum automated evidence |
| --- | --- | --- |
| CONSUMER-001 | One asset / one certificate conflict closes | Proof issuance fails for a duplicate asset fingerprint, warehouse receipt, or current certificate; fractionalization request is rejected |
| CONSUMER-002 | Complete issuance prerequisites | Negative test for each of seven missing prerequisites; reject an already-occupied asset |
| CONSUMER-003 | Valid state machine | Full coverage of legal transitions among nine states; illegal or proof-less transitions roll back |
| CONSUMER-004 | T+0 snapshot and registry gap | Snapshot hash integrity; snapshot immutable after creation; deadline generation; duplicate-event idempotency; ordinary transfer succeeds while a gap is open; perishable exercises such as redemption/pledge fail; no protocol escrow or non-transferable state exists |
| CONSUMER-005 | Proof of completed registry processing | New certificate hash, incremented version, previousCertificateHash, and authoritative change reference match exactly; Token ID unchanged; settlement recipient is the confirmed holder at T+0, not the current holder; settlement must be rejected if that moment was not final |
| CONSUMER-006 | Recoverable failure | Six scenarios: timeout, rejection, data conflict, out-of-order event, replay, and dispute; no new certificate hash is written; refund notification fires; after cancellation or timeout, that moment remains “not final,” not “confirmed failure”; perishable exercises still fail; token transferability is unaffected |
| CONSUMER-007 | Redemption is a perishable right | Redemption requires that the moment be final with no open gap and that the exerciser be the confirmed holder at that moment; failure of any condition rejects that exercise; rejection must not restrict transfer; later stale input must not overwrite REDEEMED or restore a valid redemption right |
| CONSUMER-008 | External markets cannot bypass gates | External events may trigger only a pending T+0 intent; no order book/matching/counterparty/funds-control path exists; to external markets, the token always behaves as an ordinary ERC-721 with no custom non-transferable state |
| CONSUMER-009 | Proof consumption fails closed | Invalid/expired/revoked/out-of-order/replayed proofs are deterministically rejected; no cache or optimistic default on dependency outage; both “moment not final” and “open gap exists” must also fail closed; a valid proof does not mean ownership is final |

### 4.3 Non-functional requirements

| ID | Acceptance requirement | Minimum evidence |
| --- | --- | --- |
| NFR-001 | Separate keys and permissions | Multisig/threshold-signature configuration; negative test proving no admin bypass; timelock and rollback drill; repository key scan |
| NFR-002 | Replay protection and ordering | Full binding-field integrity test; old proof cannot overwrite a newer version; duplicate settlement rejected |
| NFR-003 | Disabled by default | Inject source-unavailable, conflict, and timeout cases; result is frozen or under review, never guessed |
| NFR-004 | Availability and recovery | 99.9% availability/load report; queue recovery and idempotent retry; records of five drills: reconciliation, disaster recovery, key rotation, certificate conflict, and source outage |

### 4.4 Premise evidence

| ID | Acceptance requirement | Minimum evidence |
| --- | --- | --- |
| PREMISE-P1–P8 | Each PRD §1 premise has a written basis, collection date, review cycle, and owner | Basis document archived; any missing P1–P4 item blocks Stage F |

## 5. Stage gates

Execute in order. The exit condition of each gate authorizes the next stage without an extra approval step, except for Stage F legal go/no-go (see §2.1).

| Gate | Stage | Exit condition |
| --- | --- | --- |
| G-A | Contract and data contract | Versioned contract for all sources, permissions, states, and failure handling; P1–P8 evidence register filled; no real-asset writes; PRD §0.2 contract item initiated |
| G-B | L2 Oracle sandbox | ORACLE-001–009 and NFR-001–003 all VERIFIED; all negative tests pass; no prices or financial fields; no access to real personal data |
| G-C | Downstream protocol compatibility | ORACLE-010 and CONSUMER-001–009 all VERIFIED; Oracle cannot issue a valid proof for conflicting copies of the same asset; no production NFT deployed and no ERC submitted |
| G-D | Controlled end-to-end drill | All requirements plus NFR-004 VERIFIED; complete evidence package independently reviewable; no real funds or unauthorized real assets used |
| G-E | Third-party read-only integration | Re-verify ORACLE-005 and ORACLE-009 in third-party integration form; contracts and technical tests confirm only asset-fact queries and generic technical support; third parties cannot obtain or infer entity-compliance conclusions via the interface |
| G-F | Production candidate | G-A–G-E all green on the same commit; independent legal, privacy, security, contract, and operations audits passed with remediation retested; §0.1 decision made; §0.2 contract signed; written go/no-go obtained for mainnet/real assets/real funds/every jurisdiction |

Before G-F, mainnet deployment status is PENDING-GATE, with G-F exit conditions as prerequisites. It must not be recorded as BLOCKED or OUT-OF-SCOPE.

## 6. CI acceptance

A single GitHub CI run on the reviewed, integrated commit must include all required jobs:

- locked dependency installation and lockfile verification;
- formatting, lint, and full TypeScript type checking;
- unit and negative-test suites;
- production build;
- contract tests proving schema-version compatibility and API contracts;
- synthetic-consumer integration tests (enforceability of CONSUMER-* constraints);
- database forward migration from empty, integration tests, backup, isolated-database restore, schema and seed verification, and reverse migration;
- financial-output gate scan (keywords and fields);
- entity-compliance semantics gate scan (identifiers, paths, and field names such as kyc, aml, sanction, suitability, accredit, and jurisdiction-eligibility);
- personal-information gate scans (ABI, events, metadata, logs, database exports);
- scans for keys, private keys, production credentials, original documents, and prohibited plaintext.

CI passes only when every required job is green on the reviewed commit. A green run on a historical commit is not evidence for a later candidate.

## 7. Definition of delivery

Giraffe RWA Oracle is a production candidate only when all of the following are true:

1. Every in-scope requirement in §4 is VERIFIED, or excluded by a signed scope change as OUT-OF-SCOPE.
2. All G-A through G-F exit conditions are met on the same commit.
3. CI is green on that commit and the PR is approved and merged.
4. The commit referenced by tests, deployment, and documentation is identical.
5. Independent audit reports (legal, privacy, security, contract, operations) and remediation/retest evidence are archived.
6. Every PRD §14 release blocker is resolved.
7. Release checklist, exact contract addresses, signer set, rollback, and incident-response plan are published.
8. Operations manual and operating documents are handed over.

Production enablement additionally requires the written go/no-go in §2.1; reaching production-candidate status technically does not mean the system is live.

## 8. Audit guide (human or agent auditors)

1. Audit the exact commit SHA, not an uncommitted working tree.
2. Report every requirement using one of the six values in §2.
3. Cite file paths, test names, CI run links, transaction hashes, and receipts.
4. Check scope coverage first: every ID in PRD §§6, 7, and 11 must have a row in the §4 matrix, and vice versa. An ID present on only one side is an audit failure.
5. Fail if CONSUMER-* is treated as an implementation deliverable of this project; this project must only prove enforceability.
6. Fail if ORACLE-009 is treated as a downstream constraint; it is Giraffe's own obligation.
7. Fail if in-scope work is marked OUT-OF-SCOPE without a signed scope change; if a scheduled item awaiting a prerequisite is marked BLOCKED or OUT-OF-SCOPE instead of PENDING-GATE, fail.
8. Fail if legal go/no-go is described as resolvable by technical testing.
9. Fail if synthetic-data results are claimed to verify real assets, real funds, or real personal data.
10. Fail if public surfaces expose personal data, original certificates, original warehouse receipts, identity mappings, private keys, server credentials, or internal topology.
11. Fail if API, schema, or UI contains valuation, return, collateral ratio, investment advice, or financial-approval language.
12. Fail if Oracle produces, stores, relays, or returns any entity-compliance conclusion (KYC, AML, sanctions, jurisdictional eligibility, suitability, or licensing), including when disguised with neutral phrases such as “status proof” or “compliance query.”
13. Fail if transferEligibility or transfer-eligibility values include counterparty-compliance status.
14. Fail if documents or contracts imply that Oracle returning VALID reduces an institution's own KYC/AML/sanctions obligations.
15. If a PRD §1 premise lacks written basis and collection date, mark it as a Stage F blocker.
16. Output a gap table grouped by ID and list the current state of the §0.1 decision and §0.2 contract.
