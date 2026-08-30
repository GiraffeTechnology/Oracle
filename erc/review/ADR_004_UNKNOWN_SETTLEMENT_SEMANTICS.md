# ADR-004：未知交割标识与 NONE 语义

- 状态：Accepted
- 日期：2026-08-27

## 决定

`settlement(unknownId)` 必须 revert。`pendingSettlementOf(tokenId)` 在无待处理交割时返回 `bytes32(0)`。`NONE` 仅是未使用标识的内部零状态，不是成功 `settlement` 查询可观察到的记录。

## 理由与影响

revert 可区分“不存在”与合法记录，避免消费者把全零结构误当成真实交割。pending getter 的零值保留高效发现能力。行为由公开测试固化，不改变 ABI、selector 或 interface ID。
