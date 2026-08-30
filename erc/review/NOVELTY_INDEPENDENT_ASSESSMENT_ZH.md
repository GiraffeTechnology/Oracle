# 新颖性与查重 —— 独立评估

日期：2026-08-29
评估人：外部审计（Claude），独立检索，不以起草方查重稿为依据
对象：`ERCS/erc-xxxx.md` 当前 proof 模型

## 一、结论

**V1–V6（authority／证书模型）确实不具备可辩护的新颖性。** 该判断成立，理由见第三节。

**V9（proof 模型）具备新颖性，但很窄，且此前的论证方式站不住。** 真正能守住的差异不是起草方所写的"完整字段证明门控 + 原子交割"这一笼统表述，而是两条可对照到具体条文的性质，见第四节。

**最大的问题是：提案此前没有引用最近邻 ERC-7965。** 漏引最近邻在 ERC 评审中比新颖性本身更致命 —— 它会被读成尽调不足。已补入正文。

## 二、检索范围

对 eips.ethereum.org 官方 ERC 索引做穷尽式标题扫描，覆盖 cross-chain / interoperability / bridge / message passing / state proof / storage proof / light client / 跨链 NFT / intents / settlement / escrow / atomic swap 全部命中项，逐一核对状态与范围：

| 提案 | 状态 | 是否构成重复 | 判定依据 |
| --- | --- | --- | --- |
| **ERC-7965** Proof-based Broadcast in ERC-7786 Gateways | Draft | **最近邻，不重复** | 见第四节 |
| ERC-7786 Cross-Chain Messaging Gateway | Final | 否 | 消息经网关背书；接受与本地效果分属不同交易 |
| ERC-5164 Cross-Chain Execution | Last Call | 否 | 同上，执行层非证明消费层 |
| ERC-7841 Cross-chain Message Format and Mailbox | Draft | 否 | 明文规定"消息在目的链消费时无需携带源链证明"，验证移交结算层 |
| ERC-7802 Token With Mint/Burn Access Across Chains | Draft | 否 | 仅同质化代币；不涉及远端状态证明 |
| ERC-7683 Cross Chain Intents | Draft | 否 | 意图撮合与填充，不定义状态证明消费 |
| ERC-6358 Cross-Chain Token States Synchronization | Review | 否 | 目标是多链全局 Token 状态 |
| ERC-3668 CCIP Read / ERC-7700 / ERC-7412 | Final/Draft | 否 | 链下数据取回，非最终状态成员证明 |
| ERC-6997 / ERC-2018 / ERC-1996 | Review/Stagnant | 否 | 本地待验证转移或 notary 托管，无远端证明 |
| ERC-6956 Asset-bound NFTs | Review | 否 | Oracle 物理控制证明，明确授权 Oracle |
| ERC-7943 uRWA | Final | 否 | 转让资格与冻结控制面，可正交组合 |

链外先例：**ICS-721**（IBC 跨链 NFT 转移，轻客户端 + Merkle 成员证明）、Hyperledger Cacti/Weaver、W3C Verifiable Credentials status list、Ethereum Attestation Service。

## 三、为什么 V1–V6 不具备新颖性

当时的主张是"权威证书版本链 + 与持有人变更原子耦合"。逐层拆开，每一层都有既有实现：

1. 逐 Token 挂权威文档哈希 —— ERC-1400 家族的文档管理接口（链外事实标准）早已如此；
2. 版本链与 supersession —— 追加式记录是通用数据结构，不构成协议贡献；
3. 待终局的延迟转移 + notary 授权 + 到期取消 —— ERC-1996 的 hold/execute/release + expiration，ERC-2018 的 clearing agent，形态几乎相同，只是对象从同质化代币换成 ERC-721；
4. EIP-712 签名授权 —— 通用机制。

剩下唯一新的只有"证书版本递增与 `ownerOf` 变更在同一笔交易内成立"。这是一条不变量，不是一个接口贡献；把它作为一份新标准的全部理由，在 Magicians 上守不住。**用户的判断正确。**

## 四、V9 为什么成立，以及必须怎样论证

最近邻是 **ERC-7965**。它标准化了在 ERC-7786 网关内以密码学证明验证源链消息，使目的链合约可以依据"消息存在于已最终化的源链状态"而非验证人背书来执行。这与本提案的证明模型属于同一族。

但 ERC-7965 自身文本留下的两点空白，恰是本提案强制的两点：

1. **不绑定目的地上下文。** 广播语义要求一份证明服务多个接收方，因此它不把证明绑定到特定目的链、合约或字段集合，由接收方各自决定执行策略。本提案要求被证明的远端记录绑定**一笔特定本地交割的全部 13 个字段**，包含 `block.chainid` 与合约地址。
2. **不约束验证与执行的关系。** 二者是可分离的步骤。本提案要求验证、证书替代、ERC-721 持有人变更在**同一笔交易内同时成立或整体回滚**。

这两条是可以指着对方条文说清楚的差异，比"完整字段证明门控"这种自述强得多。

另有一条结构性差异，应当放在论证最前面：**Token 不离开本链。** 桥（ICS-721、ERC-7802、各类 ONFT）托管、销毁或铸造一个表示物，使代币在链间移动；本提案中 ERC-721 始终停留在发行链上，远端证明只授权一次**本地**持有人变更。这不是同一种原语。

## 五、仍然存在的风险（不回避）

评审仍可能主张："这是 ERC-7965 加 ERC-6997 的应用，不是新标准。"

有效的反驳只有一条：**该不变量无法由组合得到** —— 任何传输层标准都无法要求目的链的状态转换与验证在同一笔交易内原子成立，因为传输层的职责在消息送达即终止。这句话必须写在文档里，不能只存在于讨论中。当前 Rationale 已具备该论证的要素，但建议在讨论帖首帖中明确提出。

次级风险：本提案的可辩护范围比 V1–V6 时期更窄。任何把资产锚定、证书版本、冻结、赎回重新主张为新颖的表述，都会削弱主张。当前正文没有此类表述，应保持。

## 六、本次已执行的修改

1. Prior art 补入 ERC-7965 段落，明确其为最近邻并逐条说明差异；
2. 泛指的"IBC light clients"改为点名 **ICS-721**；
3. 加入"Token 不离开本链"的结构性区别；
4. eipw 语料补入 `eip-7965.md`，官方 lint 复跑 0 诊断。
