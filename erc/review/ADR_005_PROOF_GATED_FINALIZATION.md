# ADR-005：远端最终状态证明门控交割

状态：Accepted for V8 Working Draft

## 决定

保留 V7 的 ERC-721 Pending 与 begin/finalize/cancel 外形，但废止 Authority/Oracle 签名作为 finalize 真值来源。`finalizeSettlement` 的最后一个 `bytes` 参数保持 ABI 类型不变，语义改为远端 finality + membership proof。

对任一成功 finalization，必须满足：

`FinalizedLocal(s) => FinalRemote(h, root) AND Member(root, Bind(localChain, contract, tokenId, s, from, to, snapshot, oldCommitment, newCommitment, reference, version, effectiveAt, anchor)) AND h > lastHeight[tokenId]`

证明消费、新 commitment、holder 变化和 settlement 关闭必须属于同一原子状态转换。

## 理由

Authority 即使签名绑定全部本地字段，也只能证明 Authority 作出断言，无法证明相应记录存在于目标联盟链最终状态。远端共识证明与 membership 把可篡改的中间 Oracle 从真值路径移除；完整本地绑定防止合法 proof 被换链、换合约、换 Token、换接收方或换 commitment 使用。

## 明确不主张

IBC/light client、Merkle proof、阈值签名和 trustless relayer 均有充分先例。本 ADR 的窄贡献是它们与 ERC-721 Pending settlement、完整 leaf binding 及原子 holder transition 的强制组合。

## 后果

- `certificateAuthority` 只保留为非零元数据，允许等于 holder。
- cancel 仅由记录的 from 用空 proofData 执行，不依赖远端 proof 或 Authority。
- 固定 validator set 只作为 reference Profile；生产 Profile 推荐远端原生 light client/finality 和 validator-set transition。
- 协议证明远端最终状态包含某记录，不证明现实资产事实或法律效力。
