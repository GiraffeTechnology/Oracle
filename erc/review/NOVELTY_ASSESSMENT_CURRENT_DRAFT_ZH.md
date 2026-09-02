# 查重与新颖性 —— 针对**现行**提案稿

日期:2026-09-02
对象:`ERCS/erc-xxxx.md`(重写后,标题 *Asynchronous Register Projection for NFTs*)
方法:逐个抓取官方原文核对,不依赖记忆、不依赖二手转述。所有编号均已用 HTTP 状态码验证存在性。

> **为什么要重做。** `NOVELTY_INDEPENDENT_ASSESSMENT_ZH.md` 评估的是 V1–V9(*Proof-Verified Deferred Asset Settlement*),那份提案的主张是"用远端证明作为转移的唯一授权"。现行提案的主张**完全不同**:构造一条可按时间解析的投影,使任何过去瞬间恰好解析出一个确认持有人,并给出该答案何时不再变的判据。**旧结论不能沿用。**

## 一、现行主张(查重的靶子)

1. 条目只增、`effectiveAt` 严格递增、record commitment 在代币内唯一 → **任何过去瞬间恰好一个确认持有人**;
2. 该答案**是否还会变**可由一次比较判定(`isFinalAsOf`);
3. 此刻是否**正在被争议**可读(缺口及其 `openedAt`);
4. 三者与 `ownerOf` 刻意分离,交易全程不阻断;
5. 条目仅凭远端终局状态的成员证明准入,提交者不可信;
6. 登记册内容不上链,链上只带承诺与引用。

## 二、最近邻:ERC-5805 + ERC-6372(**本次新发现,此前从未核查**)

这是投影侧最接近的既有工作,**先前几版查重都漏了它**。评审人一定会问"这不就是 `getPastVotes` 吗"。

| | ERC-5805 | 本提案 |
| --- | --- | --- |
| 状态 | **Stagnant** | Draft |
| 查询 | `getPastVotes(account, timepoint)` | `holderAsOf(tokenId, instant)` |
| 过去值可变吗 | **明确要求不可变** | **可变,直到终局** |
| 时钟 | 合约自身的时钟(ERC-6372 `clock()` / `CLOCK_MODE()`) | **登记册的**时刻,声明为与 `block.timestamp` 同尺度 |
| 真值来源 | 链本身 | 链**不控制**的外部登记册 |

ERC-5805 原文:

> "For any integer that is strictly smaller than the current clock, the value returned by `getPastVotes` **SHOULD be constant**... This function SHOULD only serve past checkpoints, which **SHOULD be immutable**."

**它能这么要求,是因为 checkpoint 由链自己写,链就是真值来源,不存在"后写的条目落在先写的之前"。** 本提案投影的是链不控制的登记册,条目在其生效时刻**之后**才到达,因此过去瞬间的答案在被后续条目闭合前是临时的。

**这恰好是新颖性所在:终局性在 ERC-5805 里是空洞的(过去永远不变,无需判定),在这里是必须的、且可由不变量 3 一次比较判定。** ERC-6372 标准化的是合约声明**自己**的时钟;这里的时刻是**登记册**的,声明同尺度才使二者可比。

已写入正文 Prior art。

## 三、其余核对结果

| 提案 | 状态 | 核对结论 |
| --- | --- | --- |
| ERC-7965(+7786) | Draft / Final | 证明侧最近邻。广播语义要求一份证明服务多接收方,故**刻意不**把证明绑定到目的链字段集合,也不约束验证与执行的关系。证明一条消息,不构造可解析的登记历史 |
| ERC-3643 (T-REX) | **Final** | RWA 旗舰。身份注册表**完全在链上**,校验的是资格;**不保存任何时间索引的持有历史**,不建模链下/链上之间的待定区间 |
| ERC-6065 (Real Estate) | Review | 用途最贴近(不动产 + 链下法律记录)。以哈希承诺经营协议,但**明文要求"a trusted party tasked with ensuring the state of the on-chain property NFT accurately mirrors its physical counterpart"**,且不建模滞后与待定状态。**这正是本提案要用可核验机制替换掉的那种安排** |
| ERC-8106 (RWA 事件合规) | Draft, 2025-12 | 转移当时发事件;**不记录历史链、不支持过去时点查询、无终局概念** |
| ERC-7943 (uRWA) | Review | 转移资格与冻结控制,与本提案组合使用,不重叠 |
| ERC-6997 / 5164 / 6358 | Review / Last Call / Review | 转移前置校验、跨链执行、多链代币状态;均不维护"谁在何时被确认"的可解析记录 |
| ERC-7765 / 5496 | Draft / Last Call | 权利可否行使、权利与所有权分离;不把可行使性绑到外部登记册状态,也不能问过去瞬间的确认持有人 |
| ERC-4799 | Review | NFT 所有权指派层;当前所有权的重新表达,无时间索引 |
| ICS-721 及 xERC721 类 | 非 EIP | 桥:托管/销毁/铸造表示物使代币跨链移动。这里代币不离开发行链,不铸造任何东西 |

## 四、一个必须记下的陷阱:ERC-1400 家族不是 EIP

用 HTTP 状态码逐个验证:

```
eips.ethereum.org/EIPS/eip-1400  → 404
eips.ethereum.org/EIPS/eip-1594  → 404
eips.ethereum.org/EIPS/eip-1410  → 404
eips.ethereum.org/EIPS/eip-1643  → 404
```

**四个全部不存在。** 它们是在 EIP 流程之外发布的证券代币标准,大量二手资料把它们当作 ERC 引用。本项目此前就把 ERC-1643 误当作 "Final" 写进过 prior-art 表,已修正。**任何人再想引用这一族,先跑上面这条命令。**

## 五、新颖性结论

**成立,且比 V1–V9 清楚得多。**

V1–V9 的主张(证明绑定 + 原子性)可以被质疑为 ERC-7965 与 ERC-6997 的组合应用。现行主张不能:

> 已有工作要么**假设链是真值来源**因而过去不可变(ERC-5805),要么**信任一个操作方**去维持镜像(ERC-6065、ERC-3643),要么**只证明一条消息**而不构造历史(ERC-7965)。**没有任何一个提案在"链不控制登记册、条目迟到、过去答案可被追改"的前提下,给出一个可解析且可判定终局的持有记录。**

这一条不是组合能得到的:ERC-5805 的不可变性要求与本提案的前提**直接冲突**,不是可以叠加的两块。

## 六、提交流程上的一处硬约束(已实测)

引入 ERC-5805 的相对链接后,`markdown-link-status` 会按状态层级设上限。实测(eipw 0.11.0,官方 config):

| 本提案 status | 结果 |
| --- | --- |
| Draft | **退出码 0,零诊断** |
| Review | 退出码 65,4 条诊断 |
| Last Call | 退出码 65,9 条 |
| Final | 退出码 65,11 条 |

升到 Review 时挡路的被引提案有三个:`eip-5805`(Stagnant)、`eip-7965`(Draft)、`eip-7765`(Draft)。

**不影响以 Draft 提交**,这是提案将来推进状态时才需要处理的事:届时把这三处相对链接改为不带 `./eip-N.md` 的散文引用即可(ERC 常见做法),或等被引提案自身状态推进。**现在记下来,免得那时才发现。**
