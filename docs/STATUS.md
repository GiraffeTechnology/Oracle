# Giraffe RWA Oracle Evidence Snapshot

Current review: 2026-10-17 HKT / 2026-10-16 UTC. Requirements are the complete PRD v0.4 revision and EX_ALIGNMENT_ACCEPTANCE.md. This is an evidence index, not a completion statement.

| Evidence scope | Current status and limit |
| --- | --- |
| Main `27217e65a6e71baaeff5d7c53a2c8de126e5b69d` | Generic verification/persistence/control-plane and temporal API; audited CI [38829743213](https://github.com/GiraffeTechnology/Oracle/actions/runs/38829743213) has 12 successful jobs, 450 Node tests and 13 contract tests. The old all-CI-red/quota claim below is historical and no longer current. |
| Legacy 24 IDs | Exact-main verifier reports 23 engineering mappings, NFR-004 PENDING-GATE and allComplete=false. Named-test/artifact coverage is not full semantic, institutional or production acceptance. |
| Draft PR48 `b9c1b410a35fa017622c1971d714bb35defd57f1` | Atomic receipt tuple and immutable opaque policy hash; CI [38944884171](https://github.com/GiraffeTechnology/Oracle/actions/runs/38944884171) has 12 successful jobs, 450 Node and 25 contract tests. Draft only, not main. |
| Reviewed unpublished tree `2fda94c7701fdb17e625f9617fbd17249d415c9f` | 25-file ingress/journal/writer/receipt-API extension. Prior local evidence: 503 Node+TypeScript, 496 dependency-free Node, 27 Mocha plus 30 pipeline tests; no stage-2 commit/PR/remote CI/deployment. SQL-capture and synthetic parser only. |
| OX-001–012 / OT-001–003 | Separate full-revision requirements; none verified by this documentation revision. Main/candidate differences and NOT_RUN execution markers are in EX_ALIGNMENT_ACCEPTANCE.md. |
| Institutional parser / full policy / deployment | PENDING-GATE for approved profile and exact authorized integration; opaque commitment and signed normalized intent alone are insufficient. |
| Identity/security residual | BLOCKED; previously identified final fix remains unverified. No blocked action retried or reproduced by this revision. |
| NFR-004, P1–P8, Stage F | PENDING-GATE; operational load/stability/recovery/protected-signer evidence, premise support, independent reviews, commercial scope and legal go/no-go remain required. |

The iteration v0.3/v0.4 drift and obsolete I11 title are corrected as documentation metadata in this candidate. Paired acceptance executor/test changes are a separate implementation work item; until integrated and executed on the exact candidate, do not claim the full iteration runner repaired. The legacy report is not expanded to cover OX/OT automatically.

## Preserved historical snapshot (not current status)

The following original text records the 2026-08-28 baseline and later historical notes. Its old test counts, missing-CI claim and implementation assertions must not be used for present acceptance. Current facts are above; no history was rewritten.

# Giraffe RWA Oracle v0.3 Evidence Snapshot

This file is a status index, not a completion statement. The authoritative requirements are in `PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md`; authoritative acceptance rules are in `ACCEPTANCE_RWA_ORACLE_ZH.md`. A commit, push, PR, or CI start does not automatically change status.

## Integration note (2026-08-28)

The implementation, requirements, acceptance criteria, and CI described by this snapshot are now in the **same commit** (issue #5 was handled; the candidate branch / PR #2 has since been merged into `main`). Before integration, implementation and requirements were split across two branches and could not constitute evidence on any single commit under acceptance standard §§3 and 8.1.

Local verification (Node 22.22.2): `node --test "test/*.test.js"` passed 217 tests; `node scripts/verify-prd-v0.4.mjs` reported 23/24 engineering-side items verified, with only NFR-004 awaiting external evidence; `node scripts/verify-iterations.mjs` reported I0–I11 completed and I12 blocked.

**“VERIFIED (local engineering candidate)” in the table has not become formal “VERIFIED”.** Acceptance standard §6 requires a green CI run on the reviewed commit, but CI currently fails all jobs because of issue #4 (suspected exhausted Actions quota). This is an infrastructure issue, not a code issue.

The I0–I12 and ORACLE/CONSUMER/NFR traceability mapping is in `TRACEABILITY_ZH.md`.

## Current status

| Scope | Status | Evidence boundary |
| --- | --- | --- |
| ORACLE-001–011 | `VERIFIED` (local engineering candidate) | Syntax, 111 Node tests, repository scan, and per-ID verification in `npm run verify:prd`; still requires CI re-verification on the same commit |
| CONSUMER-001–009 | `VERIFIED` (synthetic consumer on Oracle side) | Proves only that Oracle can enforce fail-closed behavior; does not mean L3 ERC is implemented or deployed |
| NFR-001–003 | `VERIFIED` (local engineering candidate) | Protected-signer adapter, dual control, ordering/replay, and source fault injection |
| NFR-004 | `PENDING-GATE` | Formal 72-hour, production-load/capacity, recovery, and protected-signer rotation evidence is incomplete |
| PREMISE-P1–P8 | `PENDING-GATE` | Not all written bases, evidence dates, review cycles, and owners have been recorded in a publicly auditable form |
| Stage F | `PENDING-GATE` | Independent legal, privacy, security, contract, and operations reviews, plus scope/quotation and jurisdiction-by-jurisdiction go/no-go, are incomplete |

The machine-readable snapshot is generated by `scripts/verify-prd-v0.4.mjs` at `output/prd-v0.4-acceptance-report.json`. If any applicable gate is unmet, that script must exit nonzero and leave `allComplete=false`. External evidence must pass content validation and bind the same candidate commit; creating a file alone does not clear a gate. Historical 72-hour or other evidence cannot replace evidence for the current candidate.

## Product-line decision

The implementation currently follows “Decision A: independent product line” in PRD §0.1: the Oracle repository does not depend on or reuse ArtFi's fractionalization contracts, trading modules, database, or 37×100 charity-asset dataset. A formally signed commercial-scope change remains a Stage F gate.

## Data security

The repository contains synthetic data only. Production keys, real personal data, complete certificates, full warehouse receipts, server addresses, and credentials must not enter GitHub, CI output, or public APIs.
