# 手动提交操作单

本文件与 `review/`、`tools/` 均为**内部材料,不进 PR**。
进 PR 的只有 `ERCS/` 与 `assets/` 下的 6 个文件。仓库内不另存副本 —— 两份同内容文件会重新制造漂移。

## 一、进 PR 的文件

```
ERCS/erc-xxxx.md
assets/eip-xxxx/README.md
assets/eip-xxxx/contracts/RegisterProjectionReference.sol
assets/eip-xxxx/hardhat.config.cjs
assets/eip-xxxx/package.json
assets/eip-xxxx/test/protocol.cjs
```

**不要**把 `review/`、`tools/`、`SUBMISSION_MANUAL_ZH.md`、`MAGICIANS_FIRST_POST_EN.md`、`FILE_INDEX_SHA256.txt` 放进 PR。ERC 仓库只接受提案正文与 assets。

## 二、提交前必须改的两处

### 1. `discussions-to`(唯一阻断项)

先在 Ethereum Magicians 发帖(首帖草稿见 `MAGICIANS_FIRST_POST_EN.md`),取真实 URL,替换 `ERCS/erc-xxxx.md` 第 6 行:

```
discussions-to: https://ethereum-magicians.org/t/REPLACE_WITH_DISCUSSION_SLUG
```

**顺序不能反** —— 先有帖子,再填 URL,再提 PR。

### 2. `eip` 编号与文件名

`eip: XXXX` 保持占位提交是**正确做法**,编号由 ERC 编辑分配。常见做法是用 PR 号临时填入,编辑会指定最终号。编辑给号后需同步改三处:

- `ERCS/erc-xxxx.md` → `ERCS/erc-<号>.md`
- `assets/eip-xxxx/` → `assets/eip-<号>/`
- 正文 Reference Implementation 段中 `assets/eip-xxxx/` 的路径描述

## 三、提交步骤

1. fork `ethereum/ERCs`,从 `master` 开新分支;
2. 把本目录 `ERCS/` 与 `assets/` 的内容按同名路径放进 fork;
3. 本地跑一次官方 lint(可选但建议):
   ```
   cargo install eipw --version 0.11.0
   eipw --config config/eipw.toml ERCS/erc-<号>.md
   ```
   预期:无输出,退出码 0;
4. 提交 PR,标题惯例为 `Add ERC: Asynchronous Register Projection for NFTs`;
5. CI 会跑 eipw 与 HTMLProofer,等编辑分配编号。

## 四、当前已验证状态

| 项 | 结果 | 验证方式 |
| --- | --- | --- |
| 官方 eipw 0.11.0 | **0 诊断,退出码 0** | 本地编译 eipw,使用 `tools/eipw-official-config-snapshot.toml`,补齐 15 份被引提案原文供链接解析 |
| lint 有效性 | 负向对照通过 | 故意破坏 CC0 行会立即报 `markdown-copyright`,退出码 65,证明配置在生效 |
| 参考实现测试 | **31 passing / 0 failing** | `npm install && npx hardhat test` |
| 接口 ID | `0x3ce71a8d` / `0xfd0f6337` / `0x6d39b0a8` | selector XOR 独立复算,并在测试内断言,无碰撞 |

## 五、提交后会被问到的三个问题(准备好答案)

**问:这不就是 ERC-7965 加 ERC-6997 的应用吗?**

答:不是。ERC-7965 证明的是"某条消息在源链上成立",它的广播语义要求一份证明服务多个接收方,因此明确不把证明绑定到目的链的字段集合,也不约束验证与执行的关系。ERC-6997 是把转移卡在一个被授权方的放行上。两者都不产生一条**可按时间解析的登记历史**。本 ERC 的贡献不在证明,而在投影:严格递增的 `effectiveAt` 加上代币内唯一的 record commitment,使**任何一个过去的瞬间恰好解析出一个确认持有人**。

**问:这和跨链 NFT 桥有什么区别?**

答:桥托管、销毁或铸造一个表示物,使代币在链间移动。这里 ERC-721 始终停留在发行链上,什么都不铸造;远端证明只是准许**一条记录**进入投影。不是同一种原语。

**问:既然不阻断交易,那这个标准到底约束了什么?**

答:约束的是"权利在哪条记录上结算"。`ownerOf` 是可交易头寸,投影是确认记录,两者被刻意分开。落在缺口内的权利分两类:不可回补的(如投票)对新旧双方都不可行使且永久消灭;可回补的(如分红)递延,待投影落定后补记给该瞬间的确认持有人 —— 即使它已不再持有代币。传统基础设施用除权日把这套算术集中掉,这里把状态暴露出来由各方自己算。

## 六、已记录的架构局限(不阻断提交)

proof 路径的对抗性审查已完成(见 `review/PROOF_PATH_ADVERSARIAL_REVIEW_ZH.md`),未发现可利用缺陷,但两项局限记录在参考实现文件头:验证人分叉签名(equivocation)不检测,验证人集合不可变。生产 Profile 必须自行解决这两项;规范正文的 Security Considerations 已把它们列为 Profile 责任。
