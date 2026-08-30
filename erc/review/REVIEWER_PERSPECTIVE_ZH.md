# 以审查人身份的评审意见

日期：2026-08-29
立场：假设我是 ERC 编辑／Ethereum Magicians 评审人，第一次看到这份提案，不知道它的准备过程
结论：**曾存在一个阻断级缺陷，现已修复；MAJOR-2 与 MAJOR-3 仍需在提交前定案**

## BLOCKER-1　卖方可以单方面作废一次已在远端完成的过户　—　**已修复（2026-08-29）**

> **修复记录**：持有人取消已限定在 deadline 之后；deadline 之前的窗口归证明所有。规范 Cancellation 与 Security Considerations 两节同步，参考实现新增 `DeadlineNotPassed` 门禁，并补两条回归测试（deadline 前取消被拒；取消尝试失败后有效证明仍能终局）。测试 39 → 41 全通过。

**位置**：`ERCS/erc-xxxx.md:168`，以及参考实现 `cancelSettlement`

规范原文：

> The recorded `from` address MAY cancel a pending settlement using empty `proofData`.

**没有任何时间或条件限制。** 参考实现一致：

```solidity
if (item.status != SettlementStatus.PENDING) revert InvalidSettlement();
if (msg.sender != item.from || proofData.length != 0) revert Unauthorized();
item.status = SettlementStatus.CANCELLED;
```

**攻击路径：**

1. 卖方 `beginSettlement`，Token 进入 PENDING，交易停止；
2. 买方在链下付款；远端登记完成过户，并把该 remote settlement record 写入已最终化的状态；
3. **在任何人提交证明之前**，卖方调用 `cancelSettlement`；
4. 状态变为 CANCELLED。`finalizeSettlement` 要求 `status == PENDING`，因此那份**合法且已最终化的证明永远无法被消费**；
5. 远端账本记录买方为所有权人，本地 Token 仍归卖方。

**这正是本提案在 Motivation 中声称要消除的失败模式** —— 两个账本永久分叉，且分叉不再有任何链上机制可以收敛。买方付了钱，拿到远端登记，拿不到 Token，也没有任何链上救济。

**这是一次回归。** V6 的实现有正确的门禁：

```solidity
block.timestamp > item.deadline && msg.sender == item.from && authorityData.length == 0
```

deadline 门禁在 V9 改写为 proof 模型时被删除。

**修复方向**：持有人取消必须限定在 deadline 之后，使 deadline 之前成为"有效证明优先"的窗口；规范应明确写出证明与取消的优先关系。当前 `Profiles MAY impose an additional delay, but MUST define a bounded recovery path` 一句预设了取消是救济手段，但没有门禁的取消不是救济，是单方面毁约。

## MAJOR-2　一份提案里装了两个标准，而且文档自己承认了

`:32`：

> Certificate history remains useful evidence metadata but is not the principal contribution.

但 `:120` 又要求：

> A **settlement-conforming** contract MUST be certificate-conforming

作者自述"不是主要贡献"的那一半，被设为主要贡献那一半的强制前置。EIP-1 要求提案聚焦于 single key proposal。评审会问：一个只需要"远端证明门控交割"的实现，为什么必须背上一条它可能根本不需要的证书版本链？

被证明的 leaf 绑定 13 个字段，其中前后承诺只占 2 个 —— 交割不变量本身并不依赖证书历史存在。

**建议**：拆成两份提案，或把证书接口降为可选组合。这个决定会影响 `0xebaa86a0` 的去留，宜在提交前定，不宜在 Last Call 前后被迫返工。

## MAJOR-3　Motivation 承诺了接口并不提供的信号

Motivation 现在立论于第三方场所必须响应待决状态。它们确实能通过 ERC-165 发现 `0x2773d4c9`、读 `pendingSettlementOf` 与 `settlement`。

但两个接口共 8 个函数，**没有任何一个暴露远端账本身份或验证 profile**（全文匹配数为 0；参考实现里 `remoteLedgerId`、`validatorSetHash` 是 immutable 内部变量，不在标准接口中）。

后果：一个市场能看到"待决，停止挂单"，却**无法判断最终那次 finalization 来自一个可信的 profile 还是一个单人验证人集合**。标准交付了"停止交易"的信号，没有交付"是否该相信这次收敛"的信号。而后者恰恰是 Motivation 里"任何观察者都能验证"这句话所承诺的。

**建议**：在 `IDeferredCertificateSettlement` 增加一个 profile 可发现访问器（例如返回 profile 标识与远端账本标识）。这会改变 `0x2773d4c9`，因此同样应在提交前决定。

## MINOR-4　`certificateAuthority` 是强制成员，却被规范自己否定

`:62` 要求非零，`:52` 说 MAY equal holder，且 MUST NOT 替代证明，定性为 informational。

一个既强制、又可以等于持有人、又不可用于任何验证的地址，消费者拿它做不了任何可验证的判断。它却永久占据在已冻结的 `0xebaa86a0` 里。评审会要求删除或给出实质用途。

## MINOR-5　`authorityReference` 这个名字需要规范两次澄清

Definitions 里不得不写 "Despite the retained ABI name, it does not authorize finalization"。为了兼容一份从未发布的工作稿而在**新标准**里保留误导性字段名，理由不成立。

**且重命名是零成本的** —— 我复算确认：函数 selector 与事件 topic 只依赖类型，不依赖参数名或结构体字段名，重命名后 `0xebaa86a0` / `0x2773d4c9` 与 `CertificateSuperseded` 的 topic0 均不变。建议改为 `recordReference` 一类中性名称。

## EDITORIAL-6　参考 profile 混在规范性章节里，且段落断裂

`### Proof encoding profile` 位于 Specification 之内，但内容是"CC0 参考 profile 的做法"，非规范性要求。评审通常要求把示例移入 Rationale 或 assets。

同时该段行文断裂：

> Each implementation profile MUST publish a canonical schema. The CC0 reference profile uses:
>
> Its domain-separated checkpoint and leaf type names are `RemoteFinality` and `RemoteSettlement`.
>
> ```solidity …```

"uses:" 之后插入了一句无关句子才接代码块。

## 结论与建议顺序

1. **BLOCKER-1 必须修**，且修复涉及规范与参考实现，需重跑测试；
2. MAJOR-2 与 MAJOR-3 都会改变冻结的 interface ID，**必须在提交前定案**，Last Call 阶段再改代价极高；
3. MINOR-4、MINOR-5、EDITORIAL-6 是纯文本，随 1–3 一并处理。

以审查人身份，我原本不会建议在 BLOCKER-1 修复前提交。该项现已修复并有回归测试覆盖；MAJOR-2 与 MAJOR-3 涉及冻结 interface ID，仍应在提交前定案。原判断保留如下：它不是理论风险，是一条可执行的、导致买方付款后无救济的路径，而提案的立论恰恰是消除这种分叉。
