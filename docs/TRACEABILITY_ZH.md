# 需求与迭代追溯映射

| 项目 | 内容 |
| --- | --- |
| 数据源 | `config/iteration-acceptance.json` 的 `requirementIds` 字段 |
| 权威需求 | `PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md` v0.3，24 个在范围 ID |
| 强制校验 | `scripts/check-scope-coverage.mjs`（CI 作业 `integration-gates`） |

## 为什么需要这份映射

实现按 **I0–I12 迭代**组织，PRD 按 **ORACLE/CONSUMER/NFR 需求**组织。两套体系此前分处两条
分支且无映射，导致验收标准 §8.4 要求的"逐 ID 双向覆盖核对"无法机械执行 —— 这正是整合前
不存在可验收 commit 的原因之一。

本文件由 manifest 渲染而非手写。守卫校验双向一致：任一 PRD 需求无迭代认领、或迭代认领了
PRD 未定义的 ID，CI 即失败。

## 迭代 → 需求

| 迭代 | 认领的需求 | 制品数 | 具名测试数 |
| --- | --- | --- | --- |
| `I0` | `NFR-001` | 8 | 3 |
| `I1` | `ORACLE-001`, `ORACLE-007`, `ORACLE-008` | 7 | 4 |
| `I2` | `ORACLE-001`, `ORACLE-007` | 3 | 3 |
| `I3` | `CONSUMER-001` | 3 | 3 |
| `I4` | `ORACLE-002`, `NFR-002` | 4 | 3 |
| `I5` | `ORACLE-003`, `ORACLE-010`, `NFR-001`, `NFR-002` | 3 | 4 |
| `I6` | `ORACLE-005`, `ORACLE-006`, `ORACLE-007` | 4 | 5 |
| `I7` | `ORACLE-004` | 4 | 4 |
| `I8` | `ORACLE-008`, `ORACLE-009`, `CONSUMER-004`, `CONSUMER-005`, `CONSUMER-006`, `CONSUMER-008` | 3 | 3 |
| `I9` | `ORACLE-001`, `NFR-003` | 3 | 3 |
| `I10` | `ORACLE-011`, `NFR-001` | 5 | 5 |
| `I11` | `ORACLE-010`, `CONSUMER-002`, `CONSUMER-003`, `CONSUMER-007`, `CONSUMER-009` | 4 | 4 |
| `I12` | `NFR-004` | 8 | 5 |

## 需求 → 迭代

| 需求 | 标题 | 由哪些迭代覆盖 |
| --- | --- | --- |
| `ORACLE-001` | 权威数据源注册 | `I1`, `I2`, `I9` |
| `ORACLE-002` | 事实查询 | `I4` |
| `ORACLE-003` | 签名证明 | `I5` |
| `ORACLE-004` | 撤销与紧急冻结 | `I7` |
| `ORACLE-005` | 主体合规结论隔离 | `I6` |
| `ORACLE-006` | 禁止金融输出 | `I6` |
| `ORACLE-007` | 隐私与数据最小化 | `I1`, `I2`, `I6` |
| `ORACLE-008` | 审计与可追溯 | `I1`, `I8` |
| `ORACLE-009` | 金融隔离（Giraffe 自身义务） | `I8` |
| `ORACLE-010` | 消费适配器与 SDK | `I5`, `I11` |
| `CONSUMER-001` | 一物一证一 NFT | `I3` |
| `CONSUMER-002` | 初始发行 | `I11` |
| `CONSUMER-003` | 生命周期 | `I11` |
| `CONSUMER-004` | T+0 快照与冻结 | `I8` |
| `CONSUMER-005` | T+3 交割 | `I8` |
| `CONSUMER-006` | T+3 失败与超时 | `I8` |
| `CONSUMER-007` | 提货与终止 | `I11` |
| `CONSUMER-008` | 外部交易兼容 | `I8` |
| `CONSUMER-009` | 证明消费失败关闭 | `I11` |
| `ORACLE-011` | 资产详情展示 | `I10` |
| `NFR-001` | 密钥与权限 | `I0`, `I5`, `I10` |
| `NFR-002` | 防重放与顺序保证 | `I4`, `I5` |
| `NFR-003` | 默认关闭 | `I9` |
| `NFR-004` | 可用性与恢复 | `I12` |

## 边界说明

- `CONSUMER-*` 依 PRD §3.2 不是本项目的实现交付物；上表中的迭代只承担"证明该约束在 Oracle
  侧可被强制"的义务，不代表 L3 协议已实现或部署。
- 映射覆盖完整**不等于**需求已验证。各需求的实际状态见 `STATUS.md`，阶段门见验收标准 §5。
