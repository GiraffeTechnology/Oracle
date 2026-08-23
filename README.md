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

See `docs/PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md` for the staged delivery plan.
