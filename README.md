# Giraffe RWA Oracle

Implementation and deployable configuration for the Giraffe L2 Oracle plus its version-pinned L3
certificate-settlement protocol integration. ERC publication, NFT issuance, trading, custody and
financial services remain outside this repository.

## Security defaults

- The development server binds to `localhost` only.
- External writes are disabled by default; production writes require both production and authenticated
  control-plane acknowledgements plus deployment-resolved dependencies.
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
- `GET /v1/oracle/deployment-profile`
- `GET /v1/oracle/protocol-profile`
- `GET /v1/rwa/assets/{assetId}`
- `GET /v1/rwa/assets/{assetId}/certificate-history`
- `GET /v1/rwa/tokens/{chainId}/{contract}/{tokenId}`
- `GET /v1/rwa/tokens/{chainId}/{contract}/{tokenId}/eligibility`
- `GET /v1/rwa/attestations/{attestationId}`
- `GET /v1/rwa/settlements/{settlementId}`
- `POST /v1/rwa/attestations/verify` (computational verification only)
- `GET /admin` (read-only status page)

The complete non-secret L2 and L3 profiles live in `config/`. Authoritative writes are implemented behind
the RBAC/dual-control service layer and production ports, but are not exposed by the default HTTP runtime.
Production commissioning and approval remain deliberate external release gates.

See `docs/PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md` for the staged delivery plan.

