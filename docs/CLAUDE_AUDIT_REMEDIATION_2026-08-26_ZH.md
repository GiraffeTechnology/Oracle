# Claude Code 审计修复记录（2026-08-26）

## 基线裁决

本轮将 `GAP_AUDIT_ZH.md`、`DECISIONS_ZH.md` 和 `TESTNET_TASK_HOODI_ZH.md` 作为审计输入，不把其中内容视为新的授权。权威文件仍是仓库内逐字节匹配的：

- `docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md`，SHA-256 `1e062b444c56e7683a0476e8b92688b525e34d349e3724ada31f64be1d48a912`；
- `docs/ACCEPTANCE_RWA_ORACLE_ZH.md`，SHA-256 `13231a4aa4f6906c1e8c56c7274e1649b0e577c6f2f2375080252f2e564c9af4`。

## 已验证为过期的报告缺口

当前候选已具备：ORACLE-011 资产详情与四种交割展示状态、CONSUMER-007 `REDEEMED` 终态、ORACLE-005 主体合规字段递归拒绝、完整九状态生命周期、七项发行前置条件、退款义务事件以及 P1–P8/Stage F 的结构化证据验证器。以上仍须由本轮回归测试重新证明，不以本记录替代测试。

## 本轮真实修复

1. 将 I0–I12 清单从废止的 v0.4 重新绑定至权威 v0.3；每个迭代具有明确 `requirementIds`，验证器拒绝版本漂移、未知编号和漏映射。
2. 将迭代测试命令固定为 Node `spec` reporter，消除默认 TAP 输出导致的具名测试假阴性。
3. 增加追踪回归测试，机械证明恰有 13 个迭代且覆盖全部 ORACLE/CONSUMER/NFR 编号。
4. 纳入 Claude 分支提出的 CI 结构，并按 v0.3 的 11 个强制 job ID 改写；workflow/PR/CI 运行本身均不形成验收证据。
5. Hoodi 脚本继续使用真实区块时间轮询、动态 chainId 校验、ArtFi1/ArtFi2 双角色和独占证据日志；链上执行仍受钱包、SIN、nonce 与广播门禁约束。

## 仍然阻断

NFR-004、P1–P8、Stage A/D/F、连续 72 小时、正式负载/容量/故障、MySQL 生产等价恢复、受保护测试签名人轮换、合格安全扫描/渗透、数据保护/事件响应、可复现签名制品以及五类独立审查均必须由同一新候选提交的真实证据满足。旧候选的运行证据不能移植到新提交；不得据此标记 `allComplete=true`。
