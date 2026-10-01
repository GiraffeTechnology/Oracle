# CI and Audit Handoff (PRD v0.3)

## Authoritative references

Use only these current files:

1. docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md
2. docs/ACCEPTANCE_RWA_ORACLE_ZH.md
3. config/prd-v0.4-acceptance.json
4. scripts/verify-prd-v0.4.mjs
5. docs/STATUS.md

The obsolete docs/PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md is retained only for historical audit and must not override the new baseline. I0–I12 remain the delivery breakdown, but config/iteration-acceptance.json and verify-iterations.mjs enforce binding to the v0.3 ORACLE/CONSUMER/NFR IDs; any omission, unknown ID, or version drift fails closed.

## CI sequence

    pnpm install --frozen-lockfile
    node scripts/syntax-check.mjs
    node --test --test-reporter=spec "test/*.test.js"
    node scripts/repository-scan.mjs
    node scripts/product-boundary-scan.mjs
    node scripts/verify-release.mjs
    node scripts/verify-prd-v0.4.mjs

verify-prd-v0.4.mjs must exit nonzero whenever any applicable gate is unmet. The current engineering candidate is expected to have local verification for ORACLE-001–011, CONSUMER-001–009, and NFR-001–003; NFR-004 and Stages A/D/F remain PENDING-GATE, and allComplete=false.

## Required checks

- Every ORACLE/CONSUMER/NFR ID has code, positive/negative tests, and an accurate status; the existence of a test name alone does not prove semantic success.
- CONSUMER-* verifies enforceability on the Oracle side only; do not misclassify it as this project's implementation of L3/ERC/NFT.
- Unknown sources, arbitrary endpoints, conflicts, expiration, revocation, out-of-order events, replay, and dependency outages all fail closed.
- Proofs must bind asset, chain, contract, token, purpose, nonce, validity period, source, and revocation reference.
- One asset / one certificate / one token; duplicate fingerprints, receipts, current certificates, and any fractionalization requests must be rejected.
- T+0 does not mean settlement completed; T+3 must verify registry change, old/new certificates, warehouse, wallet binding, version, and prior hashes.
- API/schema/UI/contracts must not produce entity-compliance conclusions or financial outputs; transferEligibility represents asset-side facts only.
- Public API/UI must not disclose holder commitments, identity mappings, internal repository identifiers, original certificates/receipts, keys, endpoints, or topology.
- MySQL migrations, empty-database setup, backup, isolated restore, reverse migration, and schema/seed checks require actual execution.
- A PR, commit, CI start, or self-declared PASS must not change evidence status.
- All eight NFR-004 summaries, P1–P8, one complete CI run, and final contract/go-no-go must pass repository verification and bind the same 40-character candidate commit; historical evidence must not be spliced in.
- The 72-hour run must actually last at least 259,200 seconds, have a maximum sampling interval of 120 seconds, and availability of at least 99.9%; no restart, continuation run, or shortened duration.

## Non-fabricable external evidence

NFR-004 and Stage F require, at minimum: actual security scans; formal performance/capacity results; continuous 72-hour operation with availability of at least 99.9%; MySQL restore/PITR; protected-signer rotation; data-protection/incident-response; reproducible signed build; independent legal/privacy/security/contract/operations reviews; P1–P8 evidence; scope contract; and jurisdiction-specific go/no-go. Empty files, mocks, screenshots, and operator statements are not substitutes.

## Output format

For each ID, use one of the six statuses in the acceptance standard and cite the exact commit, file, test, command, evidence SHA, and gap. List G-A–G-F, P1–P8, the §0.1 decision, and the §0.2 contract separately at the end. Only when every applicable item is VERIFIED on one commit and all genuine external gates are satisfied may allComplete=true.
