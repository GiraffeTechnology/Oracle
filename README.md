# Giraffe RWA Oracle

Implementation and deployable configuration for the Giraffe L2 Oracle. L3 is an independent protocol
project; this repository only provides a synthetic consumer and a read-only verification SDK proving
that invalid Oracle evidence cannot pass. ERC publication, NFT issuance, trading, custody and financial
services remain outside this repository.

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
node scripts/verify-prd-v0.4.mjs
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
- `GET /v1/rwa/tokens/{chainId}/{contract}/{tokenId}/certificate-history`
- `GET /v1/rwa/tokens/{chainId}/{contract}/{tokenId}/transfer-eligibility`
- `GET /v1/rwa/attestations/{attestationId}`
- `GET /v1/rwa/settlements/{settlementId}`
- `POST /v1/rwa/attestations/verify` (computational verification only)
- `POST /v1/rwa/settlements` (authenticated; disabled by default)
- `POST /v1/rwa/settlements/{settlementId}/finalize` (authenticated; disabled by default)
- `POST /v1/rwa/settlements/{settlementId}/cancel` (authenticated; disabled by default)
- `POST /v1/rwa/revocations` (dual control; disabled by default)
- `GET /admin` (read-only status page)

The complete non-secret L2 profile and non-normative L3 compatibility pin live in `config/`. Production mode
starts only with an absolute, regular deployment module and exact SHA-256 pin; authoritative writes then use
authenticated fixed-reference sources, RBAC/dual control, protected signing, and atomic MySQL durability.
Production commissioning and Stage F approval remain deliberate external release gates.

See `docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md`, `docs/ACCEPTANCE_RWA_ORACLE_ZH.md`, and `docs/STATUS.md`.

## Documents

Read in this order. `docs/DECISIONS_ZH.md` wins over anything that contradicts it.

| Document                                | What it settles                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `docs/DECISIONS_ZH.md`                  | Decisions of record: authoritative PRD, priority testnet, precedence rule, and what remains undecided |
| `docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md` | Requirements (v0.3) — 24 in-scope IDs                                                                 |
| `docs/ACCEPTANCE_RWA_ORACLE_ZH.md`      | How each requirement must be evidenced, the six-value status vocabulary, and the stage gates          |
| `docs/TRACEABILITY_ZH.md`               | Maps the I0–I12 iteration scheme onto the ORACLE/CONSUMER/NFR requirement IDs                         |
| `docs/STATUS.md`                        | Per-requirement status of **this commit**                                                             |
| `docs/GAP_AUDIT_ZH.md`                  | Gap between the repository and the PRD                                                                |
| `docs/PRODUCTION_READINESS_ZH.md`       | Assessment against the release blockers and the delivery definition                                   |
| `docs/TESTNET_TASK_HOODI_ZH.md`         | Testnet execution brief (Hoodi, a test chain — not production)                                        |
| `docs/erc/`                             | Reference archive for the separate ERC project, with its own README                                   |

Run every gate at once with `pnpm run verify`.
