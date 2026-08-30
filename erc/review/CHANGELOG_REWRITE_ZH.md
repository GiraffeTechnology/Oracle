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
