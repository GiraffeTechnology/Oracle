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

Use Node.js 24 or the pinned workspace runtime and run:

```text
node scripts/syntax-check.mjs
node --test "test/*.test.js"
node scripts/repository-scan.mjs
```

The public service exposes:

- `GET /healthz`
- `GET /readyz`
- `GET /v1/oracle/statuses`
- `GET /v1/rwa/assets/{assetId}`
- `GET /v1/rwa/assets/{assetId}/certificate-history`
- `GET /v1/rwa/tokens/{chainId}/{contract}/{tokenId}`
- `GET /v1/rwa/tokens/{chainId}/{contract}/{tokenId}/eligibility`
- `GET /v1/rwa/attestations/{attestationId}`
- `GET /v1/rwa/settlements/{settlementId}`
- `POST /v1/rwa/attestations/verify` (computational verification only)
- `GET /admin` (read-only status page)

Authoritative writes are implemented behind the RBAC/dual-control service layer and production ports,
but are not exposed by the default HTTP runtime. Production mode remains a deliberate release gate.

See `docs/PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md` for the staged delivery plan.
