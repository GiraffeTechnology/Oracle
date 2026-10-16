# Requirement-to-Iteration Traceability Map

| Item | Content |
| --- | --- |
| Data source | `requirementIds` field in `config/iteration-acceptance.json` |
| Authoritative requirements | v0.4 of `PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md`, 24 legacy IDs only; full revision dated 2026-10-17 HKT additionally requires the separate 15-row OX/OT overlay |
| Enforced by | `scripts/check-scope-coverage.mjs` (CI job `integration-gates`) |

## Why this mapping exists

Implementation is organized by **I0–I12 iterations**, while the PRD is organized by **ORACLE/CONSUMER/NFR requirements**. The two systems were previously on separate branches with no mapping, preventing mechanical execution of the acceptance standard's §8.4 “bidirectional per-ID coverage review.” This was one reason no auditable commit existed before integration.

This file is rendered from the manifest, not maintained by hand. The guard checks consistency in both directions: CI fails if any PRD requirement is unclaimed by an iteration or if an iteration claims an ID absent from the PRD.

## Iteration → requirements

| Iteration | Claimed requirements | Artifacts | Named tests |
| --- | --- | --- | --- |
| `I0` | `NFR-001` | 8 | 3 |
| `I1` | `ORACLE-001`, `ORACLE-007`, `ORACLE-008` | 7 | 4 |
| `I2` | `ORACLE-001`, `ORACLE-007` | 3 | 3 |
| `I3` | `CONSUMER-001` | 3 | 3 |
| `I4` | `ORACLE-002`, `NFR-002` | 4 | 3 |
| `I5` | `ORACLE-003`, `ORACLE-010`, `NFR-001`, `NFR-002` | 3 | 4 |
| `I6` | `ORACLE-005`, `ORACLE-006`, `ORACLE-007` | 4 | 5 |
| `I7` | `ORACLE-004` | 4 | 4 |
| `I8` | `ORACLE-008`, `ORACLE-009`, `CONSUMER-004`, `CONSUMER-005`, `CONSUMER-006`, `CONSUMER-008` | 3 | 3 |
| `I9` | `ORACLE-001`, `NFR-003` | 3 | 3 |
| `I10` | `ORACLE-011`, `NFR-001` | 5 | 5 |
| `I11` | `ORACLE-010`, `CONSUMER-002`, `CONSUMER-003`, `CONSUMER-007`, `CONSUMER-009` | 4 | 4 |
| `I12` | `NFR-004` | 8 | 5 |

## Requirement → iterations

| Requirement | Title | Covered by |
| --- | --- | --- |
| `ORACLE-001` | Authoritative source registry | `I1`, `I2`, `I9` |
| `ORACLE-002` | Factual queries | `I4` |
| `ORACLE-003` | Signed proofs | `I5` |
| `ORACLE-004` | Revocation and emergency freeze | `I7` |
| `ORACLE-005` | Isolation of entity-compliance conclusions | `I6` |
| `ORACLE-006` | Prohibition on financial outputs | `I6` |
| `ORACLE-007` | Privacy and data minimization | `I1`, `I2`, `I6` |
| `ORACLE-008` | Audit and traceability | `I1`, `I8` |
| `ORACLE-009` | Financial separation (Giraffe's own obligations) | `I8` |
| `ORACLE-010` | Consumer adapters and SDK | `I5`, `I11` |
| `CONSUMER-001` | One asset, one certificate, one NFT | `I3` |
| `CONSUMER-002` | Initial issuance | `I11` |
| `CONSUMER-003` | Lifecycle | `I11` |
| `CONSUMER-004` | T+0 snapshot and registration gap | `I8` |
| `CONSUMER-005` | T+3 settlement | `I8` |
| `CONSUMER-006` | T+3 failure and timeout | `I8` |
| `CONSUMER-007` | Redemption and termination | `I11` |
| `CONSUMER-008` | External trading compatibility | `I8` |
| `CONSUMER-009` | Fail-closed proof consumption | `I11` |
| `ORACLE-011` | Asset detail display | `I10` |
| `NFR-001` | Keys and permissions | `I0`, `I5`, `I10` |
| `NFR-002` | Replay protection and ordering | `I4`, `I5` |
| `NFR-003` | Disabled by default | `I9` |
| `NFR-004` | Availability and recovery | `I12` |

## Boundary note

- `CONSUMER-*` items are not implementation deliverables of this project under PRD §3.2. The listed iterations are responsible only for “proving the constraint can be enforced on the Oracle side”; they do not mean L3 protocol implementation or deployment.
- Complete mapping coverage does **not** mean requirements are verified. See `STATUS.md` for actual status by requirement and acceptance standard §5 for stage gates.

## Full-revision overlay

EX_ALIGNMENT_ACCEPTANCE.md maps all OX-001–012 and OT-001–003 headings bidirectionally to sources, assertions, evidence layers and stage ownership. These 15 rows are deliberately separate from the unchanged legacy 24-ID/I0–I12 denominator. The existing scope checker parses only ORACLE/CONSUMER/NFR; a pass cannot imply overlay execution or acceptance. The legacy title lists above are mapping labels, not current completion claims. Revised semantic clauses need their own tests even if their parent ID is unchanged.
