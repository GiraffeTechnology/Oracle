# CI 与审计交接（PRD v0.3）

## 权威对照

只使用以下现行文件：

1. `docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md`；
2. `docs/ACCEPTANCE_RWA_ORACLE_ZH.md`；
3. `config/prd-v0.4-acceptance.json`；
4. `scripts/verify-prd-v0.4.mjs`；
5. `docs/STATUS.md`。

旧 `PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md` 仅保留历史审计，不得覆盖新基线。I0–I12 仍作为交付分解使用，但 `config/iteration-acceptance.json` 与 `verify-iterations.mjs` 已强制绑定 v0.3 的 ORACLE/CONSUMER/NFR 编号；任何遗漏、未知编号或版本漂移均失败关闭。

## CI 顺序

```text
pnpm install --frozen-lockfile
node scripts/syntax-check.mjs
node --test --test-reporter=spec "test/*.test.js"
node scripts/repository-scan.mjs
node scripts/product-boundary-scan.mjs
node scripts/verify-release.mjs
node scripts/verify-prd-v0.4.mjs
```

`verify-prd-v0.4.mjs` 在任何适用门禁未满足时必须非零退出。当前工程候选预期为 ORACLE-001~011、CONSUMER-001~009、NFR-001~003 本地验证通过；NFR-004 和 Stage A/D/F 保持 `PENDING-GATE`，`allComplete=false`。

## 必查项

- 每个 ORACLE/CONSUMER/NFR ID 均有代码、正向/负向测试和准确状态；测试名称存在本身不构成语义通过。
- `CONSUMER-*` 只验收 Oracle 侧可强制性，不得误判为本项目实现 L3/ERC/NFT。
- 未知来源、任意端点、冲突、过期、撤销、乱序、重放和依赖不可用均 fail closed。
- 证明必须绑定资产、链、合约、Token、用途、nonce、有效期、来源和撤销引用。
- 一物一证一 Token；重复指纹、仓单、当前证书及任何份额化请求必须拒绝。
- T+0 不等于交割完成；T+3 必须验证登记变更、新旧证书、仓储、钱包绑定、版本和前序哈希。
- API/schema/UI/合同不得生产主体合规结论或金融输出；`transferEligibility` 只能表示资产侧事实。
- 公开 API/UI 不得泄露持有人承诺、身份映射、内部仓库标识、证书/仓单原文、密钥、端点或拓扑。
- MySQL 迁移、自空库、备份、独立恢复、反向迁移及 schema/种子校验必须实测。
- PR、commit、CI 启动或自声明 PASS 不得改变证据状态。
- 八类 NFR-004 摘要、P1–P8、单次完整 CI 与最终合同/go-no-go 必须通过仓库验证器，并绑定同一 40 字符候选 commit；历史提交证据不得拼接。
- 72 小时证据必须真实持续至少 259200 秒、最大采样间隔不超过 120 秒、可用性不低于 99.9%，不得重启、续跑或缩短。

## 不可伪造的外部证据

NFR-004 与 Stage F 至少需要真实安全扫描、正式性能/容量、连续 72 小时且可用性不低于 99.9%、MySQL 恢复/PITR、受保护签名人轮换、数据保护/事件响应、可复现签名构建、独立法律/隐私/安全/合约/运营审查、P1–P8 取证、范围契约及逐司法辖区 go/no-go。空文件、mock、截图或操作者陈述均不能替代。

## 输出格式

按 ID 使用验收标准规定的六值状态，引用确切 commit、文件、测试、命令、证据 SHA 和缺口。最后单列 G-A~G-F、P1~P8、§0.1 裁决与 §0.2 契约。只有全部适用项在同一 commit 为 `VERIFIED` 且真实外部门禁齐全，才允许 `allComplete=true`。
