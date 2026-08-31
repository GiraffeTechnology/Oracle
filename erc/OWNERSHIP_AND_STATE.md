# ERC 提交基线 —— 权威副本

本目录是本 ERC 提交材料的**唯一权威副本**。此前材料只以 zip 在多方之间传递,导致过多次回退与漂移(作者名被工具断言强制回退、修改未并入、changelog 未记录信任模型替换)。自本次提交起,任何修改以本分支为准,不再以 zip 为准。

## 当前状态

- 提案标题:**Asynchronous Register Projection for NFTs**
- 前身:Proof-Verified Deferred Asset Settlement(V1–V9)。已按 `review/ADR_007_REGISTER_PROJECTION_AXIOM_ZH.md` 的公理整体重写,不是增量修订。
- 状态:Draft,未提交,未分配编号
- 作者:Michael Yip (@GiraffeTechnology)
- 候选正文:`ERCS/erc-xxxx.md`
- 公开资产:`assets/eip-xxxx/`

## 重写改变了什么

| | 旧版 | 现版 |
| --- | --- | --- |
| 核心主张 | 用远端证明作为转移的唯一授权 | 用登记册变更的唯一身份(生效时刻 + 内容承诺)构造**可按时间解析的投影** |
| pending 期间的转让 | 一律 revert | **不阻断**,`ownerOf` 照常移动 |
| 两种所有权 | 合并 | `ownerOf` 是可交易头寸,投影是确认记录,刻意分开 |
| 权利 | 未定义 | 不可回补的永久消灭(双方均不可行使);可回补的递延,落定后补记给该瞬间的确认持有人 |
| 递延权利登记表 | 无 | 仍为无。曾短暂入标准,后按 ADR-009 删除 —— `holderAsOf` + `isFinalAsOf` 已让欠付方自行绑定,登记表只是便利,不是能力 |
| 终局性 | 未区分 | `isFinalAsOf`:t 终局 ⟺ t < 最新条目的 `effectiveAt` |
| 可发现性 | 无 | `registerId` / `registerDescriptor` / `verificationProfile` |
| 同持有人条目 | 拒绝为 no-op | 允许,且是静态持有人下唯一能让瞬间终局的手段 |
| 新增不变量 | — | `effectiveAt` 严格递增;record commitment 在代币内唯一 |
| ERC-8325 | 强制锚定 | MAY |

## 已机械验证(可复现)

| 项 | 方式 | 结果 |
| --- | --- | --- |
| 官方 eipw | 本地编译 eipw 0.11.0,使用 `tools/eipw-official-config-snapshot.toml`(取自 ethereum/ERCs `config/eipw.toml`),并拉取 15 份被引提案原文供链接解析 | 退出码 0,**零诊断** |
| eipw 有效性负向对照 | 故意破坏 CC0 行 | 立即报 `markdown-copyright`,退出码 65,证明配置生效 |
| 参考实现测试 | 从 `assets/eip-xxxx` 的干净副本跑 `npm install && npm test` | **27 passing / 0 failing** |
| Solidity 编译告警 | 由测试自身断言 | **0** |
| 接口 ID | selector XOR 独立复算,测试内断言,无选择器碰撞 | `0x3ce71a8d` / `0xfd0f6337` |
| 包完整性 | `tools/verify-package.mjs` | PASS |

冻结值:`IRegisterProjection` `0x3ce71a8d`,`IProjectionSettlement` `0xfd0f6337`。**两个,不是三个。**

## 剩余一步(且仅此一步)

`ERCS/erc-xxxx.md` 的 `discussions-to` 仍为 `REPLACE_WITH_DISCUSSION_SLUG`。

需要:在 Ethereum Magicians 发帖(草稿见 `MAGICIANS_FIRST_POST_EN.md`)→ 取真实 URL → 填入 → 重跑 eipw → 重建 `FILE_INDEX_SHA256.txt` → 跑 `tools/verify-package.mjs` → 向 ethereum/ERCs 提 PR。

`eip: XXXX` 保持占位是正确的,由 ERC 编辑分配后再替换,同时需重命名 `ERCS/erc-<编号>.md` 与 `assets/eip-<编号>/`。

## 已决的设计问题

1. 可发现性 —— **加**(作者 2026-08-30 裁定)。`IRegisterProjection` 增 `registerId()` 与 `registerDescriptor()`,`IProjectionSettlement` 增 `verificationProfile()`。旧评审的 MAJOR-3 就此关闭。
2. 递延权利登记表 —— **先入后删**。2026-08-30 裁定入标准,2026-08-31 按 ADR-009 的边界原则删除:`holderAsOf` + `isFinalAsOf` 已让欠付方自行完成同样的绑定,该接口提供的是便利与统一,不是能力,且它替所有人挑了一种政策。
3. 标准的边界 —— 见 `review/ADR_009_SCOPE_AUTHORITY_NOT_RULES_ZH.md`:**厘清谁有权力,不替用户定规则;不代替 oracle,不证明它诚实,只固定它是谁、说过什么、什么时候说的。**

变更过程见 `review/CHANGELOG_REWRITE_ZH.md` 与各 ADR。

## 已知架构局限(已在参考实现文件头声明)

验证人分叉签名(equivocation)不检测;验证人集合不可变;数组无界。生产 Profile 必须自行解决,规范 Security Considerations 已列为 Profile 责任。

## 修改规则

1. 改动落在本分支,不通过 zip 往返。**本分支不可并入 main。**
2. 任何触及 `ERCS/` 或 `assets/` 的改动,必须重跑 eipw、测试、重建索引、跑包校验器,四项齐全才算完成。
3. `tools/verify-package.mjs` 的断言反映当前应有状态;状态推进时同步更新断言,不要绕过它。
