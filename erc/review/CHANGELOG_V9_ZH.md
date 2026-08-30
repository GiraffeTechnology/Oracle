# V9 正式提交前收敛记录

日期：2026-08-29

## 一、本版最重大的改动：终局信任模型替换

V9 **不是 V6 的增量版本**。终局授权路径已从"指定 Authority 的签名"整体替换为"远端账本最终状态的成员证明"。任何仅阅读增量条目的人都可能误判本版性质，故单列于此。

| 项目 | V6 及以前 | V9 |
| --- | --- | --- |
| 提案标题 | Versioned Certificate Settlement Interface | **Proof-Verified Deferred Asset Settlement** |
| description | Atomically supersedes certificate commitments when deferred ERC-721 settlements finalize | **Atomically settles ERC-721 transfers from finalized remote-ledger state proofs** |
| 终局授权 | `certificateAuthority` 的 EIP-712 签名，经 ECDSA 或 ERC-1271 验证 | **远端最终状态的 Merkle 成员证明 + validator quorum finality** |
| 提交者信任 | 任何人可提交，有效性来自 Authority 签名 | **提交者不受信**；`msg.sender`、relayer 白名单、Authority 签名均不得决定证明有效性 |
| `requires` | 165, 712, 721, 1271 | **165, 721**（移除 EIP-712 与 ERC-1271） |
| `proofData` | 原名 `authorityData`，承载签名 | 承载 Profile 定义的不透明证明载荷 |

连带影响：

- 新增 `### Proof-verified finalization` 与 `### Proof encoding profile` 两节，规定验证器必须建立的六项前提、远端高度严格递增、证明消费去重，以及 CC0 参考 Profile 的编码（`RemoteFinality` / `RemoteSettlement` 域分隔类型）。
- Security Considerations 整节重写：明确"本 ERC 移除的是对提交者的信任，不是全部信任"，并列出 Profile 必须处理的 validator equivocation、quorum 唯一性、远端分叉、validator set 轮换、证明体积与 gas DoS 等事项。
- `certificateAuthority` 与 `authorityReference` 保留在接口与记录中，但语义降级为**纯信息性元数据**，不参与任何验证。
- 参考实现重写为真实验证器（域分隔 checkpoint、Merkle 成员验证、quorum 签名排序去重、`usedProofs` 去重、per-token `lastRemoteHeight` 单调）。
- prior art 重做，比较对象转向远端状态验证领域；可辩护新颖性收窄为"完整字段证明门控 + 原子 ERC-721 交割"这一组合不变量。

**未改变**：ABI、函数 selectors 与两个 ERC-165 interface ID `0xebaa86a0` / `0x2773d4c9`。`finalizeSettlement` 末位 bytes 参数仅改名，selector 不受影响。证书版本链、状态机、资产锚点绑定与取消路径沿用。

## 二、其余收敛项

- 作者改为主体名称加显式 GitHub 占位符，移除未经本轮确认的个人/账号。
- Motivation 增加登记、许可、仓储三个中性 illustrative 场景。
- 新增 certificate-conforming / settlement-conforming 两级规范性要求。
- 明确初始版本创建必须发出 `CertificateInitialized`。
- 固定未知 settlement 为 revert，`NONE` 不可作为成功未知查询结果。
- Rationale 增加 W3C Verifiable Credentials 与 Ethereum Attestation Service 对照。
- 保持用户原则：Authority MUST nonzero，MAY equal holder；独立背书链下核验。
- 合规性表述已按用户裁定全部移出规范正文；保留信任边界与 Privacy。
- 补充零 Authority、初始化事件、非 callback 合约收款方、未知 settlement 三类回归，套件由 36 增至 39 项。
- 重写 A1–E5 闭环、N/M 来源审计、prior-art、IPR/CC0 与提交清单，删除当前结论中的旧 Authority/EIP-712 语义。
- 新增 `erc-final-preflight.mjs`，固定官方 eipw 配置快照、公开资产一致性、占位符集合和提交边界。
- 官方 eipw v0.11.0 以 synthetic 占位符替换方式实跑，0 diagnostics，候选文件 before/after 哈希一致。

## 三、外部审计意见后的追加修订（同日）

- Prior art 增加 [ERC-5164](https://eips.ethereum.org/EIPS/eip-5164)（Cross-Chain Execution，Last Call）与 [ERC-7786](https://eips.ethereum.org/EIPS/eip-7786)（Cross-Chain Messaging Gateway，Final）的对照，说明消息网关传递的是被网关背书的消息、其接受与本地效果分属不同交易，因而不提供本提案要求的原子结算不变量。
- Rationale 增加 `certificateAuthority` 为何保留为强制接口的说明：它是可发现的元数据而非授权输入，certificate-conforming 实现仍需要一个稳定访问器，移除会改变已冻结的 `0xebaa86a0`，而终局路径完全忽略其返回值。
- 本节两处修订改动了 `ERCS/erc-xxxx.md`，因此第二节记录的 eipw 运行结果对应的是修订前字节状态，**提交前必须重跑 eipw 并更新 `EIPW_V0.11.0_RESULT.json` 与 `FILE_INDEX_SHA256.txt`**。

## 四、版本边界

V1–V8 文件和 ZIP 仅为历史证据，不得作为 V9 当前提交候选。V6 及以前版本采用的 Authority/EIP-712 终局语义已被本版取代，引用旧版结论时必须注明其适用范围。
