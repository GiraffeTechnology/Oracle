# 仓库与 PRD 的差距审计

| 项目 | 内容 |
| --- | --- |
| 依据 | `PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md` v0.3、`ACCEPTANCE_RWA_ORACLE_ZH.md` v0.3 |
| 审计范围 | **整个仓库**：`main`、`claude/ci-reading-v3bnc2`、`feature/oracle-all-iterations` |
| 审计方法 | 验收标准 §8；证据单元为源文件路径与具名测试 |
| 审计日期 | 2026-08-25 |

> 本文与 `STATUS.md` 的区别：`STATUS.md` 审计**单个 commit**并使用 §2 六值词表；
> 本文审计**仓库整体**的能力覆盖与差距。依验收标准 §3，跨分支证据不能用于认定某个
> commit 的状态，故本文一律不授予 `VERIFIED`，只陈述"某处存在何种证据"。

## 1. 首要结论：主要差距是结构性的，不是功能性的

`feature/oracle-all-iterations` 已实现 PRD v0.3 绝大部分 L2 能力：34 个源模块、12 个测试
文件、83 项通过测试、MySQL 迁移、三个 JSON Schema、四个配置档、SBOM。

但**没有任何一个 commit 同时具备需求、验收标准、实现、测试与 CI**：

| 分支 | 有 | 无 |
| --- | --- | --- |
| `claude/ci-reading-v3bnc2` | PRD v0.3、验收标准、CI（4 job）、追溯快照 | 实质实现（仅 3 个只读端点） |
| `feature/oracle-all-iterations` | 完整实现与 83 项测试 | **无 `.github/`，即无任何 CI**；PRD 为 v0.4，ID 体系为 I0–I12 |

依验收标准 §3（"来自其他 commit、分支的测试结果"不构成证据）与 §8.1（审计确切 commit SHA），
**当前不存在可通过验收的 commit**。这不是实现问题，是分支与 ID 体系分叉问题。

第二个结构性差距：`feature` 分支按 I0–I12 迭代编号组织，PRD v0.3 按 ORACLE/CONSUMER/NFR
编号组织，两套体系之间**没有追溯映射**。验收标准 §8.4 要求逐 ID 双向覆盖，当前无法机械执行。

## 2. L2 验证层（ORACLE-*）覆盖与差距

| ID | 覆盖 | 证据（`feature` 分支） | 差距 |
| --- | --- | --- | --- |
| ORACLE-001 | 充分 | `src/domain/source-registry.js`、`schema-registry.js`、`key-set-registry.js`、`adapters/fixed-source-transport.js`；测试"requires a registered active source and approved schema""rejects caller-supplied endpoint fields""revoked source key sets fail closed""OpenAPI declares no caller-selectable server endpoint" | 注册表变更的**审批记录**未与 `dual-control.js` 打通 |
| ORACLE-002 | 部分 | `oracle-status.js` 导出且仅导出 PRD 八状态（测试"exports exactly the PRD public statuses"）；`token eligibility endpoint reflects Oracle status` | **八状态缺少各自的正向用例**；PRD 九项事实查询未逐项验证；部分可用降级测试缺失 |
| ORACLE-003 | 充分 | `attestation-service.js`、`signer-set-policy.js`、`canonical-json.js`、`sdk/verifier.js`；测试覆盖 subject 绑定、过期、撤销、nonce 重用、门限不足、跨用途重放 | **跨链 / 跨合约 / 跨 Token 重放**与 **schema 版本不符**无具名负向测试 |
| ORACLE-004 | 充分 | `revocation-registry.js`、`outbox.js`、`outbox-dispatcher.js`、`subscription-signer.js`、`reason-code-registry.js`；测试覆盖独立审批、有序重试、幂等确认、签名绑定 delivery id | 撤销后**下游转让失败**需 L3 消费者验证；撤销传播延迟 SLI 无量化报告 |
| ORACLE-005 | 部分 | `export-gate.js`、`authorizer.js`；测试"export gate requires purpose and permission" | KYC/AML/制裁/辖区**资格状态证明本身**未实现；字段级"只返回状态不返回资料"测试缺失 |
| ORACLE-006 | 充分 | 测试"public schemas exclude financial opinions""metrics expose numeric counters and gauges only"；另有本分支 CI 关键词门禁 | 二者不在同一 commit |
| ORACLE-007 | 充分 | `ports/evidence-vault-port.js`、schema 敏感字段剥离；测试"raw evidence vault exposes only a digest""schema registry strips sensitive public fields""public listing omits key set identifiers" | **跨境字段最小化清单**未建立；扫描类证据在本分支 |
| ORACLE-008 | 充分 | `audit-journal.js`、`command-journal.js`、`audit-export.js`、`state-rebuilder.js`、`business-calendar.js`；测试覆盖哈希链、状态重建、导出防篡改与注入、故障注入下不变量 | **T+3 日历版本化记录**与 UTC 存储/时区展示的具名测试缺失 |
| ORACLE-009 | 充分 | 测试"all write methods are rejected""SBOM confirms no third-party runtime components" | 合同侧条款核查为非工程项 |
| ORACLE-010 | 充分 | `sdk/verifier.js`、`protocol/protocol-profile.js`；测试覆盖离线验证、L3 双接口 + ERC-8325、字节级 artifact 校验、pending 保持 owner、finalize 原子性且不依赖事件顺序 | — |
| ORACLE-011 | **缺失** | 仅 `src/admin-ui.js`（管理后台，测试"admin dashboard is read-only and protected against framing"） | **无资产详情页**：一物一 NFT 标识、证书哈希/版本、仓单、T+0/T+3 进度、四种交易期状态区分展示、来源与到期时间可见 —— 全部未实现 |

## 3. 下游消费约束（CONSUMER-*）：以合成消费者证明可强制

| ID | 覆盖 | 差距 |
| --- | --- | --- |
| CONSUMER-001 | 充分 | 测试"token binding is one-to-one and idempotent""record store maintains append-only certificate versions"；份额化请求拒绝无具名测试 |
| CONSUMER-002 | 部分 | 七项发行前置**未逐项做缺失负向测试** |
| CONSUMER-003 | 部分 | `state-engine.js` 拒绝非法与非递增迁移；**九状态合法迁移未全覆盖** |
| CONSUMER-004 | 部分 | "L3 pending observation preserves owner and blocks transfers"；快照哈希内容完整性、重复事件幂等、质押/重复挂牌拒绝无具名测试 |
| CONSUMER-005 | 充分 | "settlement requires complete evidence and upgrades the certificate""L3 finalize observation verifies atomic version and event set" |
| CONSUMER-006 | 部分 | 六类场景中仅**超时、争议**有具名测试；拒绝、数据冲突、乱序、重放缺失；退款通知触发无证据 |
| CONSUMER-007 | **缺失** | 全仓库 `REDEEMED` / `redeem` **0 命中**：提货终止语义完全未实现 |
| CONSUMER-008 | **仅缺证据** | 全仓库订单簿/撮合 **0 命中**（符合要求），但缺少**证明其不存在**的测试 |
| CONSUMER-009 | 充分 | "offline verifier rejects cross-purpose replay""production ports fail closed when any dependency is absent""verification endpoint fails closed without a configured verifier" |

## 4. 非功能（NFR-*）

| ID | 覆盖 | 差距 |
| --- | --- | --- |
| NFR-001 | 充分 | `protected-signer.js`、`dual-control.js`、`signer-set-policy.js`；测试"admin cannot directly set VALID""dual control rejects self approval"。差距：**timelock 与回滚演练**无记录 |
| NFR-002 | 充分 | nonce 重用、跨用途重放、追加式版本、非递增迁移拒绝。差距：绑定字段**完整性**（chainId/合约/TokenId/schema 版本）无逐字段测试 |
| NFR-003 | 充分 | "loads fail-closed development defaults""rejects non-loopback binds""rejects enabling external writes""production ports fail closed""three source adapters reject conflict delay offline" |
| NFR-004 | **缺失** | `backup-manifest.js`、`retention-policy.js`、`reconciler.js`、`metrics.js` 存在且有测试，但 **99.9% 压测报告与五项演练（对账、灾备、密钥轮换、证书冲突、数据源中断）的实际执行记录全部没有** |

## 5. 前提取证（PREMISE-P1~P8）

**完全缺失**：全仓库 `premise` / 前提取证相关 0 命中。PRD §1 八条前提无书面依据、取证日期、
复核周期与责任人。依验收标准 §4.4，P1–P4 缺任一即阻断 Stage F。

## 6. 差距归类与优先级

**A 类 — 结构性（最高优先，且成本最低）**

1. 分支合并：`feature` 的实现与本分支的 PRD/验收/CI 必须落到同一 commit，否则任何证据都不成立；
2. PRD 版本裁决：v0.3（本分支）与 v0.4（feature 分支）文件名与 ID 体系均不同，须二选一；
3. 建立 I0–I12 与 ORACLE/CONSUMER/NFR 的追溯映射，使 §8.4 可机械执行；
4. `feature` 分支的 `scripts/verify-iterations.mjs` 存在 reporter 缺陷（管道输出为 TAP，
   而断言匹配 `✔`），导致机器验收报告恒为全阻断；加 `--test-reporter=spec` 即修复。

**B 类 — 真实功能缺失**

1. ORACLE-011 资产详情 UI（四种交易期状态区分展示）；
2. CONSUMER-007 `REDEEMED` 提货终止语义；
3. ORACLE-005 合规资格状态证明。

**C 类 — 实现已在、缺具名测试**

ORACLE-002 八状态正向用例、ORACLE-003 跨链/跨合约/跨 Token 重放、ORACLE-008 日历版本化与
时区、CONSUMER-002/003/004/006 的逐项负向场景、CONSUMER-008 不存在性证明、NFR-002 绑定字段
完整性。

**D 类 — 非工程可解**

PREMISE-P1~P8 取证、NFR-004 压测与五项演练、PRD §0.1 ArtFi 三项互斥裁决、§0.2 契约签署、
法务 go/no-go（`PENDING-GATE`）。

## 7. 本审计未覆盖

未审计 `feature` 分支代码的正确性与安全性（仅审计覆盖面与证据存在性）；未执行压测、
渗透测试或依赖审计；未复核 MySQL 迁移在真实数据库上的行为。
