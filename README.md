# Giraffe RWA Oracle

Oracle-only implementation for authoritative RWA registry, certificate, warehouse and settlement
attestations. ERC proposals, NFT issuance, trading, custody and financial services are outside this
repository.

## Security defaults

- The development server binds to `localhost` only.
- External writes are disabled and cannot be enabled by this iteration.
- No caller-supplied source endpoint is accepted.
- No production credentials, personal data, source documents or signing keys belong in this repo.
- All test fixtures are synthetic.

## Local verification

Use the pinned workspace Node.js runtime and run:

```text
pnpm run verify
```

The initial service exposes only:

- `GET /healthz`
- `GET /readyz`
- `GET /v1/oracle/statuses`

## Documents

Read in this order. `docs/DECISIONS_ZH.md` wins over anything that contradicts it.

| Document                                | What it settles                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `docs/DECISIONS_ZH.md`                  | Decisions of record: authoritative PRD, priority testnet, precedence rule, and what remains undecided |
| `docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md` | Requirements (v0.3) — 24 in-scope IDs                                                                 |
| `docs/ACCEPTANCE_RWA_ORACLE_ZH.md`      | How each requirement must be evidenced, the six-value status vocabulary, and the stage gates          |
| `docs/STATUS.md`                        | Per-requirement status of **this commit**                                                             |
| `docs/GAP_AUDIT_ZH.md`                  | Gap between the **whole repository** and the PRD, across all branches                                 |
| `docs/PRODUCTION_READINESS_ZH.md`       | Assessment against the release blockers and the delivery definition                                   |
| `docs/TESTNET_TASK_HOODI_ZH.md`         | Testnet execution brief (Hoodi, a test chain — not production)                                        |
| `docs/erc/`                             | Reference archive for the separate ERC project, with its own README                                   |

Status in one line: **not a production candidate**; six release blockers stand and three of
24 requirements are `VERIFIED`. See `docs/PRODUCTION_READINESS_ZH.md`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

- `verify` — installs with a frozen lockfile on the pinned Node.js runtime and runs
  `pnpm run verify` (format check, typecheck, ORACLE-006 financial-output gate, tests).
- `smoke` — boots the service and probes the three exposed routes, asserting that a write
  method is rejected with `405`.

`scripts/check-no-financial-output.mjs` enforces ORACLE-006: valuation, price, collateral,
yield, credit and investment-suitability fields, and the prohibited public claims in section 12
of the PRD, fail the build if they appear on the service surface.
