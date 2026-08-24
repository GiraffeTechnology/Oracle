# Giraffe RWA Oracle（L2–L3 配置与集成）产品需求文档

## 0. 文档控制

| 项目 | 内容 |
| --- | --- |
| 文档名称 | Giraffe RWA Oracle（L2–L3 配置与集成）PRD |
| 文档版本 | v0.4 |
| 日期 | 2026-08-24 |
| 状态 | L2 Oracle 与 L3 协议集成迭代实施稿；用于产品、架构、法律、开发和逐迭代验收 |
| 产品主体 | Giraffe ArtFi Corp. |
| 产品定位 | RWA 登记、来源、证书、仓储及交割状态的验证与证明基础设施 |
| 不包含 | NFT 金融化、份额化、贷款、质押、收益产品、做市、定价、撮合及金融结算 |
| 与现有慈善发行关系 | 完全独立；不得与任何“一件作品发行 100 枚 NFT”的慈善版结构混用 |

本文定义 Giraffe 在 RWA 四层架构中的验证层（L2 Oracle），并交付 L2 调用独立 L3 协议所需的
完整非秘密配置、版本锁、哈希锁、状态映射和失败关闭兼容性门禁。链下资产登记、文物艺术品
经营、仓储和证书签发属于资产层（L1）；Token 标准正文、参考合约和 ERC 提案仍属于独立协议
项目（L3）；贷款、质押、结构化产品等属于第三方应用层（L4）。

L3 ERC 提案及其参考合约已经移交独立任务“ERC”。本仓库必须消费该任务的版本化协议产物，
并配置下游协议必须验证的事实、证明格式、接口 ID、依赖、状态映射和消费门禁；但不得在本项目
中自定 ERC 编号、提交 ERC 提案、静默改写 ABI，或把 NFT 铸造/部署列为 Oracle 完成条件。

本文中的合规描述是产品约束和上线门禁，不构成监管机关批准声明。任何主网、真实资产、
真实资金或公开生产启用仍须通过独立书面 go/no-go。

## 1. 项目前提

本 PRD 以业务方确认的以下事实为既定前提，不在本迭代重复审查：

1. 中国境内文物艺术品在“中国文保链”登记，登记内容包括标的物详情和所有者信息。
2. 中国文保链由国家版权局与国家文物局监管，证据与司法链衔接，并获互联网法院认可。
3. 中国文保链运营方为中创文贸（北京）文物艺术品有限公司。
4. 中创文贸由中国文物交流中心 100% 全资所有，具备文物艺术品交易、仓储以及经批准的
   进出口资格，并可指导仓库监管。
5. 实物仓单记录文保链登记事实、唯一登记引用及对应哈希值。
6. 每个本产品 NFT 只对应一件唯一实物及一项完整、排他、可执行的提货权；不拆分、不共享。
7. 境外交易在 T+0 形成交易快照和冻结状态，最迟 T+3 完成文保链所有者变更、旧证书注销、
   新证书签发及 NFT 新证书哈希更新；完成后 NFT 才恢复可交易状态。
8. Giraffe 不提供 NFT 金融化服务。第三方链上金融机构可以独立使用 NFT 开展其获准的
   业务，Giraffe 只提供合规查询和与验证接口有关的技术支持。

## 2. 产品目标

### 2.1 核心目标

1. 将中创文贸、文保链、仓库及证书提供的权威链下事实转换为可验证、可撤销、有时效的链上证明。
2. 为“一物、一证、一 Token”的下游协议提供可独立验证的事实证明，不负责发行或转移 Token。
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
| L2 验证层 | Giraffe RWA Oracle | 查询、核验、签名证明、状态同步、撤销、审计及完整非秘密生产配置 |
| L3 协议层 | 独立 ERC/协议项目 | ERC 任务维护规范/合约；本项目负责版本锁定、接口配置、状态映射及消费兼容门禁 |
| L4 应用层 | 外部市场、钱包、持牌链上金融机构等 | 第三方独立责任；不属于 Giraffe 的金融或交易业务 |

### 3.1 Giraffe 的准确角色

Giraffe 是：

- RWA 合规与来源预言机；
- 权属及仓储状态查询服务；
- T+0/T+3 状态协调和事实证明服务；
- 第三方验证 API、SDK 和集成技术支持提供商。

Giraffe 不是：

- 文物鉴定或估值机构；
- 中国境内文物交易、仓储或进出口主体；
- 证券发行人、经纪商、交易所、做市商或清算机构；
- 贷款人、质押平台、基金、SPV、收益产品或衍生品提供商；
- 第三方金融机构的代理人、承销人、风控人或抵押物处置人。

## 4. 角色与权限

| 角色 | 权限 | 禁止事项 |
| --- | --- | --- |
| 中创文贸登记方 | 确认登记事实、所有者变更、证书签发/注销和文保链引用 | 不得通过 Giraffe 接口绕过自身审核流程 |
| 仓储方 | 确认实物、仓单、冻结、解冻、提货和权利负担状态 | 不得为同一实物签发多个同时有效的提货凭证 |
| Giraffe Oracle | 验证权威输入，签发有时效证明，发布状态和撤销事件 | 不得自行认定所有权、估值或金融适用性 |
| 下游协议实现方 | 独立消费 Oracle 证明并执行 Token 生命周期 | 不属于本 Oracle 项目的实现或 ERC 提交范围 |
| 卖方 | 发起挂牌/转让并接受 T+0 冻结 | 冻结后不得提货、质押或重复出售 |
| 买方 | 完成资格核验、付款托管并在 T+3 后取得有效 NFT | `TRANSFER_PENDING` 时不得转售或提货 |
| 第三方金融机构 | 查询事实证明并独立决定是否开展获准业务 | 不得把查询结果表述为 Giraffe 的金融批准或担保 |
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

## 6. L2 验证层需求

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

### ORACLE-005 合规查询边界

Oracle 可以返回 KYC、AML、制裁及司法辖区资格的状态证明，但不得公开底层个人信息或替代
相应服务商、金融机构和监管主体作最终决定。

### ORACLE-006 禁止金融输出

系统不得生成或返回：

- 估值、市场价格或价格预测；
- 抵押率、清算价或信用评分；
- 利率、收益率或流动性曲线；
- 投资建议或金融产品合规批准；
- “适合投资”“保证可变现”或等价结论。

## 7. 下游协议消费约束（非本项目实现范围）

本节不定义 ERC，也不要求本项目部署 NFT 合约。它只规定任何声称兼容 Giraffe Oracle 的下游
协议在消费证明时必须遵守的安全语义。规范性 ERC 接口、编号、参考合约和社区提交流程由独立
任务“ERC”维护。

### PROTOCOL-001 一物一证一 NFT

- 每个 `assetId` 最多对应一个有效 Token ID；
- 每个 Token ID 只对应一个 `assetId`；
- 不允许份额化、批量同权发行或同一提货权的多 Token 映射；
- 重复资产指纹、重复当前证书或重复仓单必须拒绝发行；
- NFT 不得附带分红、利息、收益分配、回购或价格支持权利。

### PROTOCOL-002 初始发行

初始发行前必须取得有效 Oracle 证明，至少确认：

- 资产已在文保链登记；
- 中创文贸确认登记及允许进入本协议；
- 仓单有效且哈希一致；
- 当前证书有效；
- 无阻止发行的权利负担；
- 接收钱包与合法持有人绑定；
- 资产未被其他有效 Token 占用。

### PROTOCOL-003 生命周期

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

### PROTOCOL-004 T+0 快照与冻结

外部市场报告成交匹配后，系统必须在 T+0：

1. 生成包含资产、Token、买卖钱包、外部执行引用、旧证书、仓单和时间的快照哈希；
2. 将 NFT 置于协议托管或不可转让状态；
3. 将原证书和实物置于 `TRANSFER_PENDING`；
4. 阻止转让、提货、质押及重复挂牌；
5. 创建最迟 T+3 到期的所有者变更任务；
6. 对重复事件保持幂等，不得重复冻结或重复创建任务。

资金托管、支付和市场撮合必须由获准第三方完成，不得进入 Giraffe 账户或密钥控制范围。

### PROTOCOL-005 T+3 交割

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

### PROTOCOL-006 T+3 失败与超时

任一必需确认失败、冲突或超时，系统必须：

- 不写入新证书哈希；
- 不把买方显示为已完成提货权持有人；
- 通知第三方托管系统执行退款流程；
- 将 NFT 恢复给原持有人或保持冻结等待争议处理；
- 解除或维持实物冻结须以中创文贸/仓储方证明为准；
- 保存 `SettlementCancelled` 或 `SettlementDisputed` 审计事件。

### PROTOCOL-007 提货与终止

提货只能由当前 `ACTIVE` 持有人发起。仓储方完成交付并由文保链确认后，NFT 必须进入
`REDEEMED`，不得继续作为有效提货权交易。是否销毁 Token 或保留为不可转让历史凭证由
发布策略决定，但不能再次恢复为有效提货权。

### PROTOCOL-008 外部交易兼容

协议可以兼容获准的外部市场，但 Giraffe 不建立订单簿、不匿名撮合、不成为交易对手方，
也不控制市场资金。外部市场事件只能触发待验证的 T+0 意图，不能绕过 Oracle 和证书更新门禁。

### PROTOCOL-009 第三方金融操作隔离

第三方链上金融机构可独立对 NFT 进行其获准的操作。Giraffe 仅提供查询、证明、SDK、文档和
接口故障排查。Giraffe 不得：

- 设计、部署或共同运营第三方金融产品合约；
- 代用户提交、签署或托管金融交易；
- 撮合融资、参与授信、估值、清算、强平或抵押物处置；
- 接收本金、利息、收益或清算款；
- 按融资额、收益或金融成交额收取报酬；
- 将技术验证结果表述为金融产品批准、担保或投资建议。

可收费项目限于固定订阅、查询、证明签发和通用接口技术支持，不与金融交易结果挂钩。

## 8. Oracle 链上消费适配器

Oracle 可以提供只读验证库或链上消费适配器，但不得因此承担 NFT 发行、交易、托管或 ERC
标准所有权。以下接口是现有产品讨论形成的非规范性兼容示例，不是 ERC 草案，也不是 Oracle
生产部署的强制 ABI：

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

下游合约实现可以不同。Oracle 的验收只检查：证明是否被正确验证、过期或撤销证明是否被拒绝、
资产/链/合约/Token/用途绑定是否防止重放，以及消费失败是否关闭。

## 9. API 最低接口

```text
GET  /v1/rwa/assets/{assetId}
GET  /v1/rwa/tokens/{chainId}/{contract}/{tokenId}
GET  /v1/rwa/tokens/{chainId}/{contract}/{tokenId}/certificate-history
GET  /v1/rwa/tokens/{chainId}/{contract}/{tokenId}/eligibility
GET  /v1/rwa/attestations/{attestationId}
POST /v1/rwa/attestations/verify
POST /v1/rwa/settlements
GET  /v1/rwa/settlements/{settlementId}
POST /v1/rwa/settlements/{settlementId}/finalize
POST /v1/rwa/settlements/{settlementId}/cancel
POST /v1/rwa/revocations
```

所有写接口必须使用强身份认证、RBAC、请求签名、幂等键、重放保护和不可变审计日志。
面向第三方的查询不得泄露个人身份材料、密钥、内部服务器信息或未公开证书原文。

## 10. UI 需求

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

查询页不得出现估值、收益、抵押率、金融推荐或“SEC 批准”等误导性文案。

## 11. 安全、隐私与非功能要求

### 11.1 安全

- Oracle 签名密钥与协议管理员权限分离；生产使用多签或门限签名。
- 所有证明绑定 chain ID、合约、Token ID、nonce、有效期和 schema 版本。
- 证书升级必须防重放、防乱序、防重复交割和防旧证明覆盖新版本。
- 任一权威数据源不可用、冲突或超时，系统默认冻结或等待复核，不得猜测。
- 管理员不能绕过中创文贸、仓储方和 Oracle 证明直接恢复交易。
- 合约升级、签名人轮换、紧急暂停和恢复均须有 timelock、审计及回滚方案。

### 11.2 隐私

- 公开链只保存哈希、版本、状态和非敏感引用。
- 所有者姓名、证件、地址、仓储细节和完整证书仅保存在获准系统。
- 钱包地址与实名身份的映射不得公开。
- 跨境数据只传输完成交易和验证所必需的最少字段。
- 查询机构按用途授权，记录访问者、目的、字段、时间和结果。

### 11.3 可用性与审计

- 查询 API 目标可用性不低于 99.9%；交割写入服务须支持队列恢复和幂等重试。
- 所有状态转换、证明签发、撤销、证书升级和管理员操作必须留存不可变审计记录。
- 时间统一保存 UTC，并按用户界面时区展示；T+3 的工作日历和截止规则必须版本化。
- 必须提供对账、灾难恢复、密钥轮换、证书冲突和数据源中断演练。

## 12. 合规及公共表述边界

允许的产品表述：

> Giraffe provides RWA compliance, provenance and settlement attestations and a 1:1
> digital title protocol connecting authoritative off-chain cultural-asset records with blockchain
> systems. Giraffe does not provide or participate in NFT financialization.

禁止的表述：

- SEC approved / SEC certified；
- 保证非证券；
- 保证升值、流动性、收益或可变现；
- Giraffe 对实物进行官方鉴定或估值；
- Giraffe 为第三方金融产品提供批准、担保或承销；
- 文保链哈希本身替代中创文贸、仓库或法定审批。

1:1 NFT 的非证券设计以实际权利、发行方式、营销材料和交易事实为准。若第三方基于 NFT 创建
贷款、质押、包装、证券化、收益或衍生产品，该产品为第三方独立业务，全部牌照、披露、适当性、
托管、清算、AML 和监管责任由该第三方承担。

## 13. 分阶段交付

### Stage A：合同与数据契约

- 固化中创文贸、文保链、仓库、Giraffe 和外部市场的角色及责任。
- 确认权威字段、签名格式、变更 SLA、T+3 日历、撤销和争议流程。
- 完成数据最小化、保留期和跨境传输评估。

退出条件：所有来源、权限、状态和失败处理形成版本化契约；未提供真实资产写入。

### Stage B：L2 Oracle 沙盒

- 实现来源适配器、证明 schema、签名验证、到期、撤销及查询 API。
- 使用合成资产和合成身份完成冲突、延迟、离线和重放测试。

退出条件：Oracle 负向测试全部通过；没有价格或金融字段；无法访问真实个人资料。

### Stage C：下游协议兼容性测试

- 使用合成下游消费者验证证明校验、T+0/T+N 状态输入、撤销、过期及证书升级事件。
- 完成 Oracle SDK、验证库、适配器和失败关闭语义测试；不部署正式 NFT，不提交 ERC。

退出条件：同一资产出现冲突时 Oracle 无法签发有效证明；消费者可确定性拒绝无效、过期、撤销、
乱序或重放证明。

### Stage D：端到端受控演练

- 使用获批测试数据完成外部市场事件、Oracle、文保链测试接口、证书重签和恢复交易演练。
- 验证对账、超时、争议、撤销、冻结和灾难恢复。

退出条件：完整证据包可由独立审计员复核；不得使用真实资金或未经批准的真实资产。

### Stage E：第三方只读集成

- 向获准第三方提供查询 API、SDK 和签名证明验证库。
- 验证第三方不能通过接口触发 Giraffe 金融交易或绕过协议门禁。

退出条件：合同和技术测试均确认 Giraffe 只提供事实查询及通用技术支持。

### Stage F：生产候选

- 法律、隐私、安全、智能合约及运营独立审计；修复并复测。
- 单独批准主网、真实资产、外部市场和每类司法辖区。

退出条件：取得书面 go/no-go、发布清单、精确合约、签名人集合、回滚和事件响应证据。

## 14. 验收矩阵

| ID | 验收要求 | 最低自动化证据 |
| --- | --- | --- |
| ORACLE-001 | 仅批准来源 | 未知来源、任意 URL 和替代端点拒绝测试 |
| ORACLE-002 | 状态查询准确 | 每种状态、过期、冲突和来源中断测试 |
| ORACLE-003 | 证明可验证 | 签名、nonce、有效期、schema、跨链重放负向测试 |
| ORACLE-004 | 撤销即时生效 | 撤销后查询和协议转让均失败 |
| ORACLE-006 | 无金融输出 | API/schema/UI 关键词和字段门禁测试 |
| CONSUMER-001 | 一物一证冲突关闭 | 重复资产、仓单和当前证书冲突时证明签发失败 |
| CONSUMER-004 | T+0 待交割证明 | 状态、快照、截止时间和重复事件幂等性测试 |
| CONSUMER-005 | 登记完成证明 | 新证书哈希、版本、历史和权威变更引用精确匹配 |
| CONSUMER-006 | 失败可恢复 | 超时、拒绝、数据冲突、乱序、重放和争议测试 |
| CONSUMER-007 | 提货后终止事实 | `REDEEMED` 状态证明不得被后续旧输入覆盖 |
| ORACLE-009 | 金融隔离 | 无金融写接口、签名、资金或按交易额收费路径 |
| PRIVACY-001 | 公开链无个人信息 | ABI、event、metadata、日志和数据库导出扫描 |
| AUDIT-001 | 全链路可追溯 | T+0 至 T+3 及证书历史可重放审计 |

## 15. 发布阻断项

出现以下任一情形必须阻断生产发布：

- 不能证明一物一证一 NFT；
- 文保链、证书或仓单哈希不一致；
- 中创文贸或仓储方状态不可验证；
- T+0 后 Oracle 仍签发允许转让、提货或质押的有效证明；
- 权威登记完成前 Oracle 即签发买方已完成交割的证明；
- 旧证书未注销或证书历史被覆盖；
- Oracle 可以自行认定所有权或绕过权威来源；
- API、UI 或合同包含估值、收益、抵押率、投资建议或金融产品批准；
- Giraffe 接触第三方金融交易签名、资金、授信、清算或按交易结果收费；
- 个人信息、证书原文、仓单原文或身份映射进入公开链；
- 缺少独立法律、安全、隐私或 Oracle 消费适配器审计；
- 缺少主网、真实资产及真实资金的单独书面批准。

## 16. 监管与规则参考

- SEC Release No. 33-11412 / 34-105020，`Application of the Federal Securities Laws to
  Certain Types of Crypto Assets and Certain Transactions Involving Crypto Assets`。
- SEC 2026 `Statement on Tokenized Securities`。
- 《中华人民共和国民法典》关于动产指示交付、仓单及仓储合同的规定。
- 《中华人民共和国文物保护法》及适用的文物交易、仓储和进出口规则。
- 《人民法院在线诉讼规则》关于区块链电子证据核验的规定。
- 适用的 KYC、AML、制裁、隐私、数据跨境和消费者保护规则。

以上参考不替代逐司法辖区法律意见、监管沟通或真实资产上线批准。

## 17. 交付优先级与版本边界

### 17.1 P0：生产候选前必须完成

- 固定来源注册表和来源身份验证；
- 资产、仓单、证书、权利人承诺值和交割记录的规范化数据模型；
- 证据原文不进入公开链，公开输出只含哈希、版本、状态和非敏感引用；
- 证明签发、验证、过期、撤销、签名人轮换和防重放；
- T+0 快照、`TRANSFER_PENDING`、登记完成、失败、争议和超时状态；
- 证书版本只追加、不覆盖，且旧版本不能重新成为当前版本；
- 查询 API、写入 API、RBAC、幂等、审计和速率限制；
- 数据源中断或互相冲突时 fail closed；
- 禁止金融输出和敏感字段泄露的 schema、日志及导出门禁；
- 备份恢复、灾难恢复、对账及完整端到端沙盒演练。

### 17.2 P1：首个生产版本后可迭代

- 更多权威登记系统及仓储方适配器；
- 多司法辖区工作日历及 SLA 配置；
- 第三方只读 SDK 和更多语言客户端；
- 可验证凭证、硬件签名或门限签名的扩展实现；
- 更细粒度的订阅、事件过滤和审计导出；
- 多链只读消费适配器。

### 17.3 明确不做

- ERC 编号申请、ERC 规范所有权及 NFT 合约发行；
- 订单簿、交易撮合、资金托管、清算、贷款、质押、估值和定价；
- 多持有人、份额化或同一提货权映射多个 Token；
- 通过 AI 自动作出所有权、制裁、投资适当性或法律结论；
- 未经书面批准接入真实个人资料、真实资产、真实资金或主网写操作。

## 18. 逻辑架构与组件责任

```text
批准的数据源
  ├─ 登记系统适配器
  ├─ 证书签发方适配器
  └─ 仓储方适配器
          │
          ▼
  Ingestion Gateway ── Source Registry / Schema Registry
          │
          ▼
  Canonicalization & Evidence Hashing
          │
          ├─ Conflict Detector
          ├─ Asset/Certificate Version Store
          └─ Immutable Audit Journal
          │
          ▼
  Oracle State Engine ── Settlement Coordinator
          │
          ▼
  Attestation Signer / Revocation Registry
          │
          ├─ Query API
          ├─ Verification API / SDK
          ├─ Event Subscription
          └─ Admin & Audit UI
```

| 组件 | 核心责任 | 强制失败语义 |
| --- | --- | --- |
| Source Registry | 固定来源、身份、密钥、schema、有效期和权限 | 未注册或停用来源拒绝 |
| Ingestion Gateway | 接收签名输入、验证来源、限流、幂等和隔离 | 签名/时间/schema/幂等冲突拒绝 |
| Canonicalization | 规范字段、单位、时间、编码和哈希算法 | 不能无损规范化则人工复核 |
| Conflict Detector | 检测证书、仓单、所有者、版本和状态冲突 | 冲突时停止有效证明签发 |
| State Engine | 计算当前权威状态和允许的状态迁移 | 非法、乱序或越权迁移拒绝 |
| Settlement Coordinator | 管理 T+0 至登记完成的任务、期限和证据齐套 | 缺少任一必需证据不得完成 |
| Attestation Service | 生成规范证明、签名、验证、过期和撤销 | 签名门限不足或依赖异常拒绝 |
| Query API | 最小披露地返回状态、证明和历史 | 未授权字段不返回 |
| Audit Journal | 保存追加式业务与管理事件 | 不允许更新或删除历史事件 |
| Admin UI | 人工复核、来源管理、撤销、对账和审计 | 高风险操作双人复核 |

## 19. 详细用户旅程

### 19.1 初始资产验证

1. 已批准来源提交资产登记、证书和仓单的签名摘要。
2. Gateway 验证来源、schema、签名、时间窗口和幂等键。
3. 系统规范化字段并计算 `assetFingerprintHash`、`certificateHash` 和
   `warehouseReceiptHash`。
4. Conflict Detector 检查重复资产、多个当前证书、多个仓单及冲突所有者。
5. 无冲突时创建 `VERIFIED` 资产状态；有冲突时创建 `REVIEW_REQUIRED`，不得签发
   `VALID` 证明。
6. Oracle 签发有时效且绑定用途的证明，供独立协议消费者使用。

### 19.2 T+0 交易事实摄取

1. 获准外部系统提交成交事实，不提交资金或交易私钥。
2. Oracle 校验外部执行引用、资产、当前证书版本、双方钱包承诺值和事件唯一性。
3. 系统生成 `t0SnapshotHash` 并将 Oracle 状态设为 `TRANSFER_PENDING`。
4. 生成版本化登记任务和 `deadlineAt`，向登记及仓储适配器请求确认。
5. 从此时起，所有查询只能返回待交割或更严格状态，旧的允许转让证明必须被撤销或失效。

### 19.3 登记完成

1. 登记方提交所有者变更引用和新证书摘要；仓储方提交新提货权人确认。
2. 系统验证新证书的 `previousCertificateHash`、资产指纹、仓单和 T+0 快照。
3. `certificateVersion` 必须严格等于当前版本加一。
4. 证据齐套后写入追加式历史，签发新的 `VALID`/`ACTIVE` 事实证明。
5. 发布幂等 `CertificateSuperseded` 和 `SettlementFinalized` Oracle 事件。

### 19.4 失败、争议和撤销

1. 超时、来源拒绝、哈希冲突、司法冻结或仓储异常触发 `FROZEN`、
   `REVIEW_REQUIRED` 或取消状态。
2. 立即撤销仍可能被误用的有效证明。
3. 保存原因哈希、来源、操作者、时间及关联证据，不在公共输出中泄露原始材料。
4. 恢复到旧状态或形成新状态必须取得新的权威输入，管理员不得直接改写结果。

## 20. N=13 个迭代实施计划

每个迭代均应形成独立提交、自动化证据和验收报告。前一迭代退出条件未满足时，后一迭代
可以开展不依赖部分，但不得把整体状态标为完成。

### Iteration 0：范围冻结与工程基线

**目标**：把 Oracle 与 ERC、交易和金融业务彻底分离，建立可重复构建的工程骨架。

**交付物**：

- Oracle-only PRD、术语表、ADR 模板和威胁模型骨架；
- 服务、迁移、测试、文档和本地开发目录结构；
- 固定运行时和依赖锁文件；
- lint、typecheck、unit、secret scan、明文公网地址扫描和依赖审计脚本；
- 合成数据专用环境，默认禁用真实来源和一切链上写入。

**退出条件**：干净环境可离线或使用已批准依赖缓存完成构建；仓库中无凭据、私钥、个人资料、
真实服务器地址或任何废止品牌；所有默认外部写操作为关闭。

### Iteration 1：Schema Registry 与来源注册表

**目标**：只接受固定、版本化、可撤销的权威来源和数据契约。

**交付物**：

- `SourceAuthority`、`SourceKeySet`、`SchemaVersion`、`BusinessCalendar` 模型；
- 来源启用、停用、密钥轮换和 schema 兼容策略；
- 资产、证书、仓单、所有者承诺、冻结及变更输入 JSON Schema；
- 未知来源、任意 URL、过期密钥和未知 schema 的拒绝测试。

**退出条件**：ORACLE-001 全部负向测试通过；调用方无法指定任意端点或绕过来源注册表。

### Iteration 2：摄取网关与证据规范化

**目标**：安全接收权威输入并生成确定性证据哈希。

**交付物**：

- 请求签名、时间窗口、nonce、幂等键、重放保护和有效载荷大小限制；
- RFC 8785/JCS 或经批准的等价规范化规则；
- 字符编码、时间、单位、空值和字段排序规范；
- 原始证据隔离存储接口和公开摘要生成器。

**退出条件**：相同语义输入产生相同摘要；单字节变化产生不同摘要；重复、乱序、过期、超限和
恶意输入均被确定性拒绝。

### Iteration 3：资产、证书与仓单版本库

**目标**：建立一物一证关系的追加式事实数据库。

**交付物**：

- `AssetRecord`、`CertificateRecord`、`WarehouseRecord` 和 owner commitment 数据表；
- 当前版本投影与不可变历史分离；
- 唯一约束、乐观并发控制、版本递增和前序哈希约束；
- 冲突检测器及人工复核队列。

**退出条件**：不能创建两个当前证书、两个当前仓单或跳跃版本；历史记录无法通过业务接口更新或
删除；冲突只能进入 `REVIEW_REQUIRED`。

### Iteration 4：Oracle 状态机

**目标**：实现全部允许状态和严格迁移规则。

**交付物**：

- `VALID/INVALID/TRANSFER_PENDING/FROZEN/REVOKED/EXPIRED/REVIEW_REQUIRED/NOT_VERIFIED`；
- 状态迁移表、权限矩阵和原因码注册表；
- 乱序、并发、重复、回滚、来源冲突及断电恢复测试；
- 任何来源异常时的 fail-closed 策略。

**退出条件**：所有非法迁移失败且不产生部分写入；重放同一事件结果幂等；状态可由审计事件完整
重建。

### Iteration 5：证明签发与离线验证

**目标**：生成可独立验证、有时效、可撤销且绑定用途的 Oracle 证明。

**交付物**：

- versioned attestation envelope；
- `chainId/contract/tokenId/assetId/purpose/nonce/validFrom/expiresAt` 绑定；
- 签名人集合、门限策略、密钥轮换接口和离线验证库；
- 合成密钥测试、跨链/跨资产/跨用途重放及旧签名人测试。

**退出条件**：ORACLE-003 全部通过；服务不记录私钥、原始签名请求或敏感证据；验证库在不联网
情况下可验证完整证明链。

### Iteration 6：查询 API 与最小披露

**目标**：向资产持有人、审计员和第三方系统提供一致的只读事实查询。

**交付物**：

- 第 9 节规定的资产、Token 映射、证书历史、资格和证明查询接口；
- OpenAPI、分页、字段级授权、缓存语义、ETag 和标准错误码；
- 脱敏、速率限制、用途记录和批量导出门禁；
- 禁止价格、收益、评级、抵押率和投资意见的 schema 测试。

**退出条件**：未授权角色无法推断身份映射或取得原始证书/仓单；相同版本查询结果确定；
ORACLE-002、ORACLE-006 和 PRIVACY-001 通过。

### Iteration 7：撤销、冻结与订阅事件

**目标**：在来源失效或事实变化时及时使旧证明不可用。

**交付物**：

- 撤销注册表、撤销证明、紧急冻结和签名人集合停用；
- outbox 模式或等价的可靠事件发布；
- webhook/queue 订阅签名、幂等重试和死信处理；
- 来源撤销到查询及订阅生效的延迟指标。

**退出条件**：撤销后旧证明在所有查询和验证路径均失败；重复事件不产生重复副作用；
ORACLE-004 通过。

### Iteration 8：T+0 至 T+N 交割协调

**目标**：协调登记事实，不接触资金、撮合或交易签名。

**交付物**：

- `SettlementRecord`、T+0 快照、版本化工作日历和 `deadlineAt`；
- 登记、证书和仓储确认的证据齐套规则；
- finalize/cancel/dispute/timeout 状态及补偿流程；
- T+3 作为 Wenbao Profile 配置，不硬编码为通用 Oracle 规则。

**退出条件**：缺少任一必需证据不能完成；登记完成前查询持续返回待交割或更严格状态；超时和
争议不会把买方表述为已完成权利人。

### Iteration 9：权威来源沙盒适配器

**目标**：用合同测试固定登记系统、证书方和仓储方的输入边界。

**交付物**：

- 登记系统、证书签发方和仓储方 sandbox adapter；
- adapter capability、版本协商、超时、限速和熔断；
- 签名样本、错误样本、schema 演进和断连恢复测试；
- 生产端点、凭据和真实资料完全由部署层注入，不进入仓库。

**退出条件**：三个来源的成功、拒绝、冲突、延迟、离线及恢复路径均通过；未知 adapter 默认
拒绝；未取得真实来源书面授权时保持 sandbox-only。

### Iteration 10：管理、人工复核与不可变审计

**目标**：提供可审计且不能绕过权威证据的后台操作能力。

**交付物**：

- Admin UI/API：来源状态、冲突队列、撤销、签名人轮换、对账和审计导出；
- RBAC/ABAC、双人复核、会话安全和高风险操作二次确认；
- 追加式审计日志、哈希链、导出 manifest 和完整性验证工具；
- 管理员越权、CSRF、重放、批量导出和日志注入测试。

**退出条件**：管理员无法直接把资产改成 `VALID`、无法删除历史或绕过来源证明；任一状态可追溯
到来源输入、规则版本和操作者；AUDIT-001 通过。

### Iteration 11：SDK、下游消费与兼容性

**目标**：让独立协议和第三方应用只读、安全地消费 Oracle 证明。

**交付物**：

- 至少一个服务端 SDK 和一个离线验证包；
- 合成下游消费者及过期、撤销、乱序、跨用途重放测试；
- 可选只读链上验证适配器，不含 NFT 发行、交易和 ERC 提交；
- 版本锁定的 L3 Protocol Profile，钉住规范、参考实现和测试向量哈希；
- 同时校验两个候选接口与 ERC-8325 依赖，验证 Pending 和原子 Finalize 语义；
- 集成指南、错误处理、缓存与撤销检查要求。

**退出条件**：消费者无法通过 SDK 请求 Oracle 代签金融或链上交易；无效证明全部拒绝；接口变更
符合版本兼容策略；任一协议哈希或必需 interfaceId 不一致均失败关闭。

### Iteration 12：安全加固、容灾与生产候选

**目标**：形成可供独立审计的生产候选，但不自动授权生产上线。

**交付物**：

- SAST、依赖、秘密、容器/IaC、API 和渗透测试报告；
- 性能、容量、72 小时稳定性、队列积压和故障注入测试；
- 备份、时间点恢复、跨故障域恢复、RPO/RTO 和密钥轮换演练；
- 数据保护影响评估、保留/删除策略、事件响应和 go/no-go 清单；
- 可复现构建、SBOM、签名制品和发布 manifest。

**退出条件**：所有 P0 缺陷关闭；独立安全、隐私和法律审查无未接受阻断项；完成完整沙盒演练；
真实来源、真实资产、主网和生产开关仍需单独书面批准。

## 21. 需求追踪矩阵

| 需求 | 主迭代 | 前置 | 最低验收证据 |
| --- | --- | --- | --- |
| ORACLE-001 | I1、I2、I9 | I0 | 来源与端点负向测试 |
| ORACLE-002 | I3、I4、I6 | I1–I2 | 全状态查询和冲突测试 |
| ORACLE-003 | I5 | I1–I4 | 签名、到期、nonce、重放测试 |
| ORACLE-004 | I7 | I4–I6 | 撤销端到端传播测试 |
| ORACLE-005 | I6、I10 | I3–I5 | 字段级授权和用途审计 |
| ORACLE-006 | I0、I6、I12 | 无 | schema、代码、UI、日志关键词门禁 |
| CONSUMER-001 | I3、I11 | I2 | 冲突关闭和映射不变量 |
| CONSUMER-004 | I8、I11 | I4–I7 | T+0 待交割及旧证明失效 |
| CONSUMER-005 | I8、I11 | I3–I7 | 新证书版本与前序哈希测试 |
| CONSUMER-006 | I8、I12 | I4–I7 | 超时、乱序、争议和恢复 |
| CONSUMER-007 | I4、I8、I11 | I3 | `REDEEMED` 防旧输入覆盖 |
| PRIVACY-001 | I2、I6、I10、I12 | I0 | API、日志、导出、制品扫描 |
| AUDIT-001 | I3、I10、I12 | I2 | 全链路重放和审计 manifest |

## 22. 每个迭代统一 Definition of Done

迭代只有同时满足以下条件才可标为完成：

1. PRD/ADR、schema、接口和实现处于同一版本；
2. 新增路径具有正向、负向、权限、幂等、重放和错误恢复测试；
3. lint、typecheck、unit、integration、secret、敏感字段和明文公网地址门禁通过；
4. 没有把凭据、私钥、个人资料、证书原文或生产配置写入仓库、CI 或日志；
5. 无默认启用的公网写入、真实来源、主网或资金路径；
6. 威胁模型、数据流、运行手册和回滚方案随实现更新；
7. 验收报告列出测试命令、结果、已知限制和未完成项；
8. 未通过的条件保持显式阻断，禁止用免责声明替代实现或测试；
9. 本迭代没有承担 ERC 编号、NFT 发行或第三方金融业务；
10. 工作树和发布制品通过可复现性与完整性校验。

## 23. 里程碑与发布标签

| 里程碑 | 包含迭代 | 可对外声明 |
| --- | --- | --- |
| M0 Engineering Baseline | I0 | 工程与范围基线已建立 |
| M1 Evidence Core | I1–I4 | 合成数据的来源、证据和状态核心完成 |
| M2 Verifiable Oracle | I5–I7 | 可签发、查询、验证和撤销合成证明 |
| M3 Settlement Sandbox | I8–I9 | T+0/T+N 与三个来源的沙盒闭环完成 |
| M4 Integration Candidate | I10–I11 | 审计后台与第三方只读集成候选完成 |
| M5 Production Candidate | I12 | 已形成审计候选；不等于生产获批或监管批准 |

任何里程碑均不得使用“SEC approved”“政府背书”“法律所有权已由区块链确定”或“保证非证券”
等表述。M5 之后仍须对具体来源、资产类别、司法辖区和生产环境逐项取得书面 go/no-go。

## 24. 待业务/法律确认项

以下事项不阻碍 I0–I7 使用合成数据开发，但阻断 I8 以后对应生产配置和最终上线：

- 每一权威来源的正式数据字典、签名方式、授权证明和撤销 SLA；
- 文保链/证书/仓单之间的权威优先级及发生冲突时的法定处理规则；
- T+3 的起算点、工作日历、节假日、时区、超时和争议期限；
- owner commitment 的生成方、盐值控制、轮换及合法查询权限；
- 完整证书、仓单及身份材料的存储地域、保留期和跨境字段清单；
- Oracle 证明的合同效力、责任上限、依赖方义务和不当依赖处理；
- 真实来源接入、真实资产演练、生产签名人集合和紧急冻结授权矩阵；
- 生产数据库、消息系统、密钥设施及部署参数，以唯一受控服务器配置来源为准。

