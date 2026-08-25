# Giraffe RWA Oracle v0.3 证据快照

本文件是状态索引，不是完成声明。权威需求为 `PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md`，权威验收规则为 `ACCEPTANCE_RWA_ORACLE_ZH.md`。任何提交、推送、PR 或 CI 启动均不自动改变状态。

## 当前状态

| 范围 | 状态 | 证据边界 |
| --- | --- | --- |
| ORACLE-001~011 | `VERIFIED`（本地工程候选） | `npm run verify:prd` 中的语法、97+ Node 测试、仓库扫描与逐 ID 验证；仍需同一 commit CI 复验 |
| CONSUMER-001~009 | `VERIFIED`（Oracle 侧合成消费者） | 仅证明 Oracle 侧可以强制 fail-closed；不表示 L3 ERC 已实现或部署 |
| NFR-001~003 | `VERIFIED`（本地工程候选） | 受保护签名适配、双人控制、顺序/重放与来源故障注入 |
| NFR-004 | `PENDING-GATE` | 真实 72 小时、正式负载/容量、恢复、受保护签名人轮换等验收证据未齐 |
| PREMISE-P1~P8 | `PENDING-GATE` | 书面依据、取证日期、复核周期与责任人尚未形成全部可公开审计记录 |
| Stage F | `PENDING-GATE` | 独立法律、隐私、安全、合约、运营审查，以及范围/报价和逐司法辖区 go/no-go 未齐 |

机器可读快照由 `scripts/verify-prd-v0.3.mjs` 生成至 `output/prd-v0.3-acceptance-report.json`。该脚本在任何适用门禁未满足时必须非零退出并保持 `allComplete=false`。

## 产品线裁决

当前按 PRD §0.1 的“裁决 A：独立产品线”实现：Oracle 仓库不依赖、不复用 ArtFi 的份额化合约、交易模块、数据库或 37×100 慈善资产数据集。正式签署的商务范围变更仍属于 Stage F 门禁。

## 数据安全

仓库只包含合成数据。生产密钥、真实个人资料、完整证书、完整仓单、服务器地址和凭据均不得进入 GitHub、CI 输出或公开 API。
