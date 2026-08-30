# ERC v2 新增反馈闭环记录（V9 提交前基线）

日期：2026-08-29  
权威输入：`ERC_V2_NEW_FEEDBACK_ZH.md`  
输入 SHA-256：`DBA5E0A7ECE69CD5F89B567FD010FFF04C127C546BE12888C89A59C0E2CB3037`

本记录逐项覆盖 A1–A3、B1–B2、C1–C4、D1、E1–E5。用户原则优先：`certificateAuthority` 仅 MUST nonzero，MAY equal holder；独立背书由消费者 out of band 核验。V8 已以 finalized remote-state proof 取代旧 Authority/EIP-712 授权，因此与旧授权模型有关的意见按“被新设计取代”处理，不伪造旧测试结论。

## 逐项结论

| 项 | 状态 | V9 规范、实现或测试证据 |
| --- | --- | --- |
| A1 Definitions | CLOSED | 英文规范定义 remote ledger、ledger identity、verification profile、proof submitter、settlement snapshot、remote settlement record、certificate commitment、authority reference、certificate authority、deadline。 |
| A2 `snapshotHash` | CLOSED | snapshot 是发起时非零承诺；Profile MUST 规定原像、canonicalization 与 domain separation；final proof 逐字段绑定该值。 |
| A3 finalization 锚点复检 | CLOSED / TESTED | 规范在 Proof-verified finalization 中要求重验资产锚点及 active state；测试覆盖 pending 后锚点失效的拒绝与可取消恢复。 |
| B1 Authority 可等于 holder | CLOSED BY USER PRINCIPLE / TESTED | 规范写明 MAY equal holder，且不得替代 remote-state proof；消费者链下决定是否信任。测试 `permits holder as certificate metadata authority` 为正向用例。 |
| B2 零 Authority | CLOSED / TESTED | `certificateAuthority` 对存在 Token MUST nonzero；参考实现 mint 拒绝零地址。 |
| C1 两接口强耦合 | CLOSED | 新增 certificate-conforming 与 settlement-conforming 两级。前者仅声明 `0xebaa86a0`；后者必须同时声明 `0xebaa86a0`、`0x2773d4c9` 并满足完整证明和原子性要求。 |
| C2 合约收款方 | CLOSED / DISCLOSED / TESTED | finalization 明确采用非 callback 转移；Backwards Compatibility 要求发起前处理不兼容合约接收者风险；测试固化非 ERC721Receiver 合约的当前行为。 |
| C3 中性命名 | CLOSED | 标题、接口和参考实现均去除 RWA 产品化命名；接口 ID 由 selectors 机械复算保持不变。旧 EIP-712 domain 已随 Authority 签名模型整体移除。 |
| C4 未知 settlement | CLOSED / TESTED | `settlement(unknownSettlementId)` MUST revert；无 pending 时返回零标识；`NONE` 不得作为未知查询的成功结果。 |
| D1 不存在的 ERC-1643 | CLOSED | 规范与现行 prior-art 不使用该编号或伪造状态；仅以“不属于 EIP 流程的行业文档管理接口”描述相关先例。 |
| E1 Authority == holder | PASS | 正向测试证明元数据 Authority 可与 holder 相同，同时 finalization 仍只依赖远端证明。 |
| E2 非 ERC721Receiver 合约 | PASS | 测试覆盖非 callback 交割并由规范披露风险。 |
| E3 ERC-1271 错 magic/revert | SUPERSEDED / NOT APPLICABLE | V8 不含 ERC-1271 或 Authority 签名路径；门禁明确拒绝 `IERC1271` 和旧 authorization typehash 残留。不得把旧 E3 测试冒充 V8 证据。 |
| E4 pending 后锚点停用 | PASS | finalization 拒绝，holder 空证明取消仍可执行，证书与 holder 不变量保持。 |
| E5 未知 settlementId | PASS | getter revert 与 no-pending 零值均有断言。 |

## 独立补强

- Motivation 已加入登记记录、许可记录和仓储记录三个中性 illustrative 场景，并明确不产生法律效力。
- Rationale 已加入 W3C Verifiable Credentials 与 Ethereum Attestation Service 的非 EIP prior-art 对照，差异限定为“完整字段证明绑定 + ERC-721 holder 变更原子性”。
- 初始证书记录创建 MUST emit `CertificateInitialized`，关闭历史遗漏。
- 当前参考实现套件为 39 项 proof-model 测试；旧 24/30/36 项快照仅属历史，不得作为当前证据。

## 发布边界

本闭环只证明提交前技术准备，不代表 Ethereum 社区接受、ERC 编号、法律效力或现实资产真实性。未经用户明确发布授权，不创建讨论帖、不提交 PR。
