# Giraffe RWA Oracle

Implementation and deployable configuration for the Giraffe RWA Oracle.

Oracle is the institutional integration layer between authoritative real-world sources and ERC-8415 compatible applications. It verifies source evidence, maintains auditable asset state transitions, and exposes controlled application-facing read interfaces.

The architecture boundary is:

```text
Application
    |
    v
Oracle
    |
    v
ERC-8415 projection infrastructure
    |
    v
Authoritative sources / registers
```

Applications do not implement ERC-8415 adapters directly. Oracle owns the integration boundary.

## Current implementation status (snapshot 2026-10-16)

This repository has progressed beyond a verification-only prototype. Current implementation includes:

### Implemented baseline capabilities (not production commissioning)

- authoritative source model:
  - registry source;
  - certificate authority source;
  - warehouse source;
- evidence validation and attestation flow;
- asset verification pipeline;
- token binding and provenance tracking;
- revocation and controlled administrative operations;
- RBAC and dual-control boundaries;
- durable command handling and idempotency controls;
- audit journal and outbox architecture;
- settlement coordination primitives;
- ERC-8415 projection reference implementation;
- ERC-8415 conformance handling including:
  - temporal holder queries;
  - historical entries;
  - finality semantics;
  - projection identity.

The exact reviewed main is `27217e65a6e71baaeff5d7c53a2c8de126e5b69d`. Its latest audited CI run is [38829743213](https://github.com/GiraffeTechnology/Oracle/actions/runs/38829743213), with 12 successful jobs, 450 Node tests and 13 contract tests. This is evidence for that main commit, not this uncommitted documentation revision or production.

Receipt binding is only in [draft PR #48](https://github.com/GiraffeTechnology/Oracle/pull/48), head `b9c1b410a35fa017622c1971d714bb35defd57f1`. Authenticated source ingress and receipt APIs are in reviewed unpublished tree `2fda94c7701fdb17e625f9617fbd17249d415c9f`; no stage-2 commit, PR, CI or deployment is established. An approved institutional parser and live receipt-journal database evidence remain missing. NFR-004 and the separate blocked identity/security residual remain unresolved.

The complete PRD v0.4 revision dated 2026-10-17 HKT preserves all Oracle requirements and adds the separately tracked [EX/temporal acceptance overlay](docs/EX_ALIGNMENT_ACCEPTANCE.md). Legacy 23/24 counts and I0–I12 mapping do not verify those 15 additional rows or corrected semantic clauses.

## ERC-8415 integration status

Oracle is the integration layer for ERC-8415 applications.

The intended direction is:

```text
Application
    |
Oracle API
    |
ERC-8415 projection layer
    |
ERC-8415 standard
```

The repository contains the projection foundation and integration design. Production application integration, institutional registrar operation and external deployment verification remain separate delivery stages.

Important semantic rules:

- confirmed holder is not replaced by ERC-721 `ownerOf`;
- finality is not freshness;
- projection gaps are not rejection events;
- Oracle does not redefine ERC-8415 semantics.

## Application-facing role

Oracle provides a controlled application boundary:

- applications consume verified projection information through Oracle;
- applications do not access internal projection infrastructure directly;
- write operations remain controlled by authentication, authorization and operational safeguards.

Oracle is not a vertical application. ArtFi and other RWA applications consume Oracle services.

The read-only [application projection API](docs/APPLICATION_PROJECTION_API.md) exposes
the Kit temporal surface through Oracle with an explicit server-owned source binding.
Its runtime assembly and synthetic regression evidence do not establish deployment
or institutional commissioning.

## Security defaults

- The development server binds to `localhost` only.
- External writes are disabled by default.
- Production writes require authenticated control-plane execution.
- No caller-supplied source authority is accepted.
- No production credentials, personal data, source documents or signing keys belong in this repository.
- Test fixtures are synthetic unless explicitly documented otherwise.

## Verification status

Repository verification includes:

- unit and integration tests;
- ERC-8415 projection conformance tests;
- evidence validation tests;
- negative security boundary tests;
- production configuration validation.

Production commissioning requires additional external evidence:

- deployed production environment;
- institutional source connections;
- operational monitoring;
- production signing and governance procedures.

Code completion is not production commissioning.

## Service surface

The service provides health, protocol and asset-related APIs, including:

- health/readiness endpoints;
- protocol and deployment profile endpoints;
- asset and certificate query endpoints;
- token binding and transfer eligibility queries;
- attestation verification;
- controlled settlement operations.

Write operations remain disabled unless production controls are explicitly enabled.

## Documents

Read in this order:

| Document                                | Purpose                                       |
| --------------------------------------- | --------------------------------------------- |
| `docs/DECISIONS_ZH.md`                  | Architecture decisions and precedence rules   |
| `docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md` | Product requirements                          |
| `docs/ACCEPTANCE_RWA_ORACLE_ZH.md`      | Acceptance criteria and evidence requirements |
| `docs/TRACEABILITY_ZH.md`               | Requirement traceability                      |
| `docs/STATUS.md`                        | Current implementation status                 |
| `docs/GAP_AUDIT_ZH.md`                  | Remaining gaps                                |
| `docs/PRODUCTION_READINESS_ZH.md`       | Production readiness assessment               |

Run verification:

```sh
pnpm run verify
```

## Patent disclosure boundary

The following patent applications may be disclosed by project decision:

| Application                                                                 | Number           | Scope                    |
| --------------------------------------------------------------------------- | ---------------- | ------------------------ |
| Unattended issuance system and method for facts from off-chain data sources | `202611389399.6` | Oracle                   |
| Data-certificate mapping method and system based on an off-chain registry   | `202611389374.6` | ERC registration mapping |

Submission or acceptance does not represent patent grant, production deployment or commercial acceptance.

## License

Oracle uses the proprietary terms in [LICENSE](LICENSE), aligned with ArtFi.
Use, modification, distribution, and deployment of covered material require
written permission, subject to the stated exceptions.
See [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for
attribution, historical references, and prior rights.
