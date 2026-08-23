# 版本化 RWA 证书生命周期与递延交割接口

## 中文工作草案

| 项目 | 内容 |
| --- | --- |
| 状态 | Working Draft，未提交、未分配 ERC 编号 |
| 文档语言 | 中文；确认后再制作英文 ERC 提案稿 |
| 工作名称 | Giraffe RWA Certificate Lifecycle Protocol |
| 提案发起主体 | Giraffe Technology Holding Limited |
| 拟议作者署名 | 由至少一个 GitHub 用户名代表 Giraffe Technology Holding Limited 提交；用户名待确认 |
| 提案类别 | Standards Track: ERC（拟） |
| 基础标准 | ERC-165、ERC-721 |
| 可选兼容 | ERC-7943 |
| 版本 | 0.1.1-zh-working-draft |
| 日期 | 2026-08-24 |

> 本文是内部审查用中文草案，不是 Ethereum Improvement Proposal，不具有正式 ERC 编号，
> 也不代表 Ethereum、监管机构、登记机构或证书签发方的认可。

> **规范效力提示（归档时补充）**：本草案是 v0.1.1 阶段稿，已被同目录
> `GIRAFFE_ERC_FORMAL_ZH.txt` 和 `GIRAFFE_ERC_FORMAL_EN.txt` 取代。两份正式文本冻结了
> ABI 并记录 interface ID `0xebaa86a0`（`IVersionedRWACertificate`）与 `0x2773d4c9`
> （`IDeferredCertificateSettlement`）；`PRE_SUBMISSION_TEST_REPORT_ZH.txt` 的测试结论也
> 针对该冻结形态。**接口定义以正式文本为准，本草案的接口代码块仅保留为阶段记录。**
> 正式文本按 `ERC_PRIOR_ART_DUPLICATION_REVIEW_ZH.md` 的建议收窄了规范范围，因此与本草案
> 存在下列已知差异：

| 项目 | 本草案（v0.1.1） | 正式文本（已冻结） | 收窄理由 |
| --- | --- | --- | --- |
| 扩展接口名 | `IDeferredRWASettlement` | `IDeferredCertificateSettlement` | 与“证书结算扩展”定位一致 |
| `assetIdOf(tokenId)` | 核心接口函数 | **已删除** | 复用 ERC-8325 资产锚定，关闭 P0 查重门禁 |
| `lifecycleStatus` 与四态枚举 | 核心接口函数及 `LifecycleStatus` | **已删除** | 冻结与可转移性复用 ERC-7943，避免重复标准化 |
| `LifecycleStatusChanged` 事件 | 核心事件 | **已删除** | 同上 |
| `CertificateInitialized` | 含 `assetId` 参数 | 不含 `assetId` | 随 `assetIdOf` 一并移除 |
| `SettlementCancelled` | 含 `bool frozen` | 不含 `frozen` | 冻结表达交由 ERC-7943 |
| interface ID | 声明"冻结前不固定" | 已冻结并经逐 selector XOR 复核 | ABI 冻结完成 |
| EIP-712 type hash | 声明"英文提案前冻结" | 未固定 schema，EIP-712 保持 SHOULD | 避免绑定单一签名格式 |

> 因此本草案第 7.2、7.4、7.5、8.5、9 节所述的接口形态、生命周期状态模型和 interface ID
> 冻结计划均已被上表取代。本草案未被改写为冻结形态，以保留阶段记录；如需规范性引用，
> 请使用正式文本。

## 1. 摘要

本草案定义一组面向 ERC-721 的可发现接口，用于将一个非同质化 Token 关联到一个链下资产
标识和一条版本化权威证书记录。合约公开当前证书哈希、证书版本、不可覆盖的历史记录以及
生命周期状态，但不自行判断链下法律所有权。

本草案同时定义可选的递延交割扩展。当链上转移意图与链下权威登记更新不能原子完成时，Token
可在 T+0 进入 `TRANSFER_PENDING`，并在实现定义的 T+n 之前保持不可转移。权威链下系统完成
登记并产生新证书后，合约在最终确认中原子完成证书版本升级、NFT 持有人变更和状态恢复。
若到期、被拒绝或发生争议，交割可被取消或转入冻结处理。

本草案不规定 n 的数值，不规定特定国家、机构、登记系统、证书格式、KYC/AML 实现、Oracle
网络或业务服务等级。

## 2. 动机

ERC-721 能表示唯一 Token 及其链上持有人，但没有统一接口表达：

1. Token 引用的链下资产标识；
2. 当前权威证书哈希和版本；
3. 旧证书如何被追加式替代，而不是被静默覆盖；
4. 链下登记尚未完成时，Token 是否处于递延交割中；
5. 应用如何判断 Token 当前能否普通转移；
6. 证书更新和 ERC-721 持有人变更如何形成同一个最终交割结果。

如果 ERC-721 在链下登记完成前直接转给拟议接收方，应用可能错误地认为链下权利变更已经
完成。如果 Token 在链下处理期间仍可继续转移，又可能出现重复处分、乱序登记或证书与 Token
持有人不一致。本草案以最小证书生命周期和递延交割状态机解决这些互操作问题。

## 3. 范围

### 3.1 规范范围

- 一个 ERC-721 Token 对应一个 `assetId`；
- 当前证书哈希、版本、生效时间和追加式历史；
- `ACTIVE`、`TRANSFER_PENDING`、`FROZEN`、`REDEEMED` 状态；
- ERC-165 接口发现和统一事件；
- 可选的开始、最终确认和取消递延交割流程；
- Pending 期间禁止普通 ERC-721 转移；
- 权威授权的最小防重放绑定字段；
- 与 ERC-721、ERC-7943 的兼容语义。

### 3.2 非目标

本草案不规范：

- 多持有人、份额化、1:N 或 N:1 Token 映射；
- NFT 拆分、合并、父子层级或份额重分配；
- 证券发行、贷款、质押、收益、做市、清算或其他金融业务；
- KYC、AML、制裁、身份注册或许可名单内部实现；
- 跨链登记同步、跨链消息或跨链最终性；
- 估值、价格、抵押率或投资适当性；
- 证书文件格式、业务字段、存储介质或 URI；
- 具体登记机构、Oracle 运营方、司法辖区或监管结论；
- 支付、资金托管、退款、市场撮合、API、SaaS 或 SLA；
- 链下权利的创设、执行或法律效力；
- 实物提取、权益行使或赎回流程。

## 4. 信任模型与法律边界

本草案区分链上事实、链下权威事实和验证结果。它只使合约能够引用及验证链下证据。实现不得
仅因 Token 存在、哈希已上链或某地址是 `ownerOf(tokenId)`，就宣称该地址必然拥有链下资产的
法定所有权、提货权、许可或其他法律权利。

`certificateAuthority(tokenId)` 返回的是合约接受的链上验证权威，不必等同于链下证书签发方，
也不表示该地址获得任何政府或监管授权。

## 5. 术语

- **Asset ID**：在当前合约信任域内唯一标识外部资产的 `bytes32`。
- **Certificate**：可序列化并计算摘要的外部权威记录。
- **Certificate Hash**：Profile 所定义规范化证书字节序列的 `keccak256`。
- **Certificate Version**：从 1 开始、逐次加一且不得回退的版本号。
- **Authority Reference**：登记记录、签发记录或证据包的非敏感 `bytes32` 引用。
- **Certificate Authority**：验证证书更新授权的链上账户或合约。
- **Settlement**：从转移意图开始到最终确认或取消的递延交割流程。
- **T+0**：合约接受转移意图并创建 Pending 记录的时点。
- **T+n**：外部权威流程完成的实现定义时点；n 不由本草案规定。
- **Settlement Deadline**：Pending 交割允许被最终确认的最后时间。
- **Ordinary Transfer**：ERC-721 `transferFrom` 或任一 `safeTransferFrom`。
- **Finalization**：原子写入新证书、变更 ERC-721 持有人并恢复 `ACTIVE`。

## 6. 规范性语言

本节之后的“必须”“不得”“应当”“不应”“可以”分别对应 RFC 2119 和 RFC 8174 中的 MUST、
MUST NOT、SHOULD、SHOULD NOT 和 MAY。

## 7. 核心证书生命周期规范

### 7.1 一对一约束

实现必须同时实现 ERC-721 和 ERC-165。每个已存在的 `tokenId` 必须返回一个非零 `assetId`；
同一 `assetId` 不得同时绑定到另一个未终止 Token。接口不得表达份额比例、多人共有或拆分关系。
Token ID 在证书升级和递延交割中必须保持不变。查询不存在的 Token 必须回退。

### 7.2 生命周期状态

状态编码固定为：

```text
0 ACTIVE
1 TRANSFER_PENDING
2 FROZEN
3 REDEEMED
```

| 状态 | 普通转移 | 语义 |
| --- | --- | --- |
| `ACTIVE` | 允许，但仍受其他规则约束 | 当前证书有效且无未完成交割 |
| `TRANSFER_PENDING` | 禁止 | 存在唯一 Pending 交割 |
| `FROZEN` | 禁止 | 存在争议、权威限制或验证失败 |
| `REDEEMED` | 永久禁止 | 不再表示可继续流转的有效资产引用 |

`REDEEMED` 必须是终态。状态变化必须更新可查询状态并发出
`LifecycleStatusChanged`，不得仅通过事件模拟变化。

### 7.3 证书版本规则

初始证书版本必须为 1，`previousCertificateHash` 必须为零。每次替代证书时：

- 新版本必须严格等于旧版本加一；
- 新证书哈希必须非零；
- `previousCertificateHash` 必须等于旧的当前证书哈希；
- 旧记录不得删除、覆盖或重排；
- 当前旧记录的 `supersededAt` 必须被设置；
- 新记录的 `supersededAt` 必须为零；
- 必须发出 `CertificateSuperseded`。

同一 Token 和版本的重复写入必须回退。版本不得跳号、回退或循环引用。

### 7.4 核心接口

> 阶段记录，已被正式文本取代：正式接口不含 `assetIdOf`、`lifecycleStatus`、
> `LifecycleStatus` 枚举和 `LifecycleStatusChanged` 事件，`CertificateInitialized` 也不含
> `assetId`。冻结形态见 `GIRAFFE_ERC_FORMAL_ZH.txt` 第 2 节。

```solidity
// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IVersionedRWACertificate is IERC165 {
    enum LifecycleStatus {
        ACTIVE,
        TRANSFER_PENDING,
        FROZEN,
        REDEEMED
    }

    struct CertificateRecord {
        bytes32 certificateHash;
        bytes32 previousCertificateHash;
        bytes32 authorityReference;
        uint64 version;
        uint64 effectiveAt;
        uint64 supersededAt;
    }

    event CertificateInitialized(
        uint256 indexed tokenId,
        bytes32 indexed assetId,
        bytes32 indexed certificateHash,
        uint64 version,
        bytes32 authorityReference,
        uint64 effectiveAt
    );

    event CertificateSuperseded(
        uint256 indexed tokenId,
        uint64 indexed version,
        bytes32 indexed certificateHash,
        bytes32 previousCertificateHash,
        bytes32 authorityReference,
        uint64 effectiveAt
    );

    event LifecycleStatusChanged(
        uint256 indexed tokenId,
        LifecycleStatus previousStatus,
        LifecycleStatus newStatus,
        bytes32 reasonHash
    );

    function assetIdOf(uint256 tokenId)
        external view returns (bytes32 assetId);

    function currentCertificate(uint256 tokenId)
        external view returns (CertificateRecord memory record);

    function certificateAt(uint256 tokenId, uint64 version)
        external view returns (CertificateRecord memory record);

    function lifecycleStatus(uint256 tokenId)
        external view returns (LifecycleStatus status);

    function certificateAuthority(uint256 tokenId)
        external view returns (address authority);
}
```

核心接口有意不规定通用外部证书写入函数。证书可由构造流程、受控管理函数或递延交割扩展更新，
但所有路径都必须满足相同的查询、历史和事件语义。

### 7.5 ERC-165 发现

实现必须对 ERC-165、ERC-721 和 `IVersionedRWACertificate` 返回支持。

> 已完成：ABI 已冻结，`IVersionedRWACertificate` 的 interface ID 为 `0xebaa86a0`，经 Solidity
> 编译和逐 selector XOR 双重复核（见 `PRE_SUBMISSION_TEST_REPORT_ZH.txt` 第二节）。本节原文
> 所述“冻结前不固定 interface ID”的计划已由正式文本执行完毕。

## 8. 可选递延交割扩展

### 8.1 状态与唯一性

交割状态固定为 `NONE=0`、`PENDING=1`、`FINALIZED=2`、`CANCELLED=3`。每个
`settlementId` 必须全局唯一。交割只能从 `PENDING` 进入一个终态，且每个 Token 同一时点最多
有一个 Pending 交割。

### 8.2 开始交割

`beginSettlement` 成功前必须验证：

- Token 存在且为 `ACTIVE`；
- 调用者是当前持有人、获批准地址或操作方；
- `to` 非零且不等于当前持有人；
- `settlementId` 未使用，`snapshotHash` 非零；
- `deadline` 晚于当前区块时间；
- Token 没有其他 Pending 交割；
- 附加合规检查已通过。

成功后必须记录 `from`、`to`、快照、开始时间和截止时间，把生命周期设为
`TRANSFER_PENDING` 并发出事件。`ownerOf(tokenId)`、证书哈希和证书版本必须保持不变。
Pending 期间所有普通转移必须回退。

### 8.3 最终确认

`finalizeSettlement` 只能处理未超过 `deadline` 的 Pending 交割。授权必须来自当前
`certificateAuthority(tokenId)` 或能被其验证，并绑定当前链、合约、Token、交割、参与方、
旧证书、新证书、新版本、`effectiveAt`、有效期和 nonce。

最终确认必须在同一交易中原子完成：

1. 标记旧证书被替代；
2. 追加新证书，新版本等于旧版本加一；
3. 把 ERC-721 Token 从 `from` 转给 `to`；
4. 把生命周期恢复为 `ACTIVE`；
5. 把交割设为 `FINALIZED` 并消费 nonce；
6. 按顺序发出 `CertificateSuperseded`、`Transfer`、
   `LifecycleStatusChanged`、`SettlementFinalized`。

任一步骤失败必须使整笔交易回退，不得留下部分证书更新或持有人变更。

### 8.4 取消

Pending 交割可以通过有效权威取消授权取消；超过 `deadline` 后，记录中的 `from` 也可以取消。
取消不得改变持有人、当前证书哈希或版本。普通超时应恢复 `ACTIVE`；存在证书冲突、权威限制、
签名人失陷或资产争议时应进入 `FROZEN`。

### 8.5 扩展接口

> 阶段记录，已被正式文本取代：接口名为 `IDeferredCertificateSettlement`，且
> `SettlementCancelled` 不含 `bool frozen` 参数。冻结形态见 `GIRAFFE_ERC_FORMAL_ZH.txt`
> 第 6 节。

```solidity
// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IDeferredRWASettlement is IERC165 {
    enum SettlementStatus {
        NONE,
        PENDING,
        FINALIZED,
        CANCELLED
    }

    struct SettlementRecord {
        uint256 tokenId;
        address from;
        address to;
        bytes32 snapshotHash;
        uint64 initiatedAt;
        uint64 deadline;
        SettlementStatus status;
    }

    event SettlementStarted(
        bytes32 indexed settlementId,
        uint256 indexed tokenId,
        address indexed from,
        address to,
        bytes32 snapshotHash,
        uint64 deadline
    );

    event SettlementFinalized(
        bytes32 indexed settlementId,
        uint256 indexed tokenId,
        bytes32 indexed certificateHash,
        uint64 certificateVersion,
        uint64 effectiveAt
    );

    event SettlementCancelled(
        bytes32 indexed settlementId,
        uint256 indexed tokenId,
        bytes32 indexed reasonHash,
        bool frozen
    );

    function settlement(bytes32 settlementId)
        external view returns (SettlementRecord memory record);

    function pendingSettlementOf(uint256 tokenId)
        external view returns (bytes32 settlementId);

    function beginSettlement(
        uint256 tokenId,
        bytes32 settlementId,
        address to,
        bytes32 snapshotHash,
        uint64 deadline
    ) external;

    function finalizeSettlement(
        bytes32 settlementId,
        bytes32 newCertificateHash,
        bytes32 authorityReference,
        uint64 effectiveAt,
        bytes calldata authorityData
    ) external;

    function cancelSettlement(
        bytes32 settlementId,
        bytes32 reasonHash,
        bytes calldata authorityData
    ) external;
}
```

实现扩展时必须同时实现核心接口，并通过 ERC-165 声明支持。

> 已完成：扩展 interface ID 为 `0x2773d4c9`，与核心接口之间未发现 selector 冲突。

## 9. 权威授权

最终确认授权至少必须加密绑定：

```text
chainId
verifyingContract
tokenId
settlementId
from
to
previousCertificateHash
newCertificateHash
newCertificateVersion
effectiveAt
validUntil
nonce
```

缺少任一字段的授权不得用于最终确认。授权必须域分离，不得跨链、跨合约、跨 Token、跨交割或
跨用途重放。成功使用的 nonce 必须永久标记为已消费；回退交易不得错误消费 nonce。

实现应优先采用 EIP-712 和 ERC-1271。

> 已变更：正式文本未固定 typed-data schema 或 type hash，EIP-712 与 ERC-1271 保持 SHOULD
> 级别，以免把规范绑定到单一签名格式。本节原文所述“英文提案前冻结 schema”的计划未执行。权威轮换必须可审计；权威失陷时必须能冻结相关 Token 并拒绝旧授权。

## 10. ERC-721 转移语义

仅 `ACTIVE` Token 可以进行普通转移。对于受递延交割管理的持有人变化，普通转移不得绕过
`beginSettlement` 和 `finalizeSettlement`。

在 `TRANSFER_PENDING` 期间，`ownerOf(tokenId)` 必须继续返回记录中的 `from`。拟议接收方
只能从 Settlement 查询，不得被描述为已完成最终交割的 Token 持有人。

进入 Pending 后，实现应清除或冻结单 Token 批准。即使批准仍存在，普通转移也必须回退。
最终确认使用开始交割时记录的持有人授权和有效权威授权，不依赖最终确认时仍存在的 `approve`。

## 11. ERC-7943 兼容性

实现可以同时声明 ERC-7943 非同质化接口。若声明兼容：

- `canTransfer` 在 Pending、Frozen 或 Redeemed 时必须返回 `false`；
- `getFrozenTokens` 应仅把 `FROZEN` 映射为冻结数量 1；
- Pending 是交割锁定，不应仅依赖 `getFrozenTokens` 表达；
- `setFrozenTokens` 不得解除 Pending 锁定；
- `forcedTransfer` 不得静默绕过证书版本规则。

若 `forcedTransfer` 改变持有人，实现必须原子完成相应证书更新，或保持 `FROZEN` 并明确表示
证书尚未替代。不得改变 `ownerOf` 后继续把旧证书表示为对新持有人有效。

## 12. 事件、错误与索引

事件必须足以让无特权索引器重建资产标识、证书版本链、生命周期变化及每个交割的终结结果。
`reasonHash`、`snapshotHash` 和 `authorityReference` 必须是不透明摘要，不得包含个人信息、
完整证书、仓储位置或其他敏感数据。

参考实现至少应区分以下错误：不存在的 Token、错误状态、重复资产、错误版本、错误前序证书、
重复交割、非 Pending 交割、并发 Pending、超时、参与方不匹配、权威授权无效、授权过期、nonce
已使用、转移受限以及 Token 已 Redeemed。

## 13. 理由

- **ERC-721**：本草案是一个 Token 对应一个唯一外部资产，不采用余额或份额模型。
- **追加式历史**：只保留当前哈希无法发现覆盖和回退；连续版本及前序哈希可验证替代链。
- **不定义证书 schema**：证书内容具有行业和司法辖区差异，链上只统一摘要、版本和时间。
- **使用 T+n**：完成时间由具体登记系统、资产和日历决定，固定期限不具备通用性。
- **Pending 不改变 ownerOf**：避免在权威登记完成前误表示最终持有人已经变化。
- **不重定义 freeze**：ERC-7943 已提供通用冻结和转移检查能力。
- **REDEEMED 只作终态**：不重复定义实物提取或权益行使流程。

## 14. 向后兼容性

本草案是 ERC-721 可选扩展，不改变 ERC-721 ABI。不识别本草案的旧应用仍可读取 ERC-721，
但可能无法识别 Pending 和证书版本，因此限制必须由合约强制，不能依赖前端检查。

不可升级的旧 ERC-721 可使用外部注册表提供查询，但只有底层所有转移入口都能强制 Pending
锁定时，才可以声明实现递延交割扩展。

## 15. 安全考虑

- 权威密钥可影响证书和交割，应采用多签或门限签名、硬件隔离、轮换、撤销和紧急冻结。
- 单一管理员不得绕过权威授权完成最终确认。
- 授权必须绑定完整域和前后状态，防止跨链、跨 Token、跨交割和旧版本重放。
- 并发授权必须验证当前证书哈希和预期版本，只有一个可以成功。
- 最终确认包含 ERC-721 转移，应在外部调用前锁定状态并防止重入。
- `deadline` 使用区块时间，不应表达严格现实世界 SLA，应保留合理容差。
- 权威拒绝服务时可超时取消；发生冲突应冻结，不得猜测链下事实。
- `settlementId`、参与方、快照和 nonce 必须绑定以防 calldata 复制和抢跑。
- 强制转移不是证书变更完成的证据。
- 合约升级不得删除历史、重用 nonce、改变已终结交割或恢复 `REDEEMED`。
- Profile 必须说明证书规范化字节序列；视觉相同不代表文件字节和哈希相同。

## 16. 隐私考虑

链上字段和事件只应保存不可逆摘要、版本、状态、非敏感时间和不透明引用。不得直接写入姓名、
证件号、联系方式、钱包实名映射、完整证书、精确仓储位置、KYC/AML 原始材料或可逆低熵哈希。

对低熵标识计算普通哈希不能提供隐私。实现应采用随机化承诺、访问控制和链下最小化存储。

## 17. 参考实现与测试要求

参考实现至少包含 ERC-721、两个接口、证书权威、追加式历史、Pending 门禁、原子最终确认、超时
取消、争议冻结、ERC-165、自定义错误、单元测试、模糊测试和状态机不变量测试。

必须验证以下场景：

1. v1 初始化及重复 `assetId` 拒绝；
2. T+0 开始后状态为 Pending、`ownerOf` 不变且三个普通转移入口全部失败；
3. T+n 在 deadline 前最终确认，版本加一、持有人变更、状态恢复；
4. 超时取消不改变持有人和证书；
5. 权威拒绝或争议取消进入 Frozen；
6. 任一域字段变化都使旧授权失效；
7. 并发 Pending、版本跳号、旧授权覆盖和重复终结全部失败；
8. Redeemed 拒绝转移、新交割、证书替代和状态恢复。

必须通过属性测试证明：

- 一个未终止 `assetId` 最多对应一个 Token；
- 一个 Token 同一时点只有一个当前证书和一个 Pending 交割；
- 历史只能增加且版本连续；
- 非 Active 状态不能普通转移；
- Pending 期间 `ownerOf` 不变；
- 只有最终确认能同时改变持有人和证书版本；
- 取消不改变持有人和证书；
- nonce 最多成功使用一次；
- Redeemed 永不恢复。

## 18. 与现有 ERC 的关系

- **ERC-8325**：定义 Token 与链下资产锚点的一对一绑定、锚点状态和不可变绑定历史，与本草案
  的 `assetIdOf`、一对一绑定和部分生命周期语义高度重叠。本草案不得把通用资产锚定作为主要
  创新点；英文提案前必须决定复用 ERC-8325，或逐函数证明另设接口的必要性。
- **ERC-6997**：定义 ERC-721 转移发起后等待验证、验证通过再转移的流程，与 Pending 和最终
  确认高度重叠。本草案的候选差异仅限于证书版本替代、外部登记证据、deadline/cancel 以及
  “更新证书并转移 Token”的原子性，不得再描述为通用转移验证标准。
- **ERC-6956**：以 Oracle attestation 证明对物理锚点的控制；本草案不证明物理控制，候选范围是
  权威证书连续版本及链下登记在 T+n 完成前的递延交割。
- **ERC-3643**：面向 ERC-20 许可证券与身份合规，本草案不继承其模型。
- **ERC-7943**：提供通用 RWA 转移检查、冻结和强制转移；本草案复用而不重复。
- **ERC-8106**：侧重 ERC-20 事件型合规；本草案是 ERC-721 证书状态机。
- **ERC-8048**：通用 metadata 可承载辅助数据，但不能替代连续证书历史。
- **ERC-6454、ERC-7066、ERC-5058**：分别提供可转移性查询或 NFT 锁定机制。本草案不得重新
  发明通用 transferability/lock 接口；Pending 门禁只应表达证书交割所需的特定约束。
- **ERC-4906、ERC-5185**：分别覆盖 NFT 元数据更新通知与受控元数据变换。证书变化影响
  `tokenURI` 时应兼容 ERC-4906；证书替代链必须说明为何不是普通元数据版本管理。
- **ERC-4519**：覆盖物理 IoT 资产与 NFT 的相互认证和转移后持有人关联；本草案不要求物理
  设备地址或设备认证。
- **ERC-7578、ERC-7498、ERC-7765**：涉及实物信息和权益行使；本草案不定义赎回流程。
- **ERC-7891**：定义拆分、合并和份额；本草案明确排除。

当前查重结论为“有条件的新颖性”，不是“无重叠”。英文提案前必须证明证书版本替代与交割
原子耦合不能由 ERC-8325、ERC-6997、ERC-6956 与 ERC-7943 的简单组合充分表达。完整逐接口
审查见同目录 `ERC_PRIOR_ART_DUPLICATION_REVIEW_ZH.md`。

## 19. 非规范性应用示例：文保链 Profile

> 本节完全非规范性。实现本草案不需要连接、识别或信任文保链。

某个实现可以把文保链作为众多可选权威登记系统之一：`assetId` 对应 Profile 定义的资产标识
摘要，`certificateHash` 对应规范化证书文件摘要，`authorityReference` 对应登记变更记录或
证据包摘要。转移意图在 T+0 进入 Pending，文保链在其流程定义的 T+n 产生新证书，验证方确认
后最终交割；未在 deadline 前完成则取消或冻结。

该 Profile 可以定义自己的 n、日历、证书 schema、签名人集合、服务等级和争议流程，但不得
改变通用接口，也不得被描述为 ERC 强制要求或 Ethereum 认可。其他登记系统可以建立同等 Profile。

## 20. 开放问题

1. 是否强制所有持有人变化均通过递延交割，还是允许可查询的即时转移例外；
2. 是否把权威授权固定为 EIP-712 + ERC-1271；
3. `certificateAuthority` 是否允许每 Token 不同；
4. 权威轮换是否需要独立接口；
5. ERC-7943 `forcedTransfer` 映射是否足够明确；
6. Frozen 解除是否完全交给 ERC-7943；
7. Redeemed 是否继续放在核心；
8. 核心和递延交割是否拆成两个 ERC；
9. 是否增加标准授权验证视图；
10. 是否需要批量只读查询；
11. 是否删除 `assetIdOf` 并直接复用 ERC-8325 的 `anchorIdOf` 与 `anchorRegistry`；
12. 递延交割接口应作为 ERC-6997 的证书结算扩展，还是保留独立但兼容的状态机。

## 21. 提交前门禁

外部发布前必须完成：中文业务和技术确认、prior art 逐函数差异矩阵、ABI 和状态编码冻结、两个
interface ID、完整 EIP-712 schema、Solidity 参考实现、单元/模糊/属性测试、威胁模型、隐私检查、
专利与第三方自由实现评估以及 CC0 确认。

提案以 **Giraffe Technology Holding Limited** 名义发起。依据 EIP-1，正式英文稿的 `author`
字段必须至少列出一个 GitHub 用户名，以接收通知并代表提案作出维护决定；作者可以只使用用户名，
不必公开自然人姓名。在该 GitHub 用户名由用户确认前，不得虚构作者信息或提交 PR。

ABI 冻结前必须关闭两项 P0 查重门禁：一是 ERC-8325 资产锚定接口的复用或差异证明；二是
ERC-6997 递延验证流程的复用、扩展或差异证明。未关闭时不得宣称本草案已通过 prior-art 审查。

规范必须移除机构依赖、固定期限、法律结论和营销表述。只有在用户明确授权后才能发布
Ethereum Magicians 讨论；处理反馈后，须再次获得明确授权才能向 `ethereum/ERCs` 提交 PR。

## 22. 版权

本中文草案拟在正式提交时采用 CC0。正式英文提案必须使用 EIP-1 要求的版权弃权文本。

在专利及必要权利门禁完成前，不得对外声称第三方已获得无障碍实现许可，也不得提交正式 ERC。
