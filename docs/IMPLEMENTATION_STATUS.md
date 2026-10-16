# Giraffe RWA Oracle Implementation Status

The current evidence identities are in STATUS.md. The machine-generated output/prd-v0.4-acceptance-report.json covers only 24 legacy IDs, not the full 2026-10-17 HKT revision or OX/OT overlay. This file summarizes baseline engineering, not receipt integration or production acceptance. Main, draft PR48 and unpublished stage2 must remain distinct.

## Implemented and covered by local automation

- Fixed authoritative-source registration, schema allowlists, signed-source ingestion, and arbitrary-endpoint rejection.
- Eight public Oracle states; fail-closed handling for conflicts, offline, expired, and revoked evidence.
- Signed proof binding chain, contract, token, purpose, nonce, source, validity period, and revocation reference.
- Cross-asset uniqueness constraint for one asset / one certificate / one token, and seven pre-issuance gates.
- Nine-state synthetic consumer, T+0 snapshot, T+3 certificate increments, and failure/dispute recovery semantics.
- Minimum-disclosure API, asset-detail UI, four settlement display states, and asset-fact boundary statement.
- Recursive input gates for entity-compliance conclusions and financial outputs; production writes default to disabled.
- Append-only certificate history, immutable audit chain, reliable outbox, dual control, and recovery artifacts.

## Not completed; must not be described as a production candidate

- All formal written evidence, collection dates, and authorized reviews for P1–P8.
- NFR-004 operational evidence for formal 99.9% availability/capacity, 72-hour stability, recovery, and protected-signer rotation.
- Independent legal, privacy, security, contract, and operations reviews, remediation, and retesting.
- Scope/quotation/milestone contract, formal ArtFi independent product-line decision, and written go/no-go for each jurisdiction.
- Exact-candidate CI and merge for any new delivery; main already has audited green CI.
- OX/OT integration evidence, approved institutional original-format/profile, complete mint-policy mapping and live receipt-journal durability tests.
- Verification of the separate blocked authenticated-identity security fix; this revision does not perform it.

Commits, pushes, PRs, and CI starts do not constitute completion. Until all applicable gates are met, `allComplete` must remain `false`.
