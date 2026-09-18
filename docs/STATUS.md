# Giraffe RWA Oracle v0.4 证据快照

本文件是状态索引，不是完成声明。权威需求为 `PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md`，权威验收规则为 `ACCEPTANCE_RWA_ORACLE_ZH.md`。任何提交、推送、PR 或 CI 启动均不自动改变状态。

## 整合说明（2026-08-28）

本快照所描述的实现、需求、验收与 CI 现已位于**同一 commit**（issue #5 已处理，分支
候选分支 / PR #2，现已合入 `main`）。整合前实现与需求分处两条分支，依验收标准 §3 与 §8.1
无法构成任何 commit 的证据。

本地实测（Node 22.22.2，2026-09-18 复测）：`node --test "test/*.test.js"` **401 项通过**；
`node scripts/run-erc-tests.mjs`（hardhat）**13 项通过**，含共享 ERC-8415 投影向量；
`node scripts/verify-prd-v0.4.mjs` 报 23/24 工程侧已验证，仅 NFR-004 待外部证据，退出码 1；
`node scripts/verify-iterations.mjs` 报 I0–I11 completed、I12 blocked。

**复测更正**：上一版此处记为 217 项，系整合时的数字，已被后续提交超过。`verify-iterations`
的那句在复测时一度**不可复现** —— 脚本因 `config/iteration-acceptance.json` 仍写
`prdVersion: "v0.3"` 而在产出任何报告前抛 `ITERATION_PRD_VERSION_MISMATCH`。依 D-001，
权威 PRD 已于 2026-09-03 升至 v0.4 且需求 ID 集合未变，故该字段与
`test/iteration-traceability.test.js` 中同样硬编码的 `v0.3` 断言一并更正。
另有一处：I11 的验收测试名仍写着 D-008 之前的冻结语义
（`L3 pending observation preserves owner and blocks transfers`），而套件中的测试早已按
D-008 改名为 `... accepts a moved owner and rejects blocked transfers`，已同步。
三处更正均为陈旧指针，未改动任何需求、范围或判定。

**表中"`VERIFIED`（本地工程候选）"仍未转为正式 `VERIFIED`** —— 但阻断原因已经改变，
此处更正：

issue #4（Actions 配额）**已解除**。CI 现为绿：workflow run #254 在本 commit
（`f2ba4bc`）上全部作业成功，近期运行亦全部 success。因此"CI 全红"不再是阻断理由。

仍未转正的实际原因是验收标准 §6 的**必需作业清单未被真正覆盖**。`.github/workflows/ci.yml`
的作业**名称**与 §6 对应（`format-lint-typecheck`、`production-build` 等），但其中两项
并不执行其名称所指的工作：

| 作业 | §6 要求 | 实际执行 |
| --- | --- | --- |
| `format-lint-typecheck` | 格式化、lint、TypeScript 全量类型检查 | 仅 `node scripts/syntax-check.mjs` |
| `production-build` | 生产构建 | `syntax-check` + `verify-release.mjs`，无构建步骤 |

`pnpm run typecheck`（`tsc --noEmit`）与 `pnpm run format:check` 在本地均通过，但**未在 CI 中运行**，
因此不构成 §6 所要求的"被审 commit 上的绿灯作业"。这是一处名实不符的门禁，属实现缺口，
不在本次文档更正范围内，另行处理。

I0–I12 与 ORACLE/CONSUMER/NFR 的追溯映射见 `TRACEABILITY_ZH.md`。

## 当前状态

| 范围 | 状态 | 证据边界 |
| --- | --- | --- |
| ORACLE-001~011 | `VERIFIED`（本地工程候选） | `npm run verify:prd` 中的语法、111 项 Node 测试、仓库扫描与逐 ID 验证；仍需同一 commit CI 复验 |
| CONSUMER-001~009 | `VERIFIED`（Oracle 侧合成消费者） | 仅证明 Oracle 侧可以强制 fail-closed；不表示 L3 ERC 已实现或部署 |
| NFR-001~003 | `VERIFIED`（本地工程候选） | 受保护签名适配、双人控制、顺序/重放与来源故障注入 |
| NFR-004 | `PENDING-GATE` | 真实 72 小时、正式负载/容量、恢复、受保护签名人轮换等验收证据未齐 |
| PREMISE-P1~P8 | `PENDING-GATE` | 书面依据、取证日期、复核周期与责任人尚未形成全部可公开审计记录 |
| Stage F | `PENDING-GATE` | 独立法律、隐私、安全、合约、运营审查，以及范围/报价和逐司法辖区 go/no-go 未齐 |

机器可读快照由 `scripts/verify-prd-v0.4.mjs` 生成至 `output/prd-v0.4-acceptance-report.json`。该脚本在任何适用门禁未满足时必须非零退出并保持 `allComplete=false`。外部证据必须通过内容校验并绑定同一候选 commit；仅创建文件不能解除门禁。历史提交的 72 小时或其它证据不得替代当前候选证据。

## 产品线裁决

当前按 PRD §0.1 的“裁决 A：独立产品线”实现：Oracle 仓库不依赖、不复用 ArtFi 的份额化合约、交易模块、数据库或 37×100 慈善资产数据集。正式签署的商务范围变更仍属于 Stage F 门禁。

## 数据安全

仓库只包含合成数据。生产密钥、真实个人资料、完整证书、完整仓单、服务器地址和凭据均不得进入 GitHub、CI 输出或公开 API。
