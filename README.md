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

See `docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md` (v0.3) for requirements and
`docs/ACCEPTANCE_RWA_ORACLE_ZH.md` for how each requirement must be evidenced.
`docs/STATUS.md` records the current per-requirement status.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

- `verify` — installs with a frozen lockfile on the pinned Node.js runtime and runs
  `pnpm run verify` (format check, typecheck, ORACLE-006 financial-output gate, tests).
- `smoke` — boots the service and probes the three exposed routes, asserting that a write
  method is rejected with `405`.

`scripts/check-no-financial-output.mjs` enforces ORACLE-006: valuation, price, collateral,
yield, credit and investment-suitability fields, and the prohibited public claims in section 12
of the PRD, fail the build if they appear on the service surface.
