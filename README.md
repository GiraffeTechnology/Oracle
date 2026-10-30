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

## Current complete-product execution (2026-10-17)

Read [config/current-prd.json](config/current-prd.json), then the complete pinned v0.4 [PRD](docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md) and its v0.4 acceptance configuration on every start, resume, intake and handoff. The current public PRD is already English despite its stable historical filename. Do not replace it with a local v0.3 translation or revive an obsolete combined L2/L3 draft. The source blob is `77fdb78685f4d6404609b7b546918384e8b339c3`; full UTF-8 SHA256 is `1d285d23ddbc0c36e57cb1d3b34467f5f57985a3a8e7f953808d3011c9f58631`.

Original Oracle implements the complete applicable PRD and integration in bounded stages. After opening a stage PR, continue the next independent authorized stage without waiting for its CI. Existing independent review, required CI and merge controls still apply. A future-stage dependency blocks only actions that actually depend on it; do not add documentation-first, whole-project-ready or repeated authorization gates. Keep completed unchanged evidence and do not rerun it without a changed input or a concrete concern.

Control2 retains overall coordination, dependency removal, integrated full delivery and owner reporting. Independent review/established CI and merge remain with the existing reviewer; this does not transfer Oracle implementation to the coordinator or reviewer. Preserve all still-valid historical authorizations and original environment, source-authority and secret-custody boundaries. Record exact refused actions and raw errors; never bypass a tool/system refusal or expand a local failure into a global stop.

Full delivery requires every applicable requirement and stage, interface integration, actual runtime and acceptance evidence bound to exact source commit, artifact hash, served identity and real scenario results. Where applicable, include transaction/receipt, authoritative state and application readback. Source, a package, synthetic tests or CI alone are not complete delivery. Retain audit history after delivery. ERC-8415 remains the normative protocol authority; this execution update does not create protocol semantics or production permission.

## Historical implementation snapshot (2026-09-20)

This repository has progressed beyond a verification-only prototype. Current implementation includes:

### Completed implementation

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
