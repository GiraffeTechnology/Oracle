# 项目裁决记录

本文件记录已作出的裁决及其依据。**后续文件与本文件冲突时，以本文件为准。**
新的明确要求可以推翻既有裁决，推翻时必须在此追加条目并注明被取代的编号。

## D-001 权威 PRD 为 v0.3

| 项目 | 内容 |
| --- | --- |
| 裁决 | `docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md` v0.3 为唯一权威需求文档 |
| 日期 | 2026-08-25 |
| 配套 | `ACCEPTANCE_RWA_ORACLE_ZH.md` v0.3（验收）、`STATUS.md`（单 commit 快照）、`GAP_AUDIT_ZH.md`（仓库整体差距） |

被取代：v0.2 `PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md`（已删除）。

**未合并的分歧**：分支 `feature/oracle-all-iterations` 持有 v0.4，文件名
`PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md`，并使用 I0–I12 迭代编号体系。本裁决确立 v0.3 为准，
该分支合并时须将其 I0–I12 映射到 ORACLE/CONSUMER/NFR 体系，而非反向修改 v0.3。

## D-002 优先测试网为 Hoodi

| 项目 | 内容 |
| --- | --- |
| 裁决 | **Hoodi 为优先公链测试网**；Sepolia 降为可选复跑 |
| Chain ID | **560048**（来源：`eth-clients/hoodi` 的 `metadata/config.yaml`，`DEPOSIT_CHAIN_ID: 560048`） |
| 日期 | 2026-08-25 |

**已记录的权衡**：ethereum.org 将 Sepolia 列为应用与合约开发的默认推荐测试网，并说明
Hoodi 的定位是验证者、质押与协议升级测试。技术上两者均可执行本项目的合约测试；本裁决
按明确要求采用 Hoodi 优先。该权衡不构成阻断项，仅作为记录。

**Hoodi 是测试链，不是生产链。** 本裁决只确定"在哪条测试网上跑测试"，不确定任何生产事项：

- 本项目当前**不存在生产链**；Hoodi 不是主网的替代、镜像或预生产环境；
- Hoodi 上**不得**写入真实资产、真实资金、真实证书原文、真实登记引用或任何个人信息，
  只使用合成 fixture（验收标准 §3：合成数据是本阶段的正确形态）；
- Hoodi 上的测试通过**不解除**主网、真实资产、真实资金及各司法辖区的书面 go/no-go。
  依验收标准 §2.1，该门禁是**法律门禁**，状态为 `PENDING-GATE`，技术测试全绿不构成解除条件；
- Hoodi 上的部署地址与交易哈希是测试证据，不得对外表述为产品已上线、已可用或已获批准。

实施要求见 `TESTNET_TASK_HOODI_ZH.md`。**chain ID 一律从 RPC 实际读取并断言，不得硬编码**
——测试套件已按此实现（EIP-712 域随 chainId 变化，硬编码会产生错误的域分隔符）。

## D-005 分支整合与 v0.3 修订选择

| 项目 | 内容 |
| --- | --- |
| 裁决 | `feature/oracle-all-iterations` 的实现已合入 `claude/ci-reading-v3bnc2`（PR #2），形成首个同时包含需求、验收、实现、测试与 CI 的 commit |
| 日期 | 2026-08-28 |
| 关联 | issue #5 |

**v0.3 存在两份修订。** 本次发现两条分支各持一份均标注 v0.3 的 PRD：

| | 字节数 | 差异 |
| --- | --- | --- |
| 本分支原有 | 28,019 | 无 §3.3 |
| `feature` 分支 | 30,922 | 新增 §3.3 主体合规边界；ORACLE-005 更名为"主体合规结论隔离"；§12 更名 |

两者需求 ID 集合完全相同（24 个）。**取 `feature` 分支那份** —— 它是更晚的修订，且实现是按其
编写。D-001 中"v0.3 为权威"因此具体指向本修订。

其他整合决定：

- 删除 `PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md`（v0.4），依 D-001；
- 移除本分支原有的最小服务骨架（`src/config.ts`、`src/server.ts`、`src/oracle-status.ts`、
  `src/index.ts` 及其测试）—— 其保证已由 `src/app.js` 与 `test/app.test.js` 更完整地覆盖，
  保留会造成同一仓库存在两个 Oracle 服务；
- `engines` 定为 `>=22.18.0`：对方 217 项测试在 Node 22.22.2 上实测全通过，`.nvmrc` 仍按对方
  锁定 24.19.0 供 CI 使用。

## D-006 Oracle 与 ArtFi 的关系：两个独立仓库，边界为只读验证 SDK

| 项目 | 内容 |
| --- | --- |
| 裁决 | **ArtFi 是文保链上登记产品在公链交易的 agent**；Oracle 与 ArtFi 是 GitHub 上两个独立仓库，按两个子项目推进 |
| 仓库 | `GiraffeTechnology/Oracle`（本仓库，L2 验证层）、`GiraffeTechnology/ArtFi`（公链交易 agent） |
| 日期 | 2026-09-01 |
| 取代 | 本条不取代 D-004 中的 ArtFi 条目，但收窄其范围，见下 |

**Oracle 不向任何公链发送交易。** 上链由 ArtFi 承担。这与 PRD §5 的层次划分一致：
L2 只做查询、核验、签名证明、状态同步、撤销和审计。本仓库 `src/` 中不存在、也不应出现
交易广播、签名发送或链上写入路径。

**边界形态：不存在「Oracle → ArtFi 对接代码」。** 依 ORACLE-010，Oracle 对下游只提供
**只读验证库**（`src/sdk/verifier.js`）与证明格式。ArtFi 与任何其他消费方一样，通过验证
证明来消费 Oracle 的事实，Oracle 侧不为任何特定消费方编写专用接口。因此 PRD §0.1
「阻塞任何与 ArtFi 的接口对接」在本架构下的实际约束面很小 —— 没有专用对接面可以被阻塞。

**两个独立仓库结构性地满足了 PRD §0.1 的一部分要求**：「不引用、不依赖、不复用 ArtFi 的
合约、数据库、Token 语义或验证数据集」中，合约、数据库与代码复用由仓库边界保证，并由
`scripts/check-decision-consistency.mjs` 机械校验（`src/` 中出现 ArtFi 耦合即构建失败）。

**产品语义已裁决，跨仓实现仍待核验**：Oracle 只机械记录以下外部消费边界，不为 ArtFi 增加
运行时代码、链写、签名、广播、撮合、定价或托管能力：

| 层次 | ArtFi 的行为 | 与本 PRD 的关系 |
| --- | --- | --- |
| a | 当前交付：非托管交易 Agent，仅由用户钱包或 Safe owners 签署 | 允许；ArtFi 不持有/托管私钥、不代签 |
| b | 代用户签署、持有或托管密钥 | **禁止** |
| c | Exchange：撮合、定价、结算 | 后续迭代；`NOT_IMPLEMENTED`、`NOT_AUTHORIZED` |

Charity 是当前 Market Agent 的交付子流程，必须遵守同一非托管、仅用户钱包/Safe owners 签署
和状态一致性边界；它既不是 ArtFi 整体交付目标，也不得扩张为 Exchange。ArtFi 消费/索引层
可实时只读公开市场的 NFT 挂牌、成交状态与交易历史，但这些观察不是 Oracle 权威状态，必须带
source/provider 并与 Oracle evidence 分层。`config/external-consumer-state-contract.v1.json` 只记录
合同与 `NOT_VERIFIED_EXTERNAL` 跨仓状态，不声称 ArtFi 仓库已经实现或验证这些边界。

## D-007 ERC 提案的权威位置与引用规则

| 项目 | 内容 |
| --- | --- |
| 裁决 | **ERC 提案的权威位置是 PR #13 的分支 `claude/erc-standard-feasibility-audit-90ypms`，不在本仓库主干**；该 PR **会持续更新** |
| 现行提案 | _Asynchronous Register Projection for NFTs_（`erc/ERCS/erc-xxxx.md`） |
| 日期 | 2026-09-02 |

**取代关系**：PR #3 于 2026-09-02T00:04:00Z 关闭未合并，PR #13 于 24 秒后创建，指向同一分支
同一 head，仅刷新了说明。`docs/erc/` 归档的旧提案 _Versioned RWA Certificate Settlement_
**不再是规范源**，仅作历史记录保留。

**PR #13 不得合并进 `main`。** 其目的地是 `ethereum/ERCs`；合并会把一份草案标准及其内部
审查记录带进 Oracle 的产品历史，并破坏该分支存在的意义——一份不会漂移的副本。

**引用规则**：PR #13 持续更新，因此本仓库任何引用 ERC 内容的文档或脚本
**必须标注所依据的 commit**。未标注 commit 的引用视为失效，不得作为实现依据。
当前已知状态锚定在 `386d6d4`。

**已知实质分歧（待产品裁决，工程侧不得自行选边）**：现行提案在 Motivation 中明确反对冻结
模型，主张 token 在登记在途期间继续交易（`ownerOf` 为可交易头寸，投影为已确认记录）；
而 PRD v0.3 前提 P7、§6 第 293 行、§7 第 427 行均要求冻结，`settlement-coordinator.js`
与 `consumer-state-machine.js` 亦按冻结实现。旧提案用的是冻结模型，故本次重写是主动翻转
立场。在裁决作出前：不得因 ERC 而改 Oracle 的冻结逻辑，也不得因 PRD 而改 PR #13。

## D-003 冲突裁决规则

出现冲突时，按以下顺序取用：

1. 最新的明确要求（并追加为本文件的新条目）；
2. 本文件既有裁决；
3. 权威 PRD 与验收标准；
4. 其他文档。

## D-004 本次裁决未解决的事项

以下事项不属于文档冲突，无法由裁决规则关闭，须另行处理：

| 事项 | 性质 | 出处 |
| --- | --- | --- |
| ArtFi 跨仓实现及证据 | 外部工程与验收；产品语义由 D-006 固定 | PRD §0.1、D-006 |
| 范围与排期契约签署 | 商务 | PRD §0.2 |
| PREMISE-P1~P8 前提取证 | 取证工作 | PRD §1、验收 §4.4 |
| 主网/真实资产/真实资金的法务 go/no-go | 法律门禁，状态 `PENDING-GATE` | 验收 §2.1 |
| 两条分支的合并 | 工程工作 | `GAP_AUDIT_ZH.md` §6 A 类 |
