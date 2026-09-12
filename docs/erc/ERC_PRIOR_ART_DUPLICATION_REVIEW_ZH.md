# Giraffe ERC 现有标准查重与重叠审查

## 1. 文档状态

| 项目 | 内容 |
| --- | --- |
| 状态 | 内部审查稿；非 ERC、未提交 |
| 日期 | 2026-08-24 |
| 提案发起主体 | Giraffe Technology Holding Limited |
| 被审查草稿 | 《版本化 RWA 证书生命周期与递延交割接口》中文工作草案 v0.1.1 |
| 资料边界 | Ethereum 官方 EIP/ERC 页面；状态以审查日页面为准 |

## 2. 结论

未发现与本草案所有要素完全相同的单一 ERC，但发现两项 P0 高度重叠：

1. ERC-8325 已覆盖 Token 与链下资产锚点的一对一绑定、锚点状态和不可变绑定历史；
2. ERC-6997 已覆盖 ERC-721 转移发起后进入待验证状态、验证通过后才实际转移的流程。

因此，本草案只能暂定为“有条件的新颖”。可保留的候选创新中心是：权威证书的连续版本替代、
外部登记证据，以及证书替代与 ERC-721 持有人变化在最终确认时的原子耦合。通用资产锚定、通用
转移验证、通用冻结、通用锁定、通用元数据和赎回均不应作为本提案重新标准化的范围。

## 3. 重叠矩阵

| 标准 | 审查日状态 | 已覆盖的核心能力 | 与本草案重叠度 | 仍可能成立的差异 | 建议动作 |
| --- | --- | --- | --- | --- | --- |
| ERC-8325 Asset Anchor Registry | Review | 链下资产锚点、Token 双向绑定、状态、重认证、不可变绑定历史 | P0 / 高 | 不规定逐 Token 的权威证书替代链，也不把新证书确认与 NFT 转移原子结算 | 优先复用 `anchorIdOf`、`anchorRegistry`；不得把 `assetIdOf` 当作创新点 |
| ERC-6997 ERC-721 with transaction validation step | Review | 转移进入待验证、旧持有人保持、验证后执行转移 | P0 / 高 | 不规定证书版本、外部登记证据、deadline/cancel；允许获批账户绕过验证 | 把递延接口定位为“证书结算扩展”，逐项说明兼容与不同语义 |
| ERC-6956 Asset-bound NFTs | Review | 资产锚点、Oracle attestation、基于物理控制证明的转移/批准/销毁 | P1 / 高 | 本草案不证明物理控制，处理权威登记证书的替代与延迟结算 | 明确证据模型不同；避免重复 asset anchor 术语和能力 |
| ERC-7943 RWA Token | Final | `canSend`、`canReceive`、`canTransfer`、冻结、强制转移 | P1 / 中高 | 不规定证书连续性及外部登记完成后的结算 | 复用通用合规与冻结；只定义 Pending 的证书结算约束 |
| ERC-6454 Minimal Transferable NFT | Final | 最小可转移性查询 | P2 / 中 | 不含证书和结算 | 如需生态级可转移性发现，兼容而非另设同类查询 |
| ERC-7066 Lockable ERC-721 | Final | NFT 锁定、解锁、locker、transferAndLock | P2 / 中 | 不含外部登记和证书替代 | Pending 锁定只作为结算结果，不另造通用锁协议 |
| ERC-5058 Lockable NFTs | Stagnant | 锁授权、锁定和到期时间 | P2 / 中 | 不含证书结算 | 在理由中说明为何不采用其锁授权模型 |
| ERC-2018 Clearable Token | Stagnant | 发起、处理、执行、拒绝、取消的链下清算模型 | P2 / 中 | 主要针对可清算 Token，不定义 ERC-721 证书版本历史 | 引用其状态机先例，并突出证书原子替代差异 |
| ERC-8048 On-Chain Metadata | Draft | 通用键值元数据、metadata authority | P2 / 中 | 不保证证书替代连续性或交割 | 证书哈希不是通用 metadata 的替代方案；说明最小必要字段 |
| ERC-5185 NFT Mutable Metadata | Stagnant | 确定性、受控、顺序化元数据变换 | P2 / 中 | 不含权威登记交割 | 证明证书历史是外部事实证明，不只是展示元数据版本 |
| ERC-4906 Metadata Update Extension | Final | `MetadataUpdate` / `BatchMetadataUpdate` 通知 | P3 / 低 | 仅通知，无证书或交割 | 证书变化导致 `tokenURI` 改变时应发送其事件 |
| ERC-4519 NFTs Tied to Physical Assets | Final | IoT 设备与 NFT 相互认证、转移后新持有人关联 | P2 / 中 | 要求物理设备地址和认证；本草案依赖权威登记证书 | 明确不要求设备密钥或 proof-of-control |
| ERC-3643 T-REX | Final | ERC-20 许可证券、身份与合规模块 | P3 / 低 | Token 类型和目标不同 | 不继承、不扩展、不宣称替代 |
| ERC-8106 Compliance Events | Draft | ERC-20 实体分类和事件型合规审计 | P3 / 低 | 不处理证书替代和 ERC-721 交割 | 仅作边界说明 |
| ERC-7578 Physical Asset Redemption | Final | 实物属性和赎回 | P3 / 低 | 本草案不定义赎回权和履约 | `REDEEMED` 若保留，只表达状态；不得重复赎回流程 |
| ERC-7498 NFT Redeemables | Final | NFT 赎回机制 | P3 / 低 | 本草案不发行或消费可赎回项 | 不纳入首个规范 |
| ERC-7765 RWA NFT Privileges | Draft | 随 RWA NFT 转移和行使的权益 | P3 / 低 | 本草案不定义权益 | 明确排除 |
| ERC-7891 NFT Split and Merge | Draft | 拆分、合并、份额 | P3 / 无直接重叠 | 本草案坚持一个资产对应一个 ERC-721 | 明确排除，不引入碎片化 |
| ERC-7929 Token-to-Token Binding | Draft | 永久 Token 绑定和所有权镜像 | P3 / 低 | 不处理链下资产证书 | 无需纳入接口，仅在完整 prior art 中记录 |

## 4. 逐接口查重

| 本草案要素 | 最接近的既有能力 | 判断 | 处理要求 |
| --- | --- | --- | --- |
| `assetIdOf(tokenId)` | ERC-8325 `anchorIdOf(tokenId)` | 功能意图高度相近 | 默认删除并复用 ERC-8325，或提交前给出不可替代的技术理由 |
| 一资产一 Token 绑定 | ERC-8325 registry-scoped binding；ERC-6956 asset anchor | 高度重叠 | 不作为新颖性声明；复用或明确不同信任域 |
| `certificateAuthority(tokenId)` | ERC-8048 metadata authority、ERC-6956 Oracle、ERC-8325 registry | 角色部分相近，授权对象不同 | 只保留“谁能确认证书替代”的最小语义 |
| `lifecycleStatus` | ERC-8325 anchor 状态、ERC-7943 freeze、ERC-6454 transferable | 状态投影重叠 | 不重复冻结/可转移性；只保留证书生命周期必需状态 |
| `beginSettlement` | ERC-6997 待验证转移；ERC-2018 order transfer | 流程高度相近 | 明确输入必须绑定旧/新证书证据和 settlement id |
| Pending 时禁止转移 | ERC-6997 未验证不转移；ERC-7066/5058 lock | 结果高度相近 | 复用发现接口，规范仅强制结算不变量 |
| `finalizeSettlement` | ERC-6997 validate-and-transfer；ERC-2018 execute | 转移动作高度相近 | 候选创新必须是“证书版本替代 + 转移”同一交易原子完成 |
| `cancelSettlement` / deadline | ERC-2018 cancel/reject；ERC-5058 expiry | 中度重叠 | 只定义清理陈旧证书交割所需的最小语义 |
| 追加式证书历史 | ERC-8325 绑定历史；ERC-5185 元数据变换序列 | 数据结构部分重叠 | 历史对象应限定为 authority-attested certificate supersession |
| `REDEEMED` | ERC-7578、ERC-7498、ERC-7765 | 概念邻近 | 优先从核心删除；若保留不得定义赎回权或流程 |

未发现当前函数名与上述标准出现足以直接造成 selector 冲突的同名整套接口；风险主要是语义和范围
重复，而不是 Solidity 名称碰撞。正式冻结 interface ID 前仍须用编译器和 selector 工具机械复核。

## 5. 建议的规范收窄方案

### 5.1 推荐组合

- 基础：ERC-165 + ERC-721；
- 资产锚定：优先兼容或复用 ERC-8325，不另建竞争性的通用资产标识标准；
- 合规和冻结：复用 ERC-7943；如只需最小可转移性发现，评估 ERC-6454；
- 元数据更新通知：证书更新影响 `tokenURI` 时兼容 ERC-4906；
- 新核心：只定义 `currentCertificateHash`、`certificateVersion`、证书替代历史及统一事件；
- 可选扩展：只定义“外部登记确认新证书后，证书替代与 ERC-721 转移原子完成”的结算语义。

### 5.2 不推荐方案

继续以独立 `assetIdOf`、通用四态生命周期、通用 Pending 转移状态机作为同一个新 ERC 的核心，
会同时撞入 ERC-8325、ERC-6997 和 ERC-7943 的范围。除非能给出无法组合实现的互操作需求和
可验证测试向量，否则这一方案在 Ethereum Magicians 和 ERC 编辑审查中存在较高的“重复标准”质疑风险。

## 6. 提交身份与 EIP-1 门禁

提案应以 **Giraffe Technology Holding Limited** 名义发起，并在摘要材料、仓库和讨论帖中保持
一致。正式英文 EIP/ERC 文件不能只写公司名：EIP-1 要求至少一名作者使用 GitHub 用户名，以便
接收通知并批准或拒绝后续变更。作者可以只使用用户名，不必公开自然人姓名。因此最终 `author`
行须在用户确认后采用类似形式：

```yaml
author: github-username (@github-username), Giraffe Technology Holding Limited
```

方括号内容只是占位符，不得原样提交，也不得由起草人猜测。公司名称不构成 Ethereum 背书、
监管批准或正式 ERC 身份。

## 7. 提交前查重门禁

> **门禁关闭状态（归档时补充）**：下列编号对应本节原有 9 项门禁。判定依据为同目录
> `GIRAFFE_ERC_FORMAL_ZH.txt` / `GIRAFFE_ERC_FORMAL_EN.txt` 与
> `PRE_SUBMISSION_TEST_REPORT_ZH.txt`；未经核实的项一律记为未关闭。

| 门禁 | 状态 | 依据 |
| --- | --- | --- |
| 1. `assetIdOf` 复用 ERC-8325 | **已关闭** | 正式文本删除 `assetIdOf`，Rationale 明确不另设通用资产锚定接口 |
| 2. ERC-6997 逐项差异 | **已关闭** | 正式文本说明 ERC-6997 允许 approved 账户直接转移，本提案要求所有 operator 遵守 Pending；测试报告第 9 项覆盖 |
| 3. ERC-7943 freeze/forced transfer 映射 | **部分关闭** | 正式文本已规定 Pending 期间 `canTransfer` 必须为 `false`、`forcedTransfer` 不得绕过版本规则，但未写成规范性映射表格 |
| 4. `REDEEMED` 是否删除 | **已关闭** | 正式文本不含 `REDEEMED` 及四态生命周期枚举 |
| 5. interface ID 与 selector 冲突 | **已关闭** | `0xebaa86a0` / `0x2773d4c9`，逐 selector XOR 复核，无冲突 |
| 6. 证明三标准组合不足 | **部分关闭** | 正式文本以“证书替代与转移原子完成”“所有 operator 均受 Pending 约束”作为差异论证，尚无可验证测试向量形式的证明 |
| 7. GitHub 用户名确认 | **未关闭** | 正式文本仍为 `github-username` 占位符 |
| 8. CC0、专利与必要权利检查 | **未关闭** | 无检查记录 |
| 9. 对外发布与提交授权 | **未关闭** | 属持续约束，须逐次取得明确授权 |

未关闭项中第 7、8、9 项为对外提交的硬门禁；第 3、6 项为编辑审查风险项。

1. 决定 `assetIdOf` 是否删除并复用 ERC-8325；
2. 对 ERC-6997 制作逐状态、逐函数差异测试，尤其处理 approved operator 绕过语义；
3. 把 ERC-7943 的 freeze/forced transfer 与本草案 Pending/Frozen 映射写成规范性表格；
4. 判断 `REDEEMED` 是否从核心删除；
5. 用 Solidity 编译器计算最终 interface ID，并检查 selector 冲突；
6. 证明仅组合 ERC-8325 + ERC-6997 + ERC-7943 仍不能满足证书替代原子结算；
7. 由用户确认至少一个代表 Giraffe Technology Holding Limited 的 GitHub 用户名；
8. 完成 CC0、专利和必要权利检查后，才可制作英文稿；
9. 未经用户另行明确授权，不发布 Ethereum Magicians 帖子，也不提交 `ethereum/ERCs` PR。

## 8. 官方资料

- [EIP-1：EIP Purpose and Guidelines](https://eips.ethereum.org/EIPS/eip-1)
- [ERC-8325：Asset Anchor Registry](https://eips.ethereum.org/EIPS/eip-8325)
- [ERC-6997：ERC-721 with transaction validation step](https://eips.ethereum.org/EIPS/eip-6997)
- [ERC-6956：Asset-bound NFTs](https://eips.ethereum.org/EIPS/eip-6956)
- [ERC-7943：RWA Token](https://eips.ethereum.org/EIPS/eip-7943)
- [ERC-6454：Minimal Transferable NFT](https://eips.ethereum.org/EIPS/eip-6454)
- [ERC-7066：Lockable ERC-721](https://eips.ethereum.org/EIPS/eip-7066)
- [ERC-5058：Lockable NFTs](https://eips.ethereum.org/EIPS/eip-5058)
- [ERC-2018：Clearable Token](https://eips.ethereum.org/EIPS/eip-2018)
- [ERC-8048：On-Chain Metadata](https://eips.ethereum.org/EIPS/eip-8048)
- [ERC-5185：NFT Mutable Metadata](https://eips.ethereum.org/EIPS/eip-5185)
- [ERC-4906：EIP-721 Metadata Update Extension](https://eips.ethereum.org/EIPS/eip-4906)
- [ERC-4519：Non-Fungible Tokens Tied to Physical Assets](https://eips.ethereum.org/EIPS/eip-4519)
- [ERC-3643：T-REX](https://eips.ethereum.org/EIPS/eip-3643)
- [ERC-8106：Compliance Events](https://eips.ethereum.org/EIPS/eip-8106)
- [ERC-7578：Physical Asset Redemption](https://eips.ethereum.org/EIPS/eip-7578)
- [ERC-7498：NFT Redeemables](https://eips.ethereum.org/EIPS/eip-7498)
- [ERC-7765：RWA NFT Privileges](https://eips.ethereum.org/EIPS/eip-7765)
- [ERC-7891：NFT Split and Merge](https://eips.ethereum.org/EIPS/eip-7891)
- [ERC-7929：Token-to-Token Binding](https://eips.ethereum.org/EIPS/eip-7929)
