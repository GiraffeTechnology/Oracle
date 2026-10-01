# Giraffe RWA Oracle v0.3 Implementation Status

The authoritative status is in `STATUS.md` and the machine-generated `output/prd-v0.4-acceptance-report.json`. This file provides only an engineering summary.

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
- Complete CI and approved merge for the same final commit.

Commits, pushes, PRs, and CI starts do not constitute completion. Until all applicable gates are met, `allComplete` must remain `false`.
