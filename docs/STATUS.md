# Giraffe RWA Oracle 需求状态快照

| 项目 | 内容 |
| --- | --- |
| 依据 | `PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md` v0.3、`ACCEPTANCE_RWA_ORACLE_ZH.md` v0.3 |
| 被审对象 | 本文件所在提交，分支 `claude/ci-reading-v3bnc2` |
| 审计方法 | 验收标准 §8；状态取 §2 六值词表 |
| 当前阶段 | **G-A 进行中**；G-B 至 G-F 未达成 |
| 结论 | 24 条在范围需求中 **3 条 `VERIFIED`**；不得使用"完成""交付""通过""可上生产" |

> 按验收标准 §2，保留词仅在同一 commit 上全部适用验收项均为 `VERIFIED` 时方可使用。
> 本快照不满足该条件，故本仓库当前状态**不是**"已交付"。

## 1. 总览

| 状态 | 数量 | ID |
| --- | --- | --- |
| `VERIFIED` | 3 | ORACLE-006、ORACLE-009（代码侧）、NFR-003（默认关闭部分） |
| `IMPLEMENTED-NOT-VERIFIED` | 2 | ORACLE-001、ORACLE-007 |
| `NOT-IMPLEMENTED` | 18 | ORACLE-002~005、008、010、011；CONSUMER-001~009；NFR-001、002、004 |
| `PENDING-GATE` | 1 | 主网/真实资产/真实资金启用（法务 go/no-go） |
| `BLOCKED` | 0 | — |
| `OUT-OF-SCOPE` | 0 | — |

`CONSUMER-*` 依 PRD §3.2 不是本项目实现物；本项目义务是以合成消费者证明约束可强制，
该合成消费者尚未建立，故记 `NOT-IMPLEMENTED`，不得记为 `OUT-OF-SCOPE`。

## 2. L2 验证层（ORACLE-*）

| ID | 状态 | 证据 / 缺口 |
| --- | --- | --- |
| ORACLE-001 | `IMPLEMENTED-NOT-VERIFIED` | 批准来源注册表仅存标识符，拒绝任意 URL 与未知来源：`src/config.ts`、`src/config.test.ts`（"accepts only approved authority identifiers"、"stores identifiers only"）。缺口：无摄取路径实际使用该注册表，无注册表变更审批记录 |
| ORACLE-002 | `NOT-IMPLEMENTED` | 八状态词表已实现并测试：`src/oracle-status.ts`、`GET /v1/oracle/statuses`。缺口：九项事实查询（登记存在性、1:1、证书哈希/版本、仓单、所有者承诺、冻结/查封、可转让性、T+0/T+3、过期撤销）全部缺失 |
| ORACLE-003 | `NOT-IMPLEMENTED` | 无证明签发、无签名集合、无 nonce/有效期/撤销引用 |
| ORACLE-004 | `NOT-IMPLEMENTED` | 无撤销与紧急冻结路径，无订阅事件 |
| ORACLE-005 | `NOT-IMPLEMENTED` | 无 KYC/AML/制裁/辖区资格状态接口 |
| ORACLE-006 | **`VERIFIED`** | 门禁 `scripts/check-no-financial-output.mjs` + CI job；反向验证：植入 `collateralRatio` 与 "Guaranteed return" 均触发失败。范围限定：当前对外面仅三个端点 |
| ORACLE-007 | `IMPLEMENTED-NOT-VERIFIED` | 密钥与个人信息扫描 `scripts/check-repository-hygiene.mjs` + CI job，反向验证通过（密码、邮箱、身份证号）。缺口：ABI/event/metadata/数据库导出无扫描对象；跨境字段最小化清单未建立 |
| ORACLE-008 | `NOT-IMPLEMENTED` | 无审计记录、无 T+0→T+3 重放、无版本化 T+3 日历 |
| ORACLE-009 | **`VERIFIED`**（代码侧） | 无金融写接口、无资金路径、无按交易额计费：`src/server.ts` 全部写方法返回 405（`src/server.test.ts` "exposes no write endpoint"），CI 冒烟作业断言 `POST → 405`。合同侧条款核查为 `PENDING-GATE` |
| ORACLE-010 | `NOT-IMPLEMENTED` | 无证明验证库或消费适配器。`docs/erc/` 为参考归档，其守卫校验的是 ERC 常量，不是 Oracle 证明 |
| ORACLE-011 | `NOT-IMPLEMENTED` | 无 UI |

## 3. 下游消费约束（CONSUMER-*）

CONSUMER-001~009 全部 `NOT-IMPLEMENTED`：合成消费者未建立，无法证明约束在 Oracle 侧可强制。
其前置是 ORACLE-003 证明签发能力。

## 4. 非功能（NFR-*）

| ID | 状态 | 证据 / 缺口 |
| --- | --- | --- |
| NFR-001 | `NOT-IMPLEMENTED` | 仓库密钥扫描已就位（见 ORACLE-007 行）。缺口：多签/门限签名配置、管理员无绕过路径负向测试、timelock 与回滚演练均不存在 |
| NFR-002 | `NOT-IMPLEMENTED` | 无证明，故无绑定字段可测 |
| NFR-003 | **`VERIFIED`**（默认关闭部分） | 失败关闭至 `NOT_VERIFIED`：`src/oracle-status.ts`（"fails closed to NOT_VERIFIED"）；外部写入无开关、仅绑定 loopback：`src/config.ts`、`src/config.test.ts`（"binds to loopback only"、"keeps external writes disabled"）。缺口：数据源不可用/冲突/超时三类注入测试无注入对象 |
| NFR-004 | `NOT-IMPLEMENTED` | 无压测、无队列恢复、五项演练均未进行 |

## 5. 前提取证（PREMISE-P1~P8）

全部 `NOT-IMPLEMENTED`：PRD §1 八条前提尚无书面依据、取证日期、复核周期与责任人。
依验收标准 §4.4，P1–P4 缺任一即阻断 Stage F。

## 6. 阶段门

| 门 | 状态 | 说明 |
| --- | --- | --- |
| G-A | 进行中 | 版本化契约与 P1–P8 取证表未完成；PRD §0.2 契约项未启动 |
| G-B | 未达成 | 要求 ORACLE-001~009 与 NFR-001~003 全部 `VERIFIED`；当前 3 条 |
| G-C~G-E | 未达成 | 前置门未通过 |
| G-F | 未达成 | 另含 §0.1 裁决、§0.2 契约与法务 go/no-go |

主网、真实资产、真实资金启用为 `PENDING-GATE`，前置条件为 G-F 全部退出条件。
依验收标准 §2.1，技术测试全绿**不解除**该门禁；亦不得记为 `BLOCKED` 或 `OUT-OF-SCOPE`。

## 7. 未决冲突（需裁决，非工程项）

1. **PRD 版本分叉**：本分支为 v0.3（`PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md`）；
   分支 `feature/oracle-all-iterations` 为 v0.4（`PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md`，
   文件名与 ID 体系均不同）。两者不能同时为权威版本。
2. **PRD §0.1 ArtFi 结构性互斥**三项冲突（份额化、撮合、慈善版数据集）尚未裁决。
3. **PRD §0.2 范围与排期契约**未签署。

## 8. CI 覆盖对照（验收标准 §6）

| §6 必需作业 | 状态 |
| --- | --- |
| 锁定依赖安装与 lockfile 校验 | 已有（`pnpm install --frozen-lockfile`） |
| 格式化、lint、TypeScript 全量类型检查 | 已有（prettier + `tsc --noEmit`） |
| 单元测试与负向测试套件 | 已有（28 项） |
| 金融输出门禁扫描 | 已有 |
| 个人信息门禁扫描 | 已有 |
| 密钥、私钥、生产凭证扫描 | 已有 |
| 生产构建 | 不适用：当前运行时为类型擦除，无构建产物 |
| 契约测试（schema 兼容性与 API 契约） | 缺失：无 OpenAPI 与证明 schema |
| 合成消费者集成测试 | 缺失：CONSUMER-* 未实现 |
| 数据库迁移/备份/恢复/反向迁移 | 缺失：本迭代无数据库 |

CI 在被审 commit 上全绿，但依 §6 仍有三类必需作业缺失，故不构成 §7 交付定义的满足。
