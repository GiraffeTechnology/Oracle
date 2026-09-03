# 变更记录 —— 提交前外部评审

日期：2026-09-02
触发：提交前外部评审（见交付件 `06_提交前评审_ERC提案.md`）
基线：commit c78fe74（`candidateSha256` 1c89321f…）

> **本次变更未经编译与测试验证。** 编辑环境无 Solidity 编译器、无网络，`npm install`、`npm test`、eipw 均无法执行。参考实现与测试套件在**未构建**状态下被修改。四道门必须在提交前重跑。账本 `status` 已由 `PREP_READY` 改为 `GATES_PENDING`，`tools/verify-package.mjs` 的断言已同步，未绕过。

---

## A2 移除规范性文件中的测试夹具

`assets/eip-xxxx/contracts/RegisterProjectionReference.sol` 末尾的 `contract NonReceiverContract {}` 已删除。

该合约在 `test/protocol.cjs` 中完全未被引用，是死代码，且该文件属于上游提交清单。规范性资产中不应含测试脚手架。

---

## A3 结算权限与 ERC-721 授权解耦

### 与既有裁定的关系

账本记录 `reviewerReviewPostRewrite` 载明，BLOCKER-1 于 2026-09-02 被撤回，理由是「supersede 需要持有代币，骚扰属于自伤」。

**该理由未被本次变更推翻，本次变更基于另一条它未处理的问题：**

在以 `ownerOf` 派生权限的设计下，**登记官没有任何途径推动投影**。只有 ERC-721 授权方能调用 `beginSettlement`，因此登记册的责任方无法记录自己已经作出的变更，完全依赖持币人配合。对产权登记处、股东名册管理人这类主体，这与提案自身「投影属于登记册，不属于市场」的主张相反。

骚扰问题只是次生结果：以 `ownerOf` 派生权限，会在**每一次转让时重新**把扣留位置授予新的买方。

### 改动

规范正文：

- 新增定义 **settlement authority**
- 新增规范性小节 **Settlement authority**：`isSettlementAuthority` MUST 报告权限并对不存在的代币 revert；profile MUST 定义策略；profile SHOULD 授予登记册责任方，SHOULD NOT 仅由 `ownerOf` 派生；profile SHOULD 约束 supersede
- `beginSettlement` 的授权条件由「an authorized ERC-721 caller」改为「a caller for which `isSettlementAuthority` returns true」
- Register interface 一节中「settlement authorization is that contract's own ERC-721 authorization」一句删除并改写
- Rationale 增加一段说明为何权限不取 `ownerOf`
- Security Considerations 扩充：`isSettlementAuthority` 使权限可读，但可读不等于可接受；并指出以 `ownerOf` 派生会使扣留问题恶化

接口：`IProjectionSettlement` 新增

```solidity
function isSettlementAuthority(uint256 tokenId, address account)
    external view returns (bool authorized);
```

参考实现：新增 `registrar` immutable，构造函数签名变为
`constructor(bytes32 remoteRegisterId_, address registrar_, address[] memory validators_, uint8 threshold_)`。
`isSettlementAuthority` 返回 `account == registrar`。这是参考 profile 的最简策略，不是规范要求。

**注**：如果决定维持原设计，回退方式是把 `isSettlementAuthority` 的实现改回 `_isAuthorized(account, tokenId)`，规范中的 SHOULD NOT 相应删除。接口本身仍值得保留——第三方需要能查询权限归属。

---

## B1 终局性检查点改用完整 EIP-712

原实现使用 EIP-712 的 typehash 字符串写法，但摘要是裸 `keccak256(abi.encode(...))` 直接送入 `ecrecover`，无 domain separator、无 `\x19\x01` 前缀。leaf 绑定了 chainid 与合约地址，`usedProofs` 键在 `(finality, leaf)` 上，因此实际可利用性有限；但 finality 摘要自身不含链与合约绑定，验证人签署裸 32 字节摘要是跨用途重放的典型形态。

改动：新增 `EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)`，name 为 `AsynchronousRegisterProjection`，version 为 `1`。domain separator 在构造时缓存，链 ID 变更时重建，并通过 `DOMAIN_SEPARATOR()` 公开。finality 摘要改为
`keccak256(abi.encodePacked(hex"1901", DOMAIN_SEPARATOR(), structHash))`。

---

## B2 Merkle 域分离与索引耗尽

原 `_verifyMembership` 每层均为 `keccak256(abi.encodePacked(value, sibling))`，叶与内节点无标签区分（第二原像的经典形态），且 `index` 中超出 `siblings.length` 的高位被忽略，使多组 `(index, siblings)` 可验证到同一 root。

改动：叶为 `keccak256(abi.encodePacked(0x00, leafStruct))`，内节点为 `keccak256(abi.encodePacked(0x01, left, right))`；验证末尾要求 `index == 0`。

规范 Test Cases 增加一条对应要求。

---

## B3 `cancelSettlement` 移除恒空参数

原签名 `cancelSettlement(bytes32, bytes32, bytes calldata proofData)`，而实现要求 `proofData.length == 0`。恒为空的参数是接口冗余。新签名 `cancelSettlement(bytes32 settlementId, bytes32 reasonHash)`，规范正文中「using empty `proofData`」一语删除。

---

## B4 `effectiveAt` 前向上界

原实现对 `effectiveAt` 不作任何校验。配合严格递增不变量，一个过远未来的生效时刻会永久终结该代币的投影，且无恢复路径——Security Considerations 已承认该问题但未给出任何约束。

改动：规范在不变量 3 后增加 SHOULD；参考实现新增 `MAX_EFFECTIVE_AHEAD = 30 days`，在 `mint` 与 `finalizeSettlement` 中校验，新增 `EffectiveAtTooFar` 错误。

---

## B6 内部记录字段计数订正

`review/NOVELTY_INDEPENDENT_ASSESSMENT_ZH.md` 原称 leaf 绑定「全部 13 个字段」。实际 `REMOTE_ENTRY_LEAF_TYPEHASH` 为 11 个字段（`abi.encode` 含 typehash 共 12 项）。已订正为 11。

---

## 接口标识

| | 变更前 | 变更后 |
| --- | --- | --- |
| `IRegisterProjection` | `0x6309e170` | `0x6309e170`（未变） |
| `IProjectionSettlement` | `0xfd0f6337` | **`0xf4a7d71b`** |

由 selector XOR 独立复算得出。该复算方法先以变更前的接口定义复现了两个既有冻结值，确认无误后才用于新定义。测试内的断言已同步，运行测试时会再次交叉验证。

`VERIFICATION_PROFILE` 由
`erc-xxxx/reference-profile/fixed-validator-set+keccak-merkle/v1`
改为
`erc-xxxx/reference-profile/fixed-validator-set+eip712+tagged-keccak-merkle/v2`。
证明规则已变，profile 标识必须随之变化——否则消费方无法据其判断自己是否会验。

---

## Magicians 首帖

- **补入 ERC-5805 + ERC-6372 的对比段落，置于 ERC-7965 之前。** 查重文件早已指出「评审人一定会问这不就是 `getPastVotes` 吗」，规范正文的 Prior art 已处理，首帖此前遗漏。投影侧最近邻不出现在首帖，第一条回复很可能就是这个问题。
- 新增 **Who may open a gap is not `ownerOf`** 小节。
- leaf 字段描述由笼统表述改为明确的 11 项列举，并补入 registryReference（原描述漏列）。
- 「a fixed validator set signing a domain-separated checkpoint」改为「signing an EIP-712 checkpoint, plus a tagged Merkle membership proof」——原措辞在 B1、B2 修复前并不准确。
- 删除「27 local-EVM tests」的具体计数（未复验，不作断言）。
- 反馈征询项增加 supersede 的约束程度。

---

## 测试

新增 4 项：

1. 结算权限限定于 registrar 而非 `ownerOf`——含转让后新持有人仍无权限的断言
2. 拒绝过于超前的 `effectiveAt`
3. 以其他 domain separator 签出的证明被拒（EIP-712 绑定生效）
4. 索引携带超出路径长度的位时被拒

原有用例中 `beginSettlement` / `cancelSettlement` 的调用方由 `owner` 改为 `registrar`；leaf 与 finality 摘要的构造同步为带标签与 EIP-712 形式；接口 ID 断言更新。

用例总数由 27 增至 31。**该数字为静态计数，非执行结果。**

---

## 提交前必须完成

1. `cd assets/eip-xxxx && npm install && npm test` —— 确认 31 项全通过、0 编译告警
2. 官方 eipw 0.11.0 + `tools/eipw-official-config-snapshot.toml`，含负向对照
3. 若测试实测通过，将账本 `pendingGates` 清空、`status` 改回 `PREP_READY`，并同步 `tools/verify-package.mjs` 的断言
4. 以实测结果重写 `TECHNICAL_VALIDATION.txt`
5. 重建 `FILE_INDEX_SHA256.txt` 并跑 `tools/verify-package.mjs`
6. 签发 `PUBLISH_AUTHORIZATION_TEMPLATE_ZH.md`
7. 发 Magicians 帖 → 填 `discussions-to` → 再跑一次四道门 → 提 PR
