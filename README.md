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

For authority and current scope, read [AGENTS.md](AGENTS.md), especially §3. ERC-8415 is the normative protocol authority; implementation decisions and historical documents do not override it.

| Document                                | What it settles                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `docs/DECISIONS_ZH.md`                  | Decisions of record: authoritative PRD, priority testnet, precedence rule, and what remains undecided |
| `docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md` | Requirements (v0.3) — 24 in-scope IDs                                                                 |
| `docs/ACCEPTANCE_RWA_ORACLE_ZH.md`      | How each requirement must be evidenced, the six-value status vocabulary, and the stage gates          |
| `docs/TRACEABILITY_ZH.md`               | Maps the I0–I12 iteration scheme onto the ORACLE/CONSUMER/NFR requirement IDs                         |
| `docs/STATUS.md`                        | Recorded per-requirement status; verify its evidence commit                                                             |
| `docs/GAP_AUDIT_ZH.md`                  | Gap between the repository and the PRD                                                                |
| `docs/PRODUCTION_READINESS_ZH.md`       | Assessment against the release blockers and the delivery definition                                   |
| `docs/TESTNET_TASK_HOODI_ZH.md`         | Testnet execution brief (Hoodi, a test chain — not production)                                        |
| `docs/erc/`                             | Reference archive for the separate ERC project, with its own README                                   |

Run every gate at once with `pnpm run verify`.

## 专利申请状态与披露边界

以下申请状态由项目负责人确认；负责人明确允许公开以下专利申请号：

| 申请名称                                   | 申请号           | 关联范围               |
| ------------------------------------------ | ---------------- | ---------------------- |
| 一种链外数据源事实的无人值守出具系统及方法 | `202611389399.6` | Oracle                 |
| 一种基于链下登记簿的数据凭证映射方法及系统 | `202611389374.6` | ERC 登记簿凭证映射标准 |

两项申请均已提交并取得受理通知。申请受理不等于专利授权，也不表示技术交付或生产验收完成。

本次仅披露上述申请名称、申请号及申请状态，不上传受理通知书 PDF、申请材料、个人信息、客户私域数据或其他商业信息。不得要求负责人向 AI 提供保密协议、商业尽调材料或与技术无关的信息，作为更新上述状态或推进无关技术开发、脱敏测试的前提。技术验收仍依据代码、可复核测试及授权范围内的运行证据，不代替任何人的法律或商业签署。

## Current handoff — 2026-09-20

The current bounded direction is the Oracle-owned application API consuming the pinned ERC8415-Kit temporal projection surface: `ArtFi → Oracle → ERC8415-Kit → ERC-8415`. This is the target integration, not a claim that deployment or end-to-end acceptance is complete.

[PR #42](https://github.com/GiraffeTechnology/Oracle/pull/42) contains the documentation corrections and this wrap-up. See [docs/HANDOFF.md](docs/HANDOFF.md) and the dated execution record in [AGENTS.md](AGENTS.md). The completed temporal projection slice is preserved; new settlement, payment, custody, release, and refund delivery is not claimed.

- **Completed this turn:** handoff corrections and read-only deployment discovery. SSH reached abcdYi and the existing MySQL tunnel was active.
- **Not verified/delivered:** Oracle-to-Kit application wiring, database authentication/schema readiness, deployed service, end-to-end acceptance, or a new delivery candidate. No runtime tests or deployment changes were performed in this documentation turn.
- **CI/review:** earlier-head run `35493765989` and one retry returned 12 failed jobs without step/log evidence; the cause remains unconfirmed. Latest-head CI and review must be checked. This handoff does not claim a merge or review-clean result.
- **Deployment boundary:** reuse protected CTYun configuration and the existing CTYun-to-SIN bridge. The inspected bridge allowlist lacked this Oracle task; limited authority assistance was requested from ArtFi 总控 but is not confirmed. Credentials are not published here.
- **Next bounded work:** reconcile the current head, inspect existing API/Kit wiring, complete only missing integration, and produce valid/expired/revoked/source-unavailable evidence. Final production gates remain separate from bounded TEST_ONLY acceptance.

Work is handed off at the user's usage-limit request. Periodic monitoring remains stopped.
