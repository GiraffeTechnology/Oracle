# Proof-Verified Deferred Asset Settlement 现有技术与重复性审查

日期：2026-08-29  
状态：V9 提交前审查；非法律意见、非专利新颖性意见  
被审查规范：`ERC_SUBMISSION_CANDIDATE_EN.md`

## 1. 结论

未发现单一已发布 ERC 同时规定以下组合：

1. ERC-721 先进入可查询且锁定普通转移的 Pending；
2. 任意不受信 submitter 可提交远端最终状态证明；
3. membership leaf 必须绑定完整本地交割字段、前后承诺和资产锚点；
4. proof 消费、远端高度推进、证书承诺追加、ERC-721 holder 变更和 settlement 关闭在同一交易中原子完成。

组成部分本身已有大量先例。候选不得把轻客户端、Merkle proof、证书版本、资产锚点、延迟转移或 1:1 映射单独主张为新颖。可辩护的互操作空间仅是上述“完整字段证明门控 + 原子 ERC-721 交割”组合。

## 2. Ethereum ERC 对照

| 提案 | 2026-08-29 官方源状态 | 已覆盖 | 与本候选的关键差异 |
| --- | --- | --- | --- |
| ERC-2018 Clearable Token | Stagnant | clearing agent 控制的延迟清算状态机 | 不验证远端共识最终性或 membership，不绑定完整 ERC-721 交割 leaf。 |
| ERC-6997 ERC-721 with transaction validation step | Review | ERC-721 转移待验证后执行 | 不要求 finalized remote-state proof、逐字段 leaf、证书承诺追加或 per-token remote height。 |
| ERC-6358 Cross-Chain Token States Synchronization | Review | 签名 omniverse transaction 与多链状态同步 | 目标是多链 Token 状态，不是用特定远端资产记录证明门控一次本地 ERC-721 交割。 |
| ERC-6956 Asset-bound NFTs | Review | 资产绑定和 Oracle proof-of-control | 以 Oracle/物理控制证明驱动，不要求验证远端最终状态 membership；本候选明确不授权 Oracle 替代 proof。 |
| ERC-7943 uRWA | Final | transfer eligibility、冻结、强制转移等通用 RWA 控制面 | 不定义远端状态证明、证书替代链或 proof 与 holder 变更的原子耦合。可正交组合，不是依赖。 |
| ERC-8320 Regulated Asset Claim | Draft | regulated asset claim 表达 | 可成为远端记录字段，但不定义本候选交割不变量。 |
| ERC-8325 Asset Anchor Registry | Review | Token 与链下资产锚点及绑定历史 | 可作为 Profile 的 anchor 来源；不定义 proof-gated holder transition，且已从 `requires` 移除。 |
| ERC-8326 Canonical Document Bundle Anchor | Review | 文档包规范化和承诺 | 可供应 commitment，但不定义延迟 ERC-721 交割。 |

基础依赖仅为 Final 状态的 ERC-165 与 ERC-721。其余提案只作 Rationale 对照，不进入 `requires`，因此不会把当前 Draft 的状态上限错误地绑定到 Review/Stagnant 先例。

## 3. 非 ERC 先例

- IBC light clients 与 membership proofs、Hyperledger Cacti/Weaver 提供远端状态验证和互操作的一般模式。本候选不主张这些密码学或互操作原语。
- W3C Verifiable Credentials 与 Ethereum Attestation Service 等系统可表达签发者声明、状态或撤销。单独使用时，它们不要求把 finalized remote-ledger membership proof 与 Pending ERC-721 的全部字段绑定，也不要求证书替代和 `ownerOf` 变化在同一 EVM 交易中原子完成。
- EIP 流程外的 security-token document-management interfaces 可作为行业历史，但不得使用不存在的 `ERC-1643` 编号或赋予其 Final 状态。

## 4. 功能级重复性

| 候选要素 | 最近先例 | 判定 |
| --- | --- | --- |
| Pending 与普通转移锁 | ERC-6997、ERC-2018 | 高度相邻；不是独立创新。 |
| asset anchor | ERC-8325、ERC-6956 | 高度相邻；只作为完整 proof leaf 的绑定字段。 |
| certificate commitment/history | ERC-8326、VC/attestation systems | 数据表达相邻；不是独立创新。 |
| remote finality + membership | IBC/light-client systems | 基础原语既有；候选只定义 Profile 责任和 ERC-721 绑定。 |
| untrusted proof submitter | 通用 proof relay | 既有模式；关键是 submitter 身份不产生授权。 |
| full-field proof-gated atomic settlement | 未发现单一 ERC 覆盖 | 当前候选的最小差异空间。 |

## 5. 信任与采用边界

- `certificateAuthority` 仅为非零元数据，MAY equal holder。消费者如需“独立背书”，必须链下核验；本候选不声称链上证明组织独立性。
- certificate-conforming 与 settlement-conforming 分级，避免只需要版本历史的实现被迫实现 settlement。
- 合约收款方采用 non-callback 转移；风险已在 Backwards Compatibility 披露。
- 远端证明只证明字节处于被 Profile 接受的最终状态，不证明现实事实、资产存在或法律效力。

## 6. 来源快照与可复核性

以下文件取自 `ethereum/ERCs` 官方 `master` 源并保存在只读核验目录；状态以文件 frontmatter 为准：

| 文件 | SHA-256 |
| --- | --- |
| `erc-165.md` | `F431A42854927B82C309060D017C5BD4F61ABF8DC4679E466369E698A2D52396` |
| `erc-721.md` | `238787165C08AC748928FFAD57A24045802174BB38220AF9E7B63C44778B7372` |
| `erc-2018.md` | `926BF502E1B3F6C04BF6F01B2E0860FB20A6B7EBEB0991845B9D50FEBB95D8FC` |
| `erc-6358.md` | `A50DA52AD3DC92CC5A796A66DD81C014F72F8690F8126B72C063920811998532` |
| `erc-6956.md` | `1A158B5C6253A76FC6982382172DA2F8C22D1D00A570EC8AD6DAD7E01283D229` |
| `erc-6997.md` | `A9146D81495A5C53A9C7A474F6ABADF81FC42604C3FCFA958780D1FDA8CBA3D5` |
| `erc-7943.md` | `36ED5D2DB5F9675A5D6EFAF56B168D7BA6D561BAEA98A762E73BD82272A14642` |
| `erc-8320.md` | `9C7CDE0116C64781FB385834A72DF14059021CC6CA21446082705DD01788043A` |
| `erc-8325.md` | `F17B376805438E321D48C4474C5F1B851C78A0B71E8C26952705098DEE5FD129` |
| `erc-8326.md` | `B39F32513EE9E080EA0405667B1402E8DFDF92CC8457D1746A0A23D8B123689E` |

官方 `config/eipw.toml` 快照 SHA-256：`575E0CF5F4F93C924616E3E4AB0BA49B5910B0D78E95C333FAD043548A7A2357`。

## 7. 决策

当前范围可进入社区讨论准备阶段；不得扩大到通用资产锚定、合规框架、赎回、碎片化或“远端事实真实性”。查重结论不等于专利清查、Ethereum 编辑认可或标准编号分配。
