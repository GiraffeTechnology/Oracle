# 更新版外部审计意见吸收记录

日期：2026-08-29  
输入：`ERC_AUDIT_OPINION_UPDATED_ZH(1).md`  
输入 SHA-256：`1040B59716517CDB8E6D4C0EF289D5C1CC55551AB77255DEBAA57D2BC1FC9AE0`

| 审计意见 | 当前处理 |
| --- | --- |
| Copyright 必须逐字匹配 | 已匹配官方 `Copyright and related rights waived via [CC0](../LICENSE.md).` |
| Test Cases 在 Reference Implementation 前 | 已按官方 `config/eipw.toml` 排序。 |
| 不使用非白名单二级章节 | 当前二级章节与官方顺序逐项一致。 |
| EIP-712 使用相对链接 | V8 proof model 已完全移除 EIP-712/1271 依赖；该项 superseded/not applicable，门禁禁止旧残留。 |
| Motivation 缺具体场景 | 已加入三个中性 illustrative 场景并排除法律结论。 |
| 缺 W3C VC/EAS 对照 | 已加入 Rationale，差异限定为完整字段 proof binding 与 ERC-721 原子变更。 |
| 资产目录布局 | 提交准备包使用 `assets/eip-xxxx/`；编号由编辑流程产生。 |
| 官方格式检查 | 官方 `eipw 0.11.0` 对合成占位替换副本运行 PASS / 0 diagnostics；正式用户名和讨论 URL 填入后仍须在目标 fork 跑当时最新版 eipw。 |

该审计基于旧 Authority 模型的 30 项测试和两个 authorization typehash 的事实已经被 V8 设计取代；当前结论只采纳仍适用于 proof model 的格式、动机和 prior-art 建议，不把旧模型结论迁移为当前 PASS。
