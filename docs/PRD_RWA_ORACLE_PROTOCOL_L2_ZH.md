# Giraffe RWA Oracle（L2）产品需求文档

## 0. 文档控制

| 项目 | 内容 |
| --- | --- |
| 文档名称 | Giraffe RWA Oracle（L2）PRD |
| 文档版本 | v0.3 |
| 日期 | 2026-08-24 |
| 状态 | Oracle-only 范围确认稿；用于产品、架构、法律和开发验收对照 |
| 产品主体 | Giraffe ArtFi Corp. |
| 产品定位 | RWA 登记、来源、证书、仓储及交割状态的验证与证明基础设施 |
| 不包含 | NFT 金融化、份额化、贷款、质押、收益产品、做市、定价、撮合及金融结算；<br>以及一切**主体合规**职能：KYC/AML/制裁筛查、司法辖区资格判定、牌照适格性、投资者适当性 |
| 配套文档 | `ACCEPTANCE_RWA_ORACLE_ZH.md`（验收标准）、`STATUS.md`（证据快照） |
| 上一版本 | v0.2；本版修复需求 ID 断裂、前提取证缺失、金融隔离条款归属错误，并移除误写入协议的主体合规职能 |

本文只定义 Giraffe 在 RWA 四层架构中的验证层（L2 Oracle）。链下资产登记、文物艺术品
经营、仓储和证书签发属于资产层（L1）；Token 标准、NFT 状态机和 ERC 提案属于独立协议
项目（L3）；贷款、质押、结构化产品等属于第三方应用层（L4）。

L3 ERC 提案及其参考合约已经移交独立任务"ERC"。本仓库可以定义下游协议必须验证的事实、
证明格式和消费接口，但不得在本项目中自定 ERC 编号、提交 ERC 提案或把某个 NFT 合约实现
列为 Oracle 完成条件。

本文中的合规描述是产品约束和上线门禁，不构成监管机关批准声明。任何主网、真实资产、
真实资金或公开生产启用仍须通过独立书面 go/no-go。该门禁针对跨境文物、真实资金和实物
提货权，属于法务放行条件，不得因技术测试通过而省略，也不得与工程排期门禁混淆。

### 0.1 与 ArtCCH:ArtFi 的关系（必须先行裁决）

本产品与 ArtFi 商业化项目在 Token 语义上**结构性互斥**，三处冲突已记录：

| 冲突点 | 本文档 | ArtFi 现有产品 |
| --- | --- | --- |
| 份额化 | CONSUMER-001 一物一证一 NFT，禁止份额化 | 核心产品即 ERC-721 → Vault → ERC-20 份额 |
| 撮合 | CONSUMER-008 不建订单簿、不撮合、不做对手方 | 报价模块 M2 含订单簿与撮合引擎 |
| 慈善版 | 本产品与"一件作品发行 100 枚 NFT"结构完全独立、不得混用 | 慈善版 37×100 = 3,700 枚为其验证数据集 |

在下述裁决作出前，本 PRD 按**独立产品线**假设推进，不引用、不依赖、不复用 ArtFi 的合约、
数据库、Token 语义或验证数据集：

- **裁决 A：独立产品线**——单独报价、单独仓库、单独排期，与 ArtFi 合同解耦。本文档无需修改。
- **裁决 B：作为 ArtFi 底层**——ArtFi 须放弃份额化改为 1:1 数字权证，M1/M2/M3/M4 全部重写，
  原报价范围作废重谈。本文档 §0.1 冲突表须转为 ArtFi 侧的范围变更单。

裁决未作出不阻塞 Stage A/B，但阻塞任何与 ArtFi 的接口对接。

### 0.2 范围与排期契约（待签署）

本 PRD 目前**没有对应的报价、人天预算和里程碑日期**。ArtFi 的 450 人天 / USD 155,000 六个
模块不覆盖本项目任何工作。生产候选（Stage F）之前必须补齐：

| 待补项 | 责任人 | 需要时点 |
| --- | --- | --- |
| 分模块人天与报价 | 商务 | Stage A 退出前 |
| 里程碑日历（含 T+3 工作日历口径） | PM | Stage A 退出前 |
| 第三方审计预算（法律、隐私、安全、合约） | 商务 | Stage E 退出前 |
| 技术栈决策：本仓库 Node/TypeScript 与 ArtFi 的 Go 后端并行的运维成本 | 架构 | Stage B 退出前 |

## 1. 项目前提

以下事实由业务方确认并作为设计前提。**每条必须留存书面依据、取证日期与复核周期**；前提
失效或无法取证即触发范围复审，不得作为"已确认"继续沿用。

| # | 前提 | 依据文件 | 取证日期 | 复核周期 | 责任人 |
| --- | --- | --- | --- | --- | --- |
| P1 | 中国境内文物艺术品在"中国文保链"登记，登记内容包括标的物详情和所有者信息 | 待补 | 待补 | 年度 | 法务 |
| P2 | 中国文保链由国家版权局与国家文物局监管，证据与司法链衔接，并获互联网法院认可 | 待补 | 待补 | 年度 | 法务 |
| P3 | 中国文保链运营方为中创文贸（北京）文物艺术品有限公司 | 待补 | 待补 | 年度 | 法务 |
| P4 | 中创文贸由中国文物交流中心 100% 全资所有，具备文物艺术品交易、仓储及经批准的进出口资格，并可指导仓库监管 | 待补 | 待补 | 年度 | 法务 |
| P5 | 实物仓单记录文保链登记事实、唯一登记引用及对应哈希值 | 待补 | 待补 | 半年 | 产品 |
| P6 | 每个本产品 NFT 只对应一件唯一实物及一项完整、排他、可执行的提货权；不拆分、不共享 | 待补 | 待补 | 半年 | 产品 |
| P7 | 境外交易在 T+0 形成交易快照和冻结状态，最迟 T+3 完成文保链所有者变更、旧证书注销、新证书签发及 NFT 新证书哈希更新；完成后 NFT 才恢复可交易状态 | 待补 | 待补 | 半年 | 产品 |
| P8 | Giraffe 不提供 NFT 金融化服务；第三方链上金融机构可独立使用 NFT 开展其获准业务，Giraffe 只提供资产事实查询和验证接口技术支持 | 待补 | 待补 | 年度 | 法务 |

P1–P4 是整个产品的监管地基。任一条无法取证，Stage F 必须阻断。

## 2. 产品目标

### 2.1 核心目标

1. 将中创文贸、文保链、仓库及证书提供的权威链下事实转换为可验证、可撤销、有时效的链上证明。
2. 为"一物、一证、一 Token"的下游协议提供可独立验证的事实证明，不负责发行或转移 Token。
3. 保证资产、仓单、权威登记和证书版本之间可追溯，并能发现冲突或多个有效权利主张。
4. 建立 T+0 成交锁定、T+3 登记及证书重签的确定性状态机。
5. 向第三方应用提供事实查询和技术集成能力，同时严格隔离任何金融产品、金融决策和金融执行。

### 2.2 成功标准

- 任意有效 NFT 均可反查唯一资产、当前有效证书、仓单哈希、文保链登记引用和交割状态。
- 任意资产出现多个当前证书、仓单或权利主张时，Oracle 必须返回冲突并停止签发有效证明。
- T+0 后至登记完成前，Oracle 必须持续返回 `TRANSFER_PENDING` 或更严格状态。
- 登记完成后，Oracle 必须签发包含新证书哈希、递增版本和前序证书哈希的证明。
- 所有预言机输出均可验证来源、签名、时间、有效期和撤销状态。
- Giraffe 不产生价格、抵押率、收益、信用或投资适当性结论。

## 3. 四层架构与产品边界

| 层级 | 责任主体 | 本产品责任 |
| --- | --- | --- |
| L1 资产层 | 中创文贸、文保链、受监管仓库、证书签发方 | 外部权威基础；Giraffe 不替代其鉴定、登记、保管或审批 |
| L2 验证层 | Giraffe RWA Oracle | 本 PRD 唯一实现范围：查询、核验、签名证明、状态同步、撤销和审计 |
| L3 协议层 | 独立 ERC/协议项目 | 本 PRD 仅定义消费 Oracle 证明的兼容边界，不实现 NFT 或负责 ERC 提交 |
| L4 应用层 | 外部市场、钱包、持牌链上金融机构等 | 第三方独立责任；不属于 Giraffe 的金融或交易业务 |

### 3.1 Giraffe 的准确角色

Giraffe 是：

- RWA 资产事实与来源预言机；
- 权属及仓储状态查询服务；
- T+0/T+3 状态协调和事实证明服务；
- 第三方验证 API、SDK 和集成技术支持提供商。

Giraffe 不是：

- 文物鉴定或估值机构；
- 中国境内文物交易、仓储或进出口主体；
- 证券发行人、经纪商、交易所、做市商或清算机构；
- 贷款人、质押平台、基金、SPV、收益产品或衍生品提供商；
- 第三方金融机构的代理人、承销人、风控人或抵押物处置人；
- KYC/AML/制裁筛查服务商、合规审查机构或司法辖区资格认定方。

### 3.3 主体合规边界（v0.3 新增）

Oracle 只转述权威来源关于**资产**的事实，不生产、不转述、不裁决关于**人或机构**的合规结论。

| | 属于本协议 | 不属于本协议 |
| --- | --- | --- |
| 对象 | 资产、仓单、证书、登记、实物状态 | 自然人、机构、钱包持有人的合规身份 |
| 示例（在范围） | 登记是否存在、证书哈希与版本、仓单哈希、权利负担、司法冻结、`transferEligibility` | — |
| 示例（不在范围） | — | KYC 结果、AML 风险评级、制裁名单命中、司法辖区资格、牌照适格性、投资者适当性 |
| 责任方 | Giraffe Oracle | 各机构自行解决 |

`transferEligibility` 仅表示**权威来源声明的资产侧可转让性**（登记、仓储、权利负担、司法
冻结），不包含任何交易对手方的合规状态。任何机构不得以 Oracle 返回 `VALID` 为由主张其自身
的 KYC、AML、制裁或适当性义务已被满足。

司法冻结属于权威来源关于资产的事实，在范围内；对被冻结主体的合规评价不在范围内。

### 3.2 需求 ID 体系

| 前缀 | 含义 | 实现方 | 验收方式 |
| --- | --- | --- | --- |
| `ORACLE-*` | L2 验证层需求 | **本项目** | 本项目自动化测试与运行证据 |
| `CONSUMER-*` | 下游协议消费约束 | 独立协议项目（L3） | 本项目以合成消费者验证约束可被强制 |
| `NFR-*` | 非功能需求 | 本项目 | 压测、演练、审计记录 |

`CONSUMER-*` 不是本项目的交付物。本项目的义务是：**证明这些约束在 Oracle 侧可被强制**，
即无效、冲突、过期、撤销、乱序或重放的输入不可能通过验证。下游是否正确实现由 L3 项目验收。

## 4. 角色与权限

| 角色 | 权限 | 禁止事项 |
| --- | --- | --- |
| 中创文贸登记方 | 确认登记事实、所有者变更、证书签发/注销和文保链引用 | 不得通过 Giraffe 接口绕过自身审核流程 |
| 仓储方 | 确认实物、仓单、冻结、解冻、提货和权利负担状态 | 不得为同一实物签发多个同时有效的提货凭证 |
| Giraffe Oracle | 验证权威输入，签发有时效证明，发布状态和撤销事件 | 不得自行认定所有权、估值或金融适用性 |
| 下游协议实现方 | 独立消费 Oracle 证明并执行 Token 生命周期 | 不属于本 Oracle 项目的实现或 ERC 提交范围 |
| 卖方 | 发起挂牌/转让并接受 T+0 冻结 | 冻结后不得提货、质押或重复出售 |
| 买方 | 付款托管并在 T+3 后取得有效 NFT | `TRANSFER_PENDING` 时不得转售或提货 |
| 第三方金融机构 | 查询资产事实证明并独立决定是否开展其业务 | 不得把查询结果表述为 Giraffe 的金融批准、合规放行或担保 |
| 获准第三方（托管/支付/合规服务商） | 独立完成资金托管、支付与主体合规核验 | 其核验结果不进入 Oracle 证明，也不构成协议门禁 |
| 系统审计员 | 读取不可变审计记录和证明链 | 不得修改业务状态或查看无权限个人信息 |

生产权限必须采用职责分离。中创文贸登记确认与 Giraffe 交割执行不得由同一单一密钥控制。

## 5. 核心对象模型

### 5.1 AssetRecord

```text
assetId
wenbaoRegistryRef
assetFingerprintHash
classificationCode
transferEligibility
warehouseId
warehouseReceiptHash
currentCertificateHash
currentCertificateVersion
currentOwnerCommitment
encumbranceStatus
oracleStatus
updatedAt
```

### 5.2 CertificateRecord

```text
assetId
tokenId
certificateVersion
certificateHash
previousCertificateHash
wenbaoChangeRef
warehouseReceiptHash
effectiveAt
supersededAt
status
```

证书历史必须追加，不得覆盖或删除。公开链只保存不可逆哈希、版本和非敏感引用，不保存姓名、
证件号、住址、完整仓单、完整证书或其他个人信息。

### 5.3 OracleAttestation

```text
attestationId
schemaVersion
assetId
tokenId
factType
factValue
sourceAuthority
sourceRecordHash
observedAt
validFrom
expiresAt
nonce
revocationRef
signerSetId
signature
```

每份证明必须绑定请求目的、链、合约和 Token ID，防止跨链、跨资产和跨用途重放。

### 5.4 SettlementRecord

```text
settlementId
assetId
tokenId
sellerWallet
buyerWallet
t0SnapshotHash
externalExecutionRef
oldCertificateHash
newCertificateHash
wenbaoChangeRef
status
startedAt
deadlineAt
finalizedAt
failureReasonHash
```

## 6. L2 验证层需求（本项目实现范围）

### ORACLE-001 权威数据源注册

系统必须使用批准的数据源注册表，至少标识中创文贸、文保链和仓储方。调用方不得在请求中传入
任意 URL、RPC、数据库地址或替代数据源。未知来源默认拒绝。

### ORACLE-002 事实查询

系统必须提供以下事实查询：

- 资产登记是否存在；
- NFT 与实物是否保持 1:1；
- 当前证书哈希及版本；
- 仓单哈希及仓储状态；
- 当前所有者承诺值与钱包绑定状态；
- 是否处于冻结、查封、质押、提货或交割中；
- 是否允许转让；
- T+0 快照和 T+3 交割是否完成；
- 证明是否过期、撤销或需要人工复核。

查询结果只允许使用：

```text
VALID
INVALID
TRANSFER_PENDING
FROZEN
REVOKED
EXPIRED
REVIEW_REQUIRED
NOT_VERIFIED
```

### ORACLE-003 签名证明

每次证明必须包含版本化 schema、来源哈希、观察时间、有效期、nonce、签名集合和撤销引用。
证明过期、签名不足、来源不一致或依赖项不可用时必须 fail closed。

### ORACLE-004 撤销与紧急冻结

当文保链登记被撤回、证书失效、仓储异常、司法冻结或来源争议出现时，系统必须：

1. 撤销未过期证明；
2. 将协议状态变为 `FROZEN` 或 `REVIEW_REQUIRED`；
3. 阻止 NFT 转让和提货；
4. 保留原因哈希、操作者、时间和证据引用；
5. 向订阅方发布幂等事件。

### ORACLE-005 主体合规结论隔离

> v0.2 允许 Oracle 返回 KYC、AML、制裁及司法辖区资格的状态证明。该条把机构自身的经营合规
> 职能写进了协议，与 §3.1、§3.3 冲突，v0.3 反转为禁止项。

系统不得生成、存储、转述或返回任何关于自然人或机构的合规结论，包括但不限于：

- KYC 核验结果或核验等级；
- AML 风险评级、可疑交易判断；
- 制裁名单命中与否；
- 司法辖区资格、投资者适当性、专业投资者认定；
- 牌照适格性或经营资质评价。

主体合规由各机构依其自身监管义务独立解决。协议不提供、不代理、不缓存该类结论，
也不因其缺失而阻断资产事实查询。

`currentOwnerCommitment` 与钱包绑定状态是权威来源签发的**资产权属事实**，不是主体合规
结论，在范围内。

### ORACLE-006 禁止金融输出

系统不得生成或返回：

- 估值、市场价格或价格预测；
- 抵押率、清算价或信用评分；
- 利率、收益率或流动性曲线；
- 投资建议或金融产品合规批准；
- "适合投资""保证可变现"或等价结论。

### ORACLE-007 隐私与数据最小化

- 公开链只保存哈希、版本、状态和非敏感引用。
- 所有者姓名、证件、地址、仓储细节和完整证书仅保存在获准系统。
- 钱包地址与实名身份的映射不得公开。
- 跨境数据只传输完成交易和验证所必需的最少字段。
- 查询机构按用途授权，记录访问者、目的、字段、时间和结果。
- 面向第三方的查询不得泄露个人身份材料、密钥、内部服务器信息或未公开证书原文。

### ORACLE-008 审计与可追溯

- 所有状态转换、证明签发、撤销、证书升级和管理员操作必须留存不可变审计记录。
- T+0 至 T+3 全过程及证书历史必须可重放审计。
- 时间统一保存 UTC，按用户界面时区展示；T+3 的工作日历和截止规则必须版本化。

### ORACLE-009 金融隔离（Giraffe 自身义务）

> 本条在 v0.2 中被错误归入下游约束（原 PROTOCOL-009）。它约束的是 Giraffe 自己的行为，
> 属于本项目实现与验收范围，故归位至 §6。

第三方链上金融机构可独立对 NFT 进行其获准的操作。Giraffe 仅提供查询、证明、SDK、文档和
接口故障排查。Giraffe 不得：

- 设计、部署或共同运营第三方金融产品合约；
- 代用户提交、签署或托管金融交易；
- 撮合融资、参与授信、估值、清算、强平或抵押物处置；
- 接收本金、利息、收益或清算款；
- 按融资额、收益或金融成交额收取报酬；
- 将技术验证结果表述为金融产品批准、担保或投资建议。

可收费项目限于固定订阅、查询、证明签发和通用接口技术支持，不与金融交易结果挂钩。

### ORACLE-010 消费适配器与 SDK

Oracle 可以提供只读验证库或链上消费适配器，但不得因此承担 NFT 发行、交易、托管或 ERC
标准所有权。适配器的验收范围仅限：证明是否被正确验证、过期或撤销证明是否被拒绝、
资产/链/合约/Token/用途绑定是否防止重放、消费失败是否 fail closed。

## 7. 下游协议消费约束（非本项目实现范围）

本节不定义 ERC，也不要求本项目部署 NFT 合约。它规定任何声称兼容 Giraffe Oracle 的下游
协议在消费证明时必须遵守的安全语义。规范性 ERC 接口、编号、参考合约和社区提交流程由独立
任务"ERC"维护。

本项目对本节的义务见 §3.2：以合成消费者证明这些约束在 Oracle 侧可被强制。

### CONSUMER-001 一物一证一 NFT

- 每个 `assetId` 最多对应一个有效 Token ID；
- 每个 Token ID 只对应一个 `assetId`；
- 不允许份额化、批量同权发行或同一提货权的多 Token 映射；
- 重复资产指纹、重复当前证书或重复仓单必须拒绝发行；
- NFT 不得附带分红、利息、收益分配、回购或价格支持权利。

### CONSUMER-002 初始发行

初始发行前必须取得有效 Oracle 证明，至少确认：

- 资产已在文保链登记；
- 中创文贸确认登记及允许进入本协议；
- 仓单有效且哈希一致；
- 当前证书有效；
- 无阻止发行的权利负担；
- 接收钱包与合法持有人绑定；
- 资产未被其他有效 Token 占用。

### CONSUMER-003 生命周期

允许状态为：

```text
DRAFT
VERIFIED
ACTIVE
TRANSFER_PENDING
SETTLED
FROZEN
REVIEW_REQUIRED
REVOKED
REDEEMED
```

主要状态机：

```text
VERIFIED -> ACTIVE(v1)
ACTIVE(vN) -> TRANSFER_PENDING
TRANSFER_PENDING -> SETTLED
SETTLED -> ACTIVE(vN+1)
TRANSFER_PENDING -> ACTIVE(vN)       # 失败回滚
任意可用状态 -> FROZEN/REVIEW_REQUIRED
ACTIVE -> REDEEMED                  # 完成提货后终止流通
```

不存在有效证明的状态转换必须回滚。

### CONSUMER-004 T+0 快照与冻结

外部市场报告成交匹配后，系统必须在 T+0：

1. 生成包含资产、Token、买卖钱包、外部执行引用、旧证书、仓单和时间的快照哈希；
2. 将 NFT 置于协议托管或不可转让状态；
3. 将原证书和实物置于 `TRANSFER_PENDING`；
4. 阻止转让、提货、质押及重复挂牌；
5. 创建最迟 T+3 到期的所有者变更任务；
6. 对重复事件保持幂等，不得重复冻结或重复创建任务。

资金托管、支付和市场撮合必须由获准第三方完成，不得进入 Giraffe 账户或密钥控制范围。

### CONSUMER-005 T+3 交割

只有在取得以下全部证据后才能完成交割：

- 文保链所有者变更完成；
- 中创文贸签发新证书并注销旧证书；
- 仓储方确认新提货权人；
- 新证书、仓单和 T+0 快照哈希一致；
- Oracle 证明有效且未撤销；
- 新持有人钱包绑定有效。

成功后系统必须：

1. 保持原 Token ID 不变；
2. 将 `currentCertificateHash` 更新为新证书哈希；
3. `certificateVersion` 加一；
4. 保存 `previousCertificateHash` 和完整追加式历史；
5. 释放 NFT 给新持有人；
6. 状态更新为 `ACTIVE`；
7. 发布 `CertificateSuperseded` 与 `SettlementFinalized` 事件；
8. 恢复再次交易能力。

### CONSUMER-006 T+3 失败与超时

任一必需确认失败、冲突或超时，系统必须：

- 不写入新证书哈希；
- 不把买方显示为已完成提货权持有人；
- 通知第三方托管系统执行退款流程；
- 将 NFT 恢复给原持有人或保持冻结等待争议处理；
- 解除或维持实物冻结须以中创文贸/仓储方证明为准；
- 保存 `SettlementCancelled` 或 `SettlementDisputed` 审计事件。

### CONSUMER-007 提货与终止

提货只能由当前 `ACTIVE` 持有人发起。仓储方完成交付并由文保链确认后，NFT 必须进入
`REDEEMED`，不得继续作为有效提货权交易。是否销毁 Token 或保留为不可转让历史凭证由
发布策略决定，但不能再次恢复为有效提货权。

### CONSUMER-008 外部交易兼容

协议可以兼容获准的外部市场，但 Giraffe 不建立订单簿、不匿名撮合、不成为交易对手方，
也不控制市场资金。外部市场事件只能触发待验证的 T+0 意图，不能绕过 Oracle 和证书更新门禁。

### CONSUMER-009 证明消费失败关闭

下游消费者必须确定性拒绝无效、过期、撤销、乱序或重放的证明，并在依赖不可用时 fail closed，
不得以缓存证明、默认值或乐观假设继续执行状态转换。

## 8. Oracle 链上消费适配器

以下接口是现有产品讨论形成的非规范性兼容示例，不是 ERC 草案，也不是 Oracle 生产部署的
强制 ABI。下游合约实现可以不同，验收口径见 ORACLE-010。

```solidity
function assetOf(uint256 tokenId) external view returns (bytes32 assetId);
function currentCertificateHash(uint256 tokenId) external view returns (bytes32);
function certificateVersion(uint256 tokenId) external view returns (uint64);
function transferStatus(uint256 tokenId) external view returns (uint8);
function beginSettlement(
    uint256 tokenId,
    bytes32 settlementId,
    bytes32 snapshotHash,
    address expectedBuyer,
    uint64 deadline
) external;
function finalizeSettlement(
    uint256 tokenId,
    bytes32 settlementId,
    bytes32 newCertificateHash,
    bytes32 wenbaoChangeRef,
    bytes calldata oracleAttestation
) external;
function cancelSettlement(
    uint256 tokenId,
    bytes32 settlementId,
    bytes32 reasonHash
) external;
function freeze(uint256 tokenId, bytes32 reasonHash) external;
function markRedeemed(uint256 tokenId, bytes32 redemptionEvidenceHash) external;
```

最低事件：

```solidity
event SettlementStarted(...);
event CertificateSuperseded(...);
event SettlementFinalized(...);
event SettlementCancelled(...);
event AssetFrozen(...);
event AttestationRevoked(...);
event AssetRedeemed(...);
```

## 9. API 最低接口

```text
GET  /healthz
GET  /readyz
GET  /v1/oracle/statuses
GET  /v1/rwa/assets/{assetId}
GET  /v1/rwa/tokens/{chainId}/{contract}/{tokenId}
GET  /v1/rwa/tokens/{chainId}/{contract}/{tokenId}/certificate-history
GET  /v1/rwa/tokens/{chainId}/{contract}/{tokenId}/transfer-eligibility
GET  /v1/rwa/attestations/{attestationId}
POST /v1/rwa/attestations/verify
POST /v1/rwa/settlements
GET  /v1/rwa/settlements/{settlementId}
POST /v1/rwa/settlements/{settlementId}/finalize
POST /v1/rwa/settlements/{settlementId}/cancel
POST /v1/rwa/revocations
```

所有写接口必须使用强身份认证、RBAC、请求签名、幂等键、重放保护和不可变审计日志。
当前迭代外部写入禁用且不可由本迭代开启；开发服务仅绑定 `localhost`。

接口命名不得出现 `kyc`、`aml`、`sanction`、`suitability`、`accredit` 等主体合规语义；
`transfer-eligibility` 仅返回资产侧可转让性。

## 10. UI 需求

### ORACLE-011 资产详情展示

资产详情必须显示：

- 一物一 NFT 标识；
- 文保链登记状态及非敏感引用；
- 当前证书哈希、版本和更新时间；
- 仓单哈希及仓储状态；
- NFT 状态和是否允许交易/提货；
- T+0 快照时间、T+3 截止时间和当前进度；
- 数据来源、观察时间和证明到期时间；
- 明确声明 Giraffe 不提供金融化服务。

交易期间 UI 必须区分：

- `成交锁定`：T+0 已匹配但尚未交割；
- `登记处理中`：文保链变更和证书重签进行中；
- `交割完成`：T+3 证书哈希更新且 NFT 恢复可交易；
- `交割失败/争议`：不得展示新持有人已取得完整提货权。

查询页不得出现估值、收益、抵押率、金融推荐或"SEC 批准"等误导性文案。

## 11. 安全与非功能要求

### NFR-001 密钥与权限

- Oracle 签名密钥与协议管理员权限分离；生产使用多签或门限签名。
- 管理员不能绕过中创文贸、仓储方和 Oracle 证明直接恢复交易。
- 合约升级、签名人轮换、紧急暂停和恢复均须有 timelock、审计及回滚方案。
- 生产凭证、个人数据、原始单证和签名密钥不得进入本仓库；测试夹具全部为合成数据。

### NFR-002 防重放与顺序保证

- 所有证明绑定 chain ID、合约、Token ID、nonce、有效期和 schema 版本。
- 证书升级必须防重放、防乱序、防重复交割和防旧证明覆盖新版本。

### NFR-003 默认关闭

任一权威数据源不可用、冲突或超时，系统默认冻结或等待复核，不得猜测、不得使用缓存值、
不得回退到乐观默认。

### NFR-004 可用性与恢复

- 查询 API 目标可用性不低于 99.9%。
- 交割写入服务须支持队列恢复和幂等重试。
- 必须提供对账、灾难恢复、密钥轮换、证书冲突和数据源中断演练。

## 12. 公共表述边界

允许的产品表述：

> Giraffe provides RWA provenance, custody and settlement attestations about assets, and a 1:1
> digital title protocol connecting authoritative off-chain cultural-asset records with blockchain
> systems. Giraffe does not provide or participate in NFT financialization.

禁止的表述：

- SEC approved / SEC certified；
- 保证非证券；
- 保证升值、流动性、收益或可变现；
- Giraffe 对实物进行官方鉴定或估值；
- Giraffe 为第三方金融产品提供批准、担保或承销；
- 文保链哈希本身替代中创文贸、仓库或法定审批；
- Giraffe 已对任何自然人或机构完成 KYC、AML、制裁或适当性核验；
- 查询返回 `VALID` 表示交易对手方合规。

1:1 NFT 的非证券设计以实际权利、发行方式、营销材料和交易事实为准。若第三方基于 NFT 创建
贷款、质押、包装、证券化、收益或衍生产品，该产品为第三方独立业务，全部牌照、披露、适当性、
托管、清算、AML 和监管责任由该第三方承担。

## 13. 分阶段交付

阶段退出条件与需求 ID 的完整对应见 `ACCEPTANCE_RWA_ORACLE_ZH.md` §5。

| 阶段 | 内容 | 主要覆盖 |
| --- | --- | --- |
| A 合同与数据契约 | 固化各方角色责任；确认权威字段、签名格式、变更 SLA、T+3 日历、撤销与争议流程；完成数据最小化、保留期和跨境传输评估 | P1–P8 取证、ORACLE-001、ORACLE-007 |
| B L2 Oracle 沙盒 | 来源适配器、证明 schema、签名验证、到期、撤销及查询 API；合成资产与合成身份完成冲突、延迟、离线和重放测试 | ORACLE-001~009、NFR-001~003 |
| C 下游协议兼容性测试 | 合成下游消费者验证证明校验、状态输入、撤销、过期及证书升级事件；SDK、验证库、适配器与 fail-closed 语义测试 | ORACLE-010、CONSUMER-001~009 |
| D 端到端受控演练 | 外部市场事件、Oracle、文保链测试接口、证书重签和恢复交易演练；对账、超时、争议、撤销、冻结、灾难恢复 | 全量 + NFR-004 |
| E 第三方只读集成 | 向获准第三方提供查询 API、SDK 和验证库；验证第三方无法触发 Giraffe 金融交易、绕过门禁或取得主体合规结论 | ORACLE-005、ORACLE-009 |
| F 生产候选 | 法律、隐私、安全、合约及运营独立审计；修复并复测；单独批准主网、真实资产、外部市场及每类司法辖区 | 全量 + §0.2 契约补齐 |

Stage A–E 全部使用合成数据，不接触真实资产、真实资金和真实个人信息。

## 14. 发布阻断项

出现以下任一情形必须阻断生产发布：

- 不能证明一物一证一 NFT；
- 文保链、证书或仓单哈希不一致；
- 中创文贸或仓储方状态不可验证；
- P1–P4 任一监管前提无法取证；
- T+0 后 Oracle 仍签发允许转让、提货或质押的有效证明；
- 权威登记完成前 Oracle 即签发买方已完成交割的证明；
- 旧证书未注销或证书历史被覆盖；
- Oracle 可以自行认定所有权或绕过权威来源；
- API、UI 或合同包含估值、收益、抵押率、投资建议或金融产品批准；
- Oracle 输出、schema、接口命名或合同包含 KYC、AML、制裁、司法辖区资格、适当性或牌照结论；
- Giraffe 接触第三方金融交易签名、资金、授信、清算或按交易结果收费；
- 个人信息、证书原文、仓单原文或身份映射进入公开链；
- 缺少独立法律、安全、隐私或 Oracle 消费适配器审计；
- 缺少主网、真实资产及真实资金的单独书面批准；
- §0.1 与 ArtFi 的裁决未作出而已发生接口对接；
- §0.2 范围与排期契约未签署。

## 15. 监管与规则参考

- SEC Release No. 33-11412 / 34-105020，`Application of the Federal Securities Laws to
  Certain Types of Crypto Assets and Certain Transactions Involving Crypto Assets`。
- SEC 2026 `Statement on Tokenized Securities`。
- 《中华人民共和国民法典》关于动产指示交付、仓单及仓储合同的规定。
- 《中华人民共和国文物保护法》及适用的文物交易、仓储和进出口规则。
- 《人民法院在线诉讼规则》关于区块链电子证据核验的规定。
- 适用的隐私、数据跨境和消费者保护规则（约束 Giraffe 自身的数据处理行为）。

KYC、AML、制裁及投资者适当性规则约束相应机构自身，不构成本协议的实现或验收要求，
仅在此记录以说明其归属。

以上参考不替代逐司法辖区法律意见、监管沟通或真实资产上线批准。以上条款引用须在 Stage A
核验现行有效版本并记录核验日期。
