# 重写记录 —— 从 V9 到 Asynchronous Register Projection

日期:2026-08-30
分支:`claude/erc-standard-feasibility-audit-90ypms`(不可并入 main)

## 触发

作者给出的公理:**链下登记必然异步,但登记册的变更时间与哈希值是唯一的。**

这句话推翻了 V1–V9 的两条规则:

1. pending 期间阻断转让 —— 为了记账问题停掉市场,并且摧毁了记录时刻落在冻结区间内的权利;
2. 把"确认持有人"与 `ownerOf` 合并 —— 逼迫在"冻结市场"和"记录说谎"之间二选一。

公理表明两者都不必要。变更身份唯一,就足以构造一个可按时间解析的总序。详见 `ADR_007_REGISTER_PROJECTION_AXIOM_ZH.md`。

## 规范正文

- 标题 `Proof-Verified Deferred Asset Settlement` → `Asynchronous Register Projection for NFTs`(41/44 字符)
- description 重写(109/140 字符)
- 新增 **Projection invariants** 一节,四条:首条 version 1 且 previousCommitment 为零;每次追加 n+1 并链接前一承诺;`effectiveAt` **严格**递增;record commitment 在代币内唯一。后两条不是整洁性要求 —— 一个瞬间被两条条目共享就会有两个答案,两条无法区分的条目无法解析。
- 新增 **Trading is not blocked** 一节:普通转让 MUST NOT 被阻断;实现 MUST NOT 从 `ownerOf` 推断确认持有人,MUST NOT 在普通转让时更新投影。
- 新增 **Entitlements during a projection gap** 一节,把 ADR-006 的可回补/不可回补分类升为规范文本,含递延权利"不得在递延时绑定受益地址"的规则,以及"取消则前一条目继续有效"。
- 接口整体更名并重构:`IVersionedCertificate` → `IRegisterProjection`(新增 `entryAsOf`/`holderAsOf`/`entryCount`),`IDeferredCertificateSettlement` → `IProjectionSettlement`(去掉 `certificateAuthority`,新增 `settlementPeriod`)。
- ERC-8325 由强制锚定降为 MAY;正文与参考实现中的锚定机制全部移除。
- Rationale 与 Prior art 重写:贡献点明确改为**投影**而非证明。

## 接口 ID(独立复算,并在测试内断言)

| 接口 | 旧 | 新 |
| --- | --- | --- |
| 登记投影 | `0xebaa86a0` | **`0x3e925bdc`** |
| 结算 | `0x2773d4c9` | **`0xbe360d3d`** |

## 参考实现

`contracts/VersionedCertificateReference.sol` 删除,`contracts/RegisterProjectionReference.sol` 新增(491 行)。

- `transferFrom` 不再有缺口检查;
- `finalizeSettlement` 不再转移代币,只追加一条以 `expectedHolder` 为持有人的条目;
- 新增 `EffectiveAtNotIncreasing`、`CommitmentReused` 两项 revert;
- `beginSettlement` 在已有缺口时顶替旧缺口并发 `SettlementSuperseded`;
- `entryAsOf` 二分查找,首条之前 revert `NoEntryAsOf`;
- 保留 BLOCKER-1 的修复:`cancelSettlement` 仍以 deadline 为闸门,且授权检查在前,外部账户仍得到 `Unauthorized`;
- 保留文件头的信任假设声明(不检测 equivocation、验证人集合不可变、数组无界)。

## 测试

`test/protocol.cjs` 重写,22 项,全部通过。覆盖:两个接口 ID、EIP-170 尺寸、四条投影不变量、`entryAsOf` 的区间边界、缺口期间的转让、缺口顶替、原子准入、**逐一篡改 11 个被绑定叶字段**、登记册与验证人集合身份、签名规则、重放与 remote height 回退、Merkle 路径、deadline 闸门的取消、未知 settlement 语义,以及四轮连续准入的严格递增追加链。

修正了两处测试自身的缺陷:

1. 篡改用例原先用 `JSON.stringify(mutation)` 生成 settlement id,遇到 BigInt 直接抛异常;更重要的是它让叶里的 `settlementId` 始终是默认值,与被 finalize 的 id 不符 —— 于是**所有 11 个用例都只因 settlementId 不匹配而失败**,断言是空的。改为按下标生成 id 并把它注入叶,用例才真正逐字段生效。
2. 补上了 `recordCommitment` 这一被遗漏的叶字段,"每一个被绑定字段"的说法才成立。

## 全链验证

| 项 | 结果 |
| --- | --- |
| 官方 eipw 0.11.0(config sha256 `575e0cf5…`) | 退出码 0,零诊断 |
| eipw 负向对照(破坏 CC0 行) | `markdown-copyright`,退出码 65 |
| 干净副本 `npm install && npm test` | 22 passing / 0 failing |
| Solidity 编译告警 | 0(测试自身断言) |
| `tools/verify-package.mjs` | PASS,37 个索引文件 |

## 未决

1. 递延权利登记表:入标准(宽)还是留给权利合约(窄)。当前取窄。
2. 登记册 / Profile 身份访问器是否加入接口。当前没有。

---

# 第二轮 —— 两项作者裁定的落地(2026-08-30)

作者裁定:**递延权利登记表入标准**;**加可发现性访问器**。落地过程中发现并修掉了一个重写时遗留的语义漏洞。

## 发现的漏洞:`entryAsOf` 分不清"已解析"与"已定局"

缺口期间 `entryAsOf` 返回缺口**之前**那条条目,看起来像确定答案。但之后准入一条 `effectiveAt` 落在被查询瞬间之前的条目,这个答案会**回溯改变**。递延分红要补记给"该瞬间的确认持有人",若在答案还会变时就绑定受益人,补记对象可能是错的。

原正文只说"缺口内的确认持有人尚不可知",没有给出**何时可知**的判据,也没有任何接口能表达它。这是重写留下的洞,不是新需求。

## 终局条件

由不变量 3 直接推出:每条准入条目的 `effectiveAt` 严格大于当前最后一条,因此未来任何条目都不可能覆盖一个已经早于最后一条生效时刻的瞬间。

> 瞬间 t 已终局 ⟺ `第一条.effectiveAt ≤ t < 最后一条.effectiveAt`

即"t 被某条条目覆盖,且其后已经存在下一条"。一次比较即可判定,做成 `isFinalAsOf`。

推论,均已写入正文:

- **取消结算不使任何瞬间终局**。原正文写"缺口因取消而关闭时,权利按缺口前的持有人解析",这是把临时答案当成了定局答案,已改写:临时答案确实回退到缺口前的条目,但登记册已经作出、本链尚未看到的变更仍可事后准入,故 `resolveDeferral` 在取消后仍必须 revert。
- **允许同持有人条目**。`beginSettlement` 原先拒绝 `expectedHolder == 当前确认持有人`,那是旧设计(结算即转移)的残留。在投影语义下这条会造成:持有人长期不变的代币永远产生不了新条目,于是任何近期瞬间永不终局,其上的递延权利永远无法解析。现改为允许,并把它命名为 **confirming entry** —— 登记册说"到此为止仍是这个持有人",这句话正是闭合区间的东西。Profile SHOULD 提供产生它的手段;这是一项 liveness 依赖,已写入 Security Considerations。

## 新增接口

`IDeferredEntitlement`(`0x6d39b0a8`):`deferralId` / `deferral` / `deferEntitlement` / `resolveDeferral`。

- 递延项由(代币, 权利标识, 记录时刻)三元组唯一确定,**记录时不绑定受益地址**;
- 同一三元组重复登记不报错、不重复建项、返回同一标识;
- `resolveDeferral` 以 `isFinalAsOf` 为闸门,任何人可调用(结果由投影决定,与调用者无关),解析后受益人不可变、不可重复解析;
- 登记表**只记归属**,不持有、不转移、不核算权益本身。

## 新增访问器

| 接口 | 新增 |
| --- | --- |
| `IRegisterProjection` | `isFinalAsOf`、`registerId`、`registerDescriptor` |
| `IProjectionSettlement` | `verificationProfile` |

旧评审的 MAJOR-3(无 Profile 可发现性)就此关闭。

## 接口 ID(三者互不相同,15 个选择器无碰撞)

| 接口 | 上一轮 | 现值 |
| --- | --- | --- |
| `IRegisterProjection` | `0x3e925bdc` | **`0x3ce71a8d`** |
| `IProjectionSettlement` | `0xbe360d3d` | **`0xfd0f6337`** |
| `IDeferredEntitlement` | — | **`0x6d39b0a8`** |

## 测试

22 → **30**,全部通过。新增 8 项:登记册/Profile 身份跨准入稳定、同持有人 confirming entry 及其使前序瞬间终局、`isFinalAsOf` 的五个边界、已终局瞬间在后续准入下不变(同时验证未终局瞬间确实会变)、递延标识的推导与区分、无受益地址登记与幂等、三类拒绝(零权利标识 / 首条之前 / 已终局)、非终局(含取消后)拒绝解析、受益人绑定到**记录时刻**的确认持有人而非解析时刻的持有人。

测试中修正一处我自己的错误:`beginSettlement` 的授权跟随 ERC-721 owner,而非确认持有人;投影推进后两者可以不同,原用例误用了确认持有人作为调用方。

## 全链验证

| 项 | 结果 |
| --- | --- |
| 官方 eipw 0.11.0 | 退出码 0,零诊断 |
| 干净副本 `npm install && npm test` | 30 passing / 0 failing |
| Solidity 编译告警 | 0 |
| EIP-170 运行时字节码 | 未超限(测试断言) |
| `tools/verify-package.mjs` | PASS |
