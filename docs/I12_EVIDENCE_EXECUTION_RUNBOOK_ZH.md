# I12 外部证据执行手册

I12 的实现和验证器已经进入仓库，但 I12 只有在实际证据通过后才能完成。本手册禁止用模板、短测、
mock 成功或自我声明替代 PRD 要求。

## 必需证据

| 证据 | 最低要求 |
| --- | --- |
| security-scans | SAST、依赖、秘密、容器、IaC、API、渗透全部 PASS；无未接受 P0 |
| performance-capacity | 标明负载模型、完成请求数、p95、最大积压及故障注入结果 |
| 72h-stability | 实际连续不少于 259200 秒、至少 4320 个样本、无未解释失败 |
| restore-drill | 数据库与审计头完整；实际 RPO/RTO 不超过目标 |
| signer-rotation | 新签名人通过、旧签名人拒绝、轮换可审计、未观察私钥材料 |
| data-protection-response | DPIA、保留、删除、事件响应演练和 go/no-go checklist 完整 |
| reproducible-build | 两次独立构建哈希一致；SBOM 与制品签名验证通过 |
| independent-reviews | 安全、隐私、法律三方独立接受；无未接受 P0 |

## 验证

证据应放入 `evidence/acceptance/`，随后运行：

```text
node scripts/verify-i12-evidence.mjs
node scripts/verify-iterations.mjs
```

证据文件可只包含公开审计引用和摘要，不得提交凭据、密钥、个人资料、真实端点或保密报告正文。
`artifactSha256` 应指向受控保存的原始报告。审计人员必须能通过该引用取得原件并重新计算摘要。

CI 可以验证格式、哈希引用和数值门禁，但不能自行宣称完成独立法律审查、真实恢复演练或 72 小时
运行。任何一项缺失时，I12 和整体 `allComplete` 必须保持 false。

