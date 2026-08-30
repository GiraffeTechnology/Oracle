# proof 路径对抗性审查

日期：2026-08-29
审查人：外部审计（Claude）
对象：`assets/eip-xxxx/contracts/VersionedCertificateReference.sol` 的 CC0 参考 Profile，以及 `ERCS/erc-xxxx.md` 的 `Proof-verified finalization` 与 `Proof encoding profile` 两节
范围：终局证明路径。不含证书版本链、状态机、锚点绑定、取消路径（这些在 V1–V6 的 authority 模型下已审）

## 结论

**未发现可利用缺陷。** 两处我预设为漏洞的地方，深入后判定为设计正确，推理留档见第二节。两项真实局限属于架构选择，规范已明确划归 Profile 责任，但参考实现未加说明 —— 已补注释，见第三节。

## 一、已确认正确的部分

| 检查项 | 结论 |
| --- | --- |
| 逐字段绑定 | leaf 绑定 `block.chainid`、`address(this)`、tokenId、settlementId、from、to、snapshotHash、前后承诺、authorityReference、版本、effectiveAt、anchorId，共 13 项。与规范第 4 条要求一致，无遗漏字段 |
| 证明消费去重 | `usedProofs[keccak256(finality, leaf)]`，同一 (checkpoint, leaf) 不可重放 |
| 远端高度单调 | `height <= lastRemoteHeight[tokenId]` 拒绝，阻止回滚到旧的最终记录 |
| quorum 计票 | 要求 `signatures.length >= finalityThreshold`，签名者必须严格递增且属于验证人集合 —— 同时防重复计票与乱序 |
| 签名可延展性 | 强制低 s（`s > _HALF_ORDER` 拒绝），`v` 规范化后仅接受 27/28，`ecrecover` 返回零地址拒绝 |
| 重入 | 终局路径不调用 `onERC721Received`；锚点校验是 `staticcall`，被调方无法改状态 |
| 状态原子性 | 任一步失败整体 revert；证明消费、高度记录、证书追加、持有人转移、状态置位在同一笔交易内完成 |
| 终局与提交者解耦 | `finalizeSettlement` 不读 `msg.sender`，不存在 relayer 白名单，与规范"提交者不受信"一致 |

## 二、预设为漏洞、经分析不成立的两点（推理留档）

### 2.1 checkpoint 未使用 EIP-712 domain separator —— 不是缺陷

初判：finality digest 是 `keccak256(abi.encode(TYPEHASH, ledgerId, height, blockHash, root, validatorSetHash))`，没有 `\x19\x01` 前缀、没有 chainId/verifyingContract，怀疑可跨实例或跨协议重放。

复核后判定**设计正确，不应修改**：

1. 远端共识 checkpoint 在语义上是**关于远端账本的全局事实**，不是针对某个消费者合约的声明。若绑定 `verifyingContract`，同一 checkpoint 需为每个消费方重新签名，与真实轻客户端的做法相反 —— 原生共识签名从不按消费者做域分隔。
2. 实际的域分隔由两个签入字段完成：`remoteLedgerId` 钉住账本身份，`validatorSetHash` 钉住验证人集合与阈值。跨实例重放只在两实例**同时**共享同一远端账本与同一验证人集合时成立，而那种情形下该 checkpoint 本就是对双方都有效的同一事实。
3. 跨协议碰撞需要另一协议的验证人对以本 `REMOTE_FINALITY_TYPEHASH` 开头的 6 字结构签名，构造上不可行。TYPEHASH 常量即类型域分隔。

因此规范中"domain-separated checkpoint"的表述是准确的，实现与之相符。

### 2.2 Merkle 路径未绑定树深与索引 —— 不构成可利用面

初判：`_verifyMembership` 不限制 `siblings.length`，`index` 超出路径长度的高位被忽略，且 `siblings.length == 0` 时退化为 `leaf == root`，怀疑存在短路径或内部节点冒充叶子的攻击。

复核后判定**不可利用**：

1. **叶子不由攻击者选择**。合约用 `_remoteLeaf` 从 settlement 状态自行计算 leaf，攻击者无法提交任意叶子值，因此经典的"内部节点冒充叶子"第二原像攻击不成立 —— 该攻击前提是验证方接受调用方给定的叶子。
2. 叶子原像为 14 个字（`abi.encode` 13 字段加 TYPEHASH，共 448 字节），内部节点原像固定 64 字节，长度域不重叠。
3. 短路径无收益：无论路径多长，最终仍须 `value == root`，而 root 已被 quorum 签名钉死。攻击者无法在不知道真实路径的情况下凑出该 root。
4. `siblings.length == 0` 对单叶子树是正确语义，非缺陷。
5. `index` 高位被忽略只意味着多个 `leafIndex` 取值验证等价，因 leaf 与 root 均已固定，不产生安全影响。

结论：绑定树深会略微收紧输入空间，但不修复任何现存攻击面。**提交前不建议改动密码学代码去修一个不存在的问题。**

## 三、真实局限（架构选择，已在参考实现中补充说明）

### 3.1 不检测验证人分叉签名（equivocation）

`lastRemoteHeight` 是**逐 Token** 的，`usedProofs` 是全局的。若 quorum 在同一高度对两个不同 root 签名，不同 Token 可从不同分叉各自完成终局，合约不会察觉冲突。

规范 Security Considerations 已把 equivocation、quorum 唯一性、远端分叉列为 Profile MUST address，本参考 Profile 不实现检测。这是范围划分，不是遗漏，但复制该参考的实现者应当明确知道。

### 3.2 验证人集合不可变，无轮换与吊销

`isFinalityValidator` 在构造函数写入后不可修改，`validatorSetHash` 与 `finalityThreshold` 均为 immutable。因此验证人私钥一旦泄露即永久有效，合约层无恢复手段；唯一兜底是持有人在 deadline 后取消交割。

规范已写明"Fixed validator sets are suitable only where their lifecycle and recovery assumptions are acceptable"，措辞与实现一致。生产 Profile 应改用远端账本原生的轻客户端与验证人集合转换规则。

### 3.3 提交者侧 gas

`signatures` 与 `siblings` 长度无上限，超长输入只消耗提交者自身 gas，不影响合约可用性，且严格递增签名者约束把有效签名数限制在验证人集合规模内。

## 四、建议

1. 上述三项局限已作为注释写入参考实现文件头，避免实现者静默继承。
2. 不改动证明验证代码。2.1 与 2.2 的分析结论是：当前实现正确，改动只会引入风险。
3. 生产 Profile 落地时，3.1 与 3.2 必须由该 Profile 显式解决，并按规范要求公开披露其验证器与升级权限。
