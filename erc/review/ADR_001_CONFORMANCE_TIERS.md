# ADR-001：分级符合性

- 状态：Accepted
- 日期：2026-08-27

## 决定

协议定义两级符合性：实现并通过 ERC-165 声明 `IVersionedCertificate`（`0xebaa86a0`）即为证书符合；在此基础上实现并声明 `IDeferredCertificateSettlement`（`0x2773d4c9`）才是交割符合。证书符合实现不得声明交割接口或声称交割符合。

## 理由与影响

证书历史可以独立复用，递延交割不应成为所有实现的强制配置。该分级不改变任何函数 selector 或冻结 interface ID。金融、监管或法律合规不属于这两级技术符合性的判定条件，也不能替代它们。
