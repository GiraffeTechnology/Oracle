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
| 参考实现测试 | **27 passing / 0 failing** | `npm install && npx hardhat test` |
| 接口 ID | `0x3ce71a8d` / `0xfd0f6337` | selector XOR 独立复算,并在测试内断言,无碰撞 |

## 五、提交后会被问到的问题(准备好答案)

**问:这不就是 ERC-7965 加 ERC-6997 的应用吗?**

答:不是。ERC-7965 证明的是"某条消息在源链上成立",它的广播语义要求一份证明服务多个接收方,因此明确不把证明绑定到目的链的字段集合,也不约束验证与执行的关系。ERC-6997 是把转移卡在一个被授权方的放行上。两者都不产生一条**可按时间解析的登记历史**。本 ERC 的贡献不在证明,而在投影:严格递增的 `effectiveAt` 加上代币内唯一的 record commitment,使**任何一个过去的瞬间恰好解析出一个确认持有人**。

**问:这和跨链 NFT 桥有什么区别?**

答:桥托管、销毁或铸造一个表示物,使代币在链间移动。这里 ERC-721 始终停留在发行链上,什么都不铸造;远端证明只是准许**一条记录**进入投影。不是同一种原语。

**问:你不还是要一个 oracle 吗?**

答:是,而且正文开头就写明了不试图移除它。不自带共识的登记册没有状态根、没有终局性;登记册内容通常也不能上链(涉密、涉及个人、或不是登记方有权披露的)。所以必须有人对其内容作出承诺,证明验证的是**那个人签过的话**,不是世界。

能改变的不是"谁被信任",而是**这份信任允许什么**:陈述进入每代币唯一的只增序列,两条不能共享同一生效时刻,任何一条不能复用,任何过去瞬间可被事后重新检视。**自相矛盾的来源会把矛盾留在记录上,而不是覆盖掉**,且与登记方毫无关系的第三方看得见。裸 oracle 报告一条都做不到。

补充一条参考实现本来就有的性质:配额验证人签的是同一个 digest(含 state root)。两个读取者读出不同结果 → root 不同 → 签名凑不满门限 → 条目**进不来**,缺口保持打开、瞬间保持被争议。宁可不进,不可进错。

**问:既然不阻断交易、又不规定权利怎么行使,那这个标准到底标准了什么?**

答:标准的是**权力与事实的归属**,不是规则本身:

- 谁能移动登记册的答案 —— 开缺口须 ERC-721 授权;准入**任何人**都可以,凭证明,`msg.sender` 不参与有效性判定;取消只有发起方、且须过 deadline;
- 任一瞬间的答案是什么 —— `holderAsOf`;
- 那个答案定没定 —— `isFinalAsOf`;
- 此刻正不正在被争议 —— `openGapOf` 与缺口的 `openedAt`。

**权利拿这四件事去做什么,由权利自己的条款定。** 分红和投票本来就该给出不同答案,发行人和 DAO 也可以再给出不同答案;把这些答案写死在标准里,是越过互操作所需一致性的立法。标准去掉的只是**盲目决定的借口**。

**问:为什么不像 HKEX 那样设一个封闭期,让记录时刻事前确定?**

答:可以,而且**不需要标准增加任何东西**。条目只能经由打开的缺口进入,而开缺口须 ERC-721 授权。因此"起始时无缺口 + 期间不开新缺口"的区间(正文称 quiescent),投影完全无法推进 —— 这正是关闭登记册买到的东西,DAO 投票即可达成。

但它保护不了**构成它的那次投票**:立封闭期的投票本身没有封闭期保护,给它加保护又需要更前一次投票,**递归没有底**。所以总有某次行使只能按当时的投影评估。HKEX 不面对这个问题,因为董事会的成员资格外生于名册;链上没有这样的机构,发起权与投票权都源自持有,而持有正是投影要解析的对象。

## 六、已记录的架构局限(不阻断提交)

proof 路径的对抗性审查已完成(见 `review/PROOF_PATH_ADVERSARIAL_REVIEW_ZH.md`),未发现可利用缺陷。两项局限记录在参考实现文件头:验证人分叉签名(equivocation)不检测,验证人集合不可变。生产 Profile 必须自行解决,规范正文的 Security Considerations 已列为 Profile 责任。

文件头另有一条须一并交代:登记册自带共识时,生产 Profile 应使用其原生轻客户端;**很多登记册没有共识**(股份过户登记处、土地注册处),此时文件里的验证人集合根本不是共识,而是一个**证明配额(attestation quorum)**,Profile 必须披露证明方是谁。
