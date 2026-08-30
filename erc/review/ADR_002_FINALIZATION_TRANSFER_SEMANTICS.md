# ADR-002：最终确认采用非回调转移

- 状态：Accepted
- 日期：2026-08-27

## 决定

`finalizeSettlement` 原子更新证书、holder 与交割状态，但不调用 `onERC721Received`。调用者和实现 Profile 必须在发起前确认合约接收方能够控制或转移该 Token。

## 理由与影响

这避免在证书与 holder 的原子状态转换中执行不受信外部回调。代价是转入不具控制能力的合约可能使 Token 不可访问，因此风险必须披露并由调用方检查。参考测试包含非 `ERC721Receiver` 合约接收方，冻结该行为；不改变 selector 或 interface ID。
