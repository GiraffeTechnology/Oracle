# ERC 提交基线 —— 权威副本

本目录是本 ERC 提交材料的**唯一权威副本**。此前材料只以 zip 在多方之间传递,导致过多次回退与漂移(作者名被工具断言强制回退、修改未并入、changelog 未记录信任模型替换)。自本次提交起,任何修改以本分支为准,不再以 zip 为准。

## 当前状态

- 提案标题:Proof-Verified Deferred Asset Settlement
- 状态:Draft,未提交,未分配编号
- 作者:Michael Yip (@GiraffeTechnology)
- 候选正文:`ERCS/erc-xxxx.md`
- 公开资产:`assets/eip-xxxx/`

## 已机械验证(可复现)

| 项 | 方式 | 结果 |
| --- | --- | --- |
| 官方 eipw | 本地编译 eipw 0.11.0,使用 `tools/eipw-official-config-snapshot.toml`(取自 ethereum/ERCs `config/eipw.toml`),并拉取 11 份被引提案原文供链接解析 | 退出码 0,**零诊断** |
| eipw 有效性负向对照 | 故意破坏 CC0 行 | 立即报 `markdown-copyright` 与 `markdown-rel-links`,证明配置生效 |
| 参考实现测试 | `npm install && npx hardhat test` | **39 passing / 0 failing** |
| 参考实现格式化 | prettier-plugin-solidity;剥离 metadata 后比对运行时字节码 | 逐字节一致,ABI 相同,**语义零变化** |
| 包完整性 | `tools/verify-package.mjs` | PASS |

冻结值:`IVersionedCertificate` `0xebaa86a0`,`IDeferredCertificateSettlement` `0x2773d4c9`。

## 剩余一步(且仅此一步)

`ERCS/erc-xxxx.md` 的 `discussions-to` 仍为 `REPLACE_WITH_DISCUSSION_SLUG`。

需要:在 Ethereum Magicians 发帖 → 取真实 URL → 填入 → 重跑 eipw → 重建 `FILE_INDEX_SHA256.txt` → 跑 `tools/verify-package.mjs` → 向 ethereum/ERCs 提 PR。

`eip: XXXX` 保持占位是正确的,由 ERC 编辑分配后再替换,同时需重命名 `ERCS/erc-<编号>.md` 与 `assets/eip-<编号>/`。

## 未完成的技术工作(不影响提交的机械可行性)

对 proof 路径的对抗性审查尚未进行:validator set 轮换、equivocation、远端分叉、证明重放与 remote height 边界。规范已把这些列入 Profile 责任,但尚无人专门审过。

## 修改规则

1. 改动落在本分支,不通过 zip 往返。
2. 任何触及 `ERCS/` 或 `assets/` 的改动,必须重跑 eipw、测试、重建索引、跑包校验器,四项齐全才算完成。
3. `tools/verify-package.mjs` 的断言反映当前应有状态;状态推进时同步更新断言,不要绕过它。
