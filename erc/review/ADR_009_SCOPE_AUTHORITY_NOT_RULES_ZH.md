# ADR-009　标准的边界:厘清权力,而非替用户定规则

日期:2026-08-31
状态:**已采纳**
来源:作者原则

> 我的原则是能不加的尽量不加。标准不是定规则(规则由用户/DAO 来定),标准的目的是厘清谁有定规则的权力。

## 判据

对规范正文的每一条 MUST 问一句:**它是在说"谁有权力/事实是什么",还是在说"你必须怎么做"?** 后者删。

## 审查结果

### 保留(权力归属与机制事实)

- 投影不变量(只增、`effectiveAt` 严格递增、代币内承诺唯一)—— 它们使"某瞬间的确认持有人是谁"这个问题**有答案**;
- `entryAsOf` / `holderAsOf` / `isFinalAsOf` / `openGapOf` 的语义 —— 回答问题;
- 交易不被阻断、不得从 `ownerOf` 推断确认持有人 —— **两种所有权的权力分离**;
- `registerId` / `registerDescriptor` / `verificationProfile` —— 登记册与 Profile 的身份;
- 结算机制:谁可开缺口(ERC-721 授权方)、谁可准入(**任何人**,凭证明)、谁可取消(发起方,且须过 deadline)—— 这是全文**权力分配的核心**;
- Profile 必须定义承诺算法与验证规则 —— 把权力**指派**给 Profile。

### 删除(替用户定规则)

原"Exercising a right against the projection"小节里的三段规范条款:

| 被删条款 | 为什么它是定规则 |
| --- | --- |
| 可回补权利 MUST NOT 被视为消灭、MUST 递延、MUST 补记给该瞬间确认持有人 | 分红要不要递延、递延给谁,是权利条款自己的事 |
| 不可回补权利 MUST NOT 以终局为闸门、MUST 按行使当时评估、实现 MUST 记录所依据的条目版本 | 对消费方合约的行为要求,标准无从强制,也不该规定 |
| 不可回补权利 MUST 在被争议时拒绝、就该瞬间永久消灭、MUST NOT 复活 | 弃权 / 归前手 / 顺延,都是合理选择,标准不该替 DAO 挑一个 |

该小节的 MUST 从 6 条降到 2 条,全规范从 34 条降到 30 条。**接口未动**,三个 ID 保持不变。

### 改写而非删除

"后续准入 MUST NOT 追溯撤销已完成的行使" → "An entry admitted after an exercise has completed carries no authority over that exercise."

这不是对消费方的要求,而是**对本标准自身权力范围的声明**:本标准规定登记册的答案何时改变,不赋予新答案推翻旧答案下已完成行为的权力。这正属于"厘清谁有权力"。

### 降为指引

可回补/不可回补的分类没有丢,移入 Rationale 并明确标注 "This is guidance, not a requirement"。它是有价值的分析,但它是**建议**,不是**规则**。

## 仍在标准内、且本原则会质疑的一项

`IDeferredEntitlement`(`0x6d39b0a8`)。

作者曾明确裁定"入标准"(2026-08-30)。按本原则重新审视:

**支持保留**:它记录的是**归属**——"该瞬间的权利人是谁",由登记册决定而非任何人裁量,且一次绑定后不可变。这是权力事实,不是政策。它不决定权利是否该递延、值多少、谁来付。

**支持删除**:`holderAsOf` + `isFinalAsOf` 已经让消费方合约自己完成同样的绑定。该接口提供的是**便利与统一**,不是**能力**。按"能不加的尽量不加",便利不足以构成加的理由。

**未擅自删除**,因为这是作者已作出的明确裁定。留待作者复核。

## 后续检查规则

今后任何新增条款,先过这一关:它是在说"谁有权力"还是"你必须怎么做"。后者不进正文,至多进 Rationale 作为指引。

---

## 补记(2026-08-31):另一条边界 —— 标准不能代替 oracle

作者:

> 标准不能代替 oracle,因为有的数据天生不适合直接上链。

### 我写错的地方

Motivation 原文把 oracle 列为本标准要摆脱的"两条不令人满意的路径"之一:

> They trust an oracle to assert that registration finished, in which case the contract proves only what the oracle said.

**站不住。** 任何不是自带共识的登记册 —— 股份过户登记处、土地注册处、托管方账簿 —— 都没有状态根、没有终局性、没有验证人集合。必须有人对其内容作出承诺,而那个人就是 oracle。本标准的证明路径验证的是**它签过的话**,不是世界。

而且这不是缺陷,是前提:登记册的内容常常**本就不能上链** —— 涉密、涉及个人、或根本不是登记方有权披露的。所以条目里放的从来是 commitment 与 reference,不是记录本身。机制一直是对的,是叙述过头了。

Security Considerations 里那句一直是诚实的("A proof … does not establish that an asset exists, that a registrar told the truth"),但它被埋在最后,而 Motivation 在开头给了相反的印象。

### 改成什么

- **Motivation**:明说 "this ERC does not remove that party" —— 无法移除,也不试图移除;能移除的是**那个角色平时享有的宽容度**。
- **Rationale**:新增一段说清"变的不是谁被信任,而是这份信任允许什么":陈述进入每代币唯一的只增序列,两条不能共享同一生效时刻,任何一条不能复用,任何过去瞬间可被事后重新检视。**自相矛盾的来源会把矛盾留在记录上,而不是覆盖掉**,且与登记方毫无关系的第三方看得见。
- **Security Considerations**:点名 —— 该方"is an oracle in the ordinary sense, its honesty is assumed rather than proven",且识别它是 Profile 的一部分。
- **Abstract**:加一句 "The register's contents stay off chain; only commitments and references reach it."
- **参考实现文件头**:原文写 "Production profiles SHOULD use the remote register's native light client",隐含假设登记册有共识。已改:很多登记册没有,此时文件里的验证人集合**根本不是共识,而是一个证明配额(an attestation quorum - an oracle)**,证明确立的是该配额承诺了什么,而非登记册确实那么说。Profile MUST 披露验证器、**证明方**与升级权限。

### 与 ADR-009 主体的关系

同一条边界的另一条边:

| | 标准不做 | 标准做 |
| --- | --- | --- |
| 对用户/DAO | 不定规则 | 厘清谁有权定规则 |
| 对 oracle | 不代替它,不证明它诚实 | 固定它是谁、说过什么、什么时候说的 |

两者是同一个立场:**标准确立权力与事实的归属,不替任何一方作判断。**

### 规范负担

规范正文的 MUST 数**未增加**(仍为 30 条)。本轮全部是更正与说明,没有新增条款。参考实现只改注释,已验证运行时字节码逐字节一致(剥离 metadata 后 10742 字节)。

---

## 决议(2026-08-31):`IDeferredEntitlement` 删除

作者裁定:**删。**

本 ADR 主体把该接口列为"仍在标准内、且本原则会质疑的一项",并给出两面理由。作者采纳删除一面。

### 删除依据

`holderAsOf` + `isFinalAsOf` 已经让欠付方合约自行完成完全相同的绑定:等到 `isFinalAsOf` 为真,取 `holderAsOf`,记下来。该接口提供的是**便利与统一,不是能力**。按"能不加的尽量不加",便利不构成加的理由。

更重要的一条:它**替所有人挑了一种政策** —— "递延项以三元组为键、不绑定地址、终局后绑定"。这是一种合理设计,但不是唯一合理设计,而按 ADR-009,挑选哪一种不是标准该做的事。

### 删除范围

| 位置 | 处理 |
| --- | --- |
| `ERCS/erc-xxxx.md` | 删除 "Deferred entitlement interface" 整节;删除 entitlement conformance 一级;删除 Rationale 中"登记表为何应入标准"一段;删除 Security Considerations 中递延段;三条 Test Case 删除,其余重新编号 |
| `RegisterProjectionReference.sol` | 删除接口、`Deferral` 结构、`_deferrals` 存储、三个错误、四个函数,`supportsInterface` 去掉该 ID |
| `protocol.cjs` | 删除 5 项递延测试,接口 ID 断言改为两个 |

正文小节"Rights and the projection"补一句,把这件事说清楚:本标准**不为此提供任何登记表**,但欠付方可以在 `isFinalAsOf` 为真后把受益人绑定到 `holderAsOf` —— 判据齐备,做法自定。

### 结果

(以下为实测值)

| | 删除前 | 删除后 |
| --- | --- | --- |
| 规范正文 MUST | 30 | **26** |
| 规范正文小节(`###`) | 11 | **10** |
| 规范正文行数 | 399 | **341** |
| 参考实现行数 | 601 | **534** |
| 测试项 | 32 | **27** |
| 公开接口 | 3 | **2** |

`0x3ce71a8d` 与 `0xfd0f6337` 均未变 —— 删除一个独立接口不影响另外两个的 selector XOR,测试内已断言。

### 记录

作者在 2026-08-30 裁定"入标准",2026-08-31 裁定"删"。后者不是反复,是原则确立之后的重新裁定 —— ADR-009 的判据在前一次裁定时尚未提出。
