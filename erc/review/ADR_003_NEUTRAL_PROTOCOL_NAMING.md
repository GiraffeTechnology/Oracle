# ADR-003：协议采用中性命名

- 状态：Accepted；V8 proof model 修订
- 日期：2026-08-29

## 决定

规范标题为 `Proof-Verified Deferred Asset Settlement`；接口为 `IVersionedCertificate` 与 `IDeferredCertificateSettlement`；参考实现为 `VersionedCertificateReference`。

V8 不使用 EIP-712、ERC-1271 或 Authority authorization domain。证明域由 Profile 的 `RemoteFinality` checkpoint 和 `RemoteSettlement` leaf type 定义；当前参考值由源码与测试机械派生，不在本 ADR 复制为可漂移常量。

## 理由与影响

协议处理外部记录承诺、远端最终状态证明和延迟 ERC-721 交割，不应把某类资产、机构、产品、司法辖区或测试链写入通用接口。接口名称不参与 Solidity selector 或 ERC-165 interface ID；`0xebaa86a0` 与 `0x2773d4c9` 保持不变。

旧 V3–V7 关于 `Versioned Certificate Settlement` EIP-712 domain 和两个 authorization typehash 的记录只描述已废止的 Authority 模型，不是当前候选要求。
