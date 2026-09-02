# 评审视角全面审查 —— 重写后的提案稿

日期:2026-09-02
审查对象:`ERCS/erc-xxxx.md`(sha256 `c1e7b635…`)、`assets/eip-xxxx/`
姿态:假设我是 ERC 编辑 + 一名想把这个提案打回去的独立评审人。所有结论都在正文或实现里核实过,给出行号。

## 结论先行

**不建议在修掉 BLOCKER-1 之前提交。** 不是因为它不成立,而是因为它会在讨论帖第一天被人抓住,而且抓住的方式最难看:**正文自己给出的理由是假的**。

| 编号 | 问题 | 级别 |
| --- | --- | --- |
| BLOCKER-1 | 谁持有代币,谁就能无限期把该代币钉在"被争议"状态。而 Rationale 声称被争议"有界、事前可见、可规避"—— **三条在对抗情形下全不成立**,且其中"有界"与已接受的 H-5 行为直接矛盾 | 阻断 |
| MAJOR-2 | **全文没有定义时间基准**。`effectiveAt`/`instant`/`deadline`/`openedAt` 都是无单位 `uint64`;而"被争议"要拿 `openedAt`(链上时间)去比 `instant`(登记册时间)—— **两个时钟直接比大小** | 重大 |
| MAJOR-3 | `registryReference` **从未被定义**,只出现在结构体和函数签名里,却是被证明绑定的叶字段 | 重大 |
| MAJOR-4 | `supersededAt` 只说"要设",**没说设成什么值**。两个合规实现会给出不同的可观测状态 | 重大 |
| MINOR-5 | 从未说明投影是否必须与 ERC-721 是同一个合约 | 中 |
| MINOR-6 | `openedAt` 语义未定义,而它是判定"被争议"的唯一依据 | 中 |
| MINOR-7 | `effectiveAt` 无上界。一条极远未来的条目会**永久锁死**该代币的投影 | 中 |
| EDITORIAL-8 | `entryCount` 全文无散文说明;Test Cases 用 MUST 措辞 | 编辑 |

---

## BLOCKER-1:被争议状态可被任意持有人无限期维持

### 事实链(逐条核实)

1. 普通转让**永不阻断**(正文 "Trading is not blocked" 一节)。任何人可在公开市场买到该代币。
2. `beginSettlement` 的授权是**"an authorized ERC-721 caller"**(正文 L177);实现即 `_isAuthorized(msg.sender, tokenId)` = owner / approved / operator(`RegisterProjectionReference.sol` L239)。
3. 已有缺口时开新结算 **MUST 顶替**旧的(正文 L181)。
4. `finalizeSettlement` 要求结算处于 `OPEN`;被顶替者变为 `SUPERSEDED`,**其证明永久作废**。而叶绑定了 `settlementId`,所以远端必须就新 id 重新出证。
5. H-5 已裁定接受"发起方自选 deadline 且顶替重开计时"。

**合起来**:买下代币 → 反复顶替 → 该代币**永远有一个打开的缺口**。

### 后果

- 该代币的任何瞬间**永远处于被争议**。按正文的指引,不可回补权利(投票、发起提案)应被拒绝 —— **等于永久压制该代币的治理权**。
- 登记册即使已经出证,也永远无法把变更记进投影:每次证明产出前,攻击者再顶替一次即可。
- 攻击成本 = 买入代币的价格,且事后可以卖掉。**不需要任何特权。**

### 为什么这是阻断级,而不是"已知局限"

正文 L265 写着:

> Contestedness is the condition that fits: it is **bounded, visible before a ballot is scheduled into it, and avoidable**.

**三条在对抗情形下全部为假:**

| 声称 | 实际 |
| --- | --- |
| bounded(有界) | 单个缺口有界,**累计无界** —— 这正是 H-5 关闭时明确接受的行为。**正文与已接受的行为直接矛盾** |
| visible before a ballot is scheduled(投票排定前可见) | 缺口可以在投票**排定之后、进行之中**才开 |
| avoidable(可规避) | 能开缺口的人和办投票的人不是同一方。被攻击者无从规避 |

而 Security Considerations 只披露了**登记册不出条目**这一种活性依赖(L13 起),**从未提及有对手主动维持缺口**。这不是"已披露的局限",是**缺失的威胁模型**。

### 更深一层:`ownerOf` 该不该管登记更新?

本提案最核心的立场是**把可交易头寸与确认记录分开**。但 `beginSettlement` 的授权又完全绑回 `ownerOf` —— **在最关键的一处把两者又合上了**。谁买到代币,谁就掌握登记册变更能否被记录。这在设计上是自相矛盾的,评审人会直接问这一句。

### 可选处置(供作者裁定,我没有擅自改)

1. **限制顶替**:同一代币在前一个缺口的 deadline 到期前不得顶替;或顶替须由**同一发起方**发起。成本最低,不动接口。
2. **把开缺口的权限与 `ownerOf` 解耦**:交给一个 Profile 指定的角色。语义最正确,但要改接口与 ID。
3. **维持现状,如实披露**:删掉 L265 那三个形容词,在 Security Considerations 写明该向量。**最低限度必须做这一条** —— 留着一句可被证伪的断言比承认局限糟得多。

---

## MAJOR-2:没有时间基准

`Unix`、`epoch`、`seconds`、`block.timestamp` 在正文中出现 **0 次**(已 grep 核实)。

而:

- `effectiveAt` 是**登记册**的生效时刻(定义节:"identified by its effective time");
- `deadline` 在实现中与 `block.timestamp` 直接比较;
- **被争议**的判定要拿 `openedAt`(链上时间)与 `instant`(登记册时刻)比大小(L165、L322)。

**两个时钟被直接比较,而正文从未说它们同基准。** 一个第二实现者完全可以让 `effectiveAt` 用登记册自己的序号或本地时区时间,结果仍然"合规",但与他人不可互操作。

修法很短:在 Definitions 加一句,所有 `uint64` 时刻均为自 Unix 纪元起的秒数,与 `block.timestamp` 同基准。**不新增 MUST 也可以说清。**

## MAJOR-3:`registryReference` 从未定义

全文只出现两次:结构体字段(L101)与 `finalizeSettlement` 签名(L233)。**没有任何一句说它是什么、能否为零、承诺了什么。**

而它是**被证明绑定的叶字段**之一 —— 参考实现把它写进 `REMOTE_ENTRY_LEAF_TYPEHASH`。也就是说:它的含义直接影响远端如何构造叶,而互操作恰恰依赖这一点。

对照 `recordCommitment` 有完整定义("a nonzero `bytes32` commitment to the register's content at that entry. An implementation profile MUST define its algorithm, canonicalization and domain separation."),`registryReference` 什么都没有。这是明显的遗漏,不是刻意留白。

## MAJOR-4:`supersededAt` 的值未指定

不变量 2(L71)只说 "set the prior entry's `supersededAt`",**没说设成什么**。

参考实现设为新条目的 `effectiveAt`(L428)。另一个实现者完全可能设为 `block.timestamp` —— 两者在有登记滞后时**必然不同**,而且通过 `entryAt` **可观测**。

两个都"合规"的实现,对同一段历史给出不同的可观测状态。这是互操作缺陷,不是风格差异。

## MINOR-5:投影与 ERC-721 的关系未言明

接口只带 `tokenId`,**不带代币合约地址**;`beginSettlement` 要求 "an authorized ERC-721 caller"。这隐含投影必须实现在 ERC-721 合约自身之上,但**正文从未说**。若有人把投影做成独立合约,接口无法使用。一句话的事。

## MINOR-6:`openedAt` 语义未定义

它是判定"被争议"的唯一依据,却只作为结构体字段出现(L209)。未说明它是 `beginSettlement` 时的区块时间戳。与 MAJOR-2 同源,一并修。

## MINOR-7:`effectiveAt` 无上界

实现只有下界检查(L388),正文亦无上界要求。一条 `effectiveAt` 接近 `2^64-1` 的条目被准入后,**此后任何条目都不可能满足严格递增** —— 该代币的投影**永久锁死**。

需要证明方出证才能触发,所以严重度不高(证明方失守本就全盘失守);但它是**不可恢复**的,而且正文对不可恢复状态一字未提。建议在 Security Considerations 加一句,或由 Profile 约定上界。

## EDITORIAL-8

- `entryCount` 只出现在接口块中,全文无一句散文说明它返回什么、边界如何。其余每个访问器都有。
- Test Cases 用 "Conforming implementations MUST satisfy at least the following" —— 部分 ERC 编辑不接受把测试用例写成规范性要求。属可争论项,不影响 lint。

---

## 我确认没有问题的部分

为免显得只挑毛病,以下是我实际去查、认为站得住的:

- **终局判据**在数学上正确,且由不变量 3 直接推出;边界(首条之前、最新条目处)在测试中逐一断言。
- **证明路径**:叶绑定 11 个字段,逐字段篡改均被拒(测试 "rejects mutation of every bound leaf field",且该用例本身此前的空断言缺陷已修);低 s 值、签名者严格递增去重、高度回退、重放均有覆盖。
- **静默(quiescent)** 的论证成立:条目只能经打开的缺口进入,故无缺口区间投影不能推进 —— 有专门测试覆盖 absent / admitted / cancelled / superseded 四态。
- **不代替 oracle** 的表述是诚实的,且在 Abstract、Motivation、Rationale、Security 四处一致。
- **范围克制**(ADR-009)执行到位:权利小节只剩 2 条 MUST,没有替 DAO 定规则。
- **eipw**、测试、包校验四道闸门可复现,且有负向对照证明 lint 生效。

## 提交建议

1. **必须做**:BLOCKER-1 的第 3 项(如实披露)—— 删掉 L265 那三个可被证伪的形容词,并在 Security Considerations 写明对抗性顶替向量。**这是提交前的最低门槛。**
2. **强烈建议**:MAJOR-2、3、4 一并修。三处都是**遗漏**而非取舍,改动都很短,且都会被第二实现者踩到。
3. **建议**:BLOCKER-1 的第 1 项(限制顶替)。不动接口即可大幅削弱该向量。
4. MINOR-5/6/7、EDITORIAL-8 可与上述同批处理,单独不值得一轮。

---

# 处置记录(2026-09-02,与作者讨论后)

## BLOCKER-1 撤回

原判定"任何持有人可把代币永久钉在被争议状态 → 永久压制治理"**主体上就错了**。要顶替缺口必须是 `ownerOf`,即攻击者自己持有该代币;而持有不等于可行使——须先在 DAO 登记。攻击者钉住自己的代币,结果是自己登记不上、按弃权处理。**自伤,不是攻击。**

递延债权那一支也不成立:分红是**被动、可回溯**的权利。持有人主张未被计入 → DAO 核实 → 补记;超期未分配归 DAO。这条路不经过投影的终局性,冻不住。

## 本次审查自身走偏了,一并记下

作者指出:**标准只做两件事——链上链下的映射,以及解释为什么会有 pending 状态。** 本审查中关于"谁有权投票""登记何时失效""受益人如何认定"的追问,属于 DAO 治理,与提案无关。相关讨论移入 issue #15 备查,不进正文。

我还有一处方向性错误:我把"链上没有身份证,`holderAsOf` 只返回地址"列为局限。**恰恰相反,那正是本标准要解决的问题** —— 身份在链下登记册里,`recordCommitment` 与 `registryReference` 指向的就是那条记录,**链上携带的是引用,不是身份**。已按此改写 registry reference 的定义,原"局限"条目作废。

## 实际落入正文的修改

只保留与映射、与 pending 有关的部分:

| 原编号 | 处置 |
| --- | --- |
| BLOCKER-1 | 撤回。但顶替确实会让投影停止跟踪登记册 —— 作为**活性**事项写入 Security Considerations,并对无法约束它的 Profile 给出 SHOULD |
| MAJOR-2 时间基准 | 已补。明确所有瞬间为 Unix 纪元秒,与 `block.timestamp` 同尺度;并点明"被争议"的定义依赖于此 |
| MAJOR-3 `registryReference` | 已补,且按上述纠正写成"指向登记册自身记录的定位符,身份在那里" |
| MAJOR-4 `supersededAt` | 已定死为新条目的 `effectiveAt`,并说明区间由登记册闭合而非由链知悉的时刻闭合;Test Case 9 同步 |
| MINOR-5 与 ERC-721 的关系 | 已言明:接口由 ERC-721 合约自身实现 |
| MINOR-6 `openedAt` | 已定义为 `beginSettlement` 成功时的区块时间戳 |
| MINOR-7 `effectiveAt` 上界 | 已在 Security Considerations 说明极远未来的生效时刻会永久终结该代币的投影 |
| Rationale 指引段 | **改写而非删除**。原文在教 DAO 怎么设计权利(越界),但整段删掉是另一个极端 —— 不讲清楚就没人知道这标准有什么用。现改为解释**为什么暴露三个事实而不是一个**,不再给任何建议;两处不实陈述(`bounded`、`at a cost of time alone`)一并删除 |
| 地址 ≠ 持久身份 | **作废**,理由见上 |
| "接口够用"的正面结论 | 不进正文(属 DAO 流程论证),移入 issue #15 |

## 仍然成立、未被撤回的

`bounded` 是假的——这与谁是攻击者无关,与 H-5 已接受的行为直接矛盾。已删除。

---

# 范围清理(2026-09-02)

作者:"导致一直漂移和加入大量与初衷无关的事项。请把无关事项清除。"

尺子只有一条:**标准做链上链下的映射,并解释为什么会有 pending 状态。** 不符合的,不论写得多好,都不属于这里。

## 从规范正文删除

| 内容 | 来源 | 为什么无关 |
| --- | --- | --- |
| Rationale 三段:董事会外生于名册、DAO 可投票造出静默区间、构成封闭的那次投票无从保护(无底递归) | HKEX 审计 + DAO 治理讨论 | 讲的是治理权威如何构成,不是映射 |
| Rationale 两段:Profile 应钉住确定性程序、确定性让配额分歧有意义 | AI oracle 讨论 | 证明方质量建议,属 Profile 选型 |
| 定义 `quiescent` 及其命名用法 | 为支撑"DAO 造封闭期"而引入 | 术语只服务于那个论证。其下的机械事实(条目只能经打开的缺口进入)**保留**,只是不再命名、不再附带"授权方可以主动不开缺口"的操作建议 |
| Rights 段尾"合约可以在终局后把受益人绑到 `holderAsOf`" | 递延登记表讨论的残留 | 在教实现者怎么做递延 |
| Rationale 范围段里"issuer、DAO、权利合约"的枚举 | 同上 | 枚举把治理主体拉回正文 |

删除后修掉一处断链:第 7 段原本以 "does not need **this rule**" 承接被删的"被争议规则"那段,指代已断,改为 "does not expose any of this"。

## 同步清理

- Magicians 首帖:同源的治理三段与证明方质量段删除(1867 → 1529 字)
- 测试注释:去掉"这正是关闭登记册买到的东西"
- 操作单:删去"为什么不像 HKEX 那样设封闭期"一问(属治理)
- 治理内容已在 issue #15 备查,不丢失

## 结果

| | 清理前 | 清理后 |
| --- | --- | --- |
| 正文字数 | 5597 | 5044 |
| Rationale 段数 | 14 | 11 |
| Specification MUST | 27 | 26 |
| 接口 / ID | 2 个 | **未动** |

剩下的 11 段 Rationale,逐段都能对上"映射"或"为什么会有 pending":投影而非证明是贡献所在、两种所有权刻意分开、终局与解析是两个问题、登记册与 Profile 身份、范围边界、为何暴露三个事实而非一个、传统基础设施用除权日补偿而本标准如实记录、同持有人条目为何不是 no-op、证明提交者不可信、不代替 oracle、约束验证而非证明。
