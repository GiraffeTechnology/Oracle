# Claude Code CI 与审计交接

## 权威对照

Claude Code 应以以下文件为验收依据：

1. `docs/PRD_RWA_ORACLE_PROTOCOL_L2_L3_ZH.md`：定义产品和 I0–I12 要求；
2. `docs/PRD_DELIVERY_ACCEPTANCE_STANDARD_ZH.md`：定义“可验证”的交付证据；
3. `config/iteration-acceptance.json`：机器可读的迭代—文件—测试—外部证据映射；
4. `scripts/verify-iterations.mjs`：统一验收入口。

不得以 PR 描述、提交数量或“测试计划已写”替代上述证据，也不得降低 PRD 条件使结果变绿。

## 建议 CI 顺序

```text
node scripts/syntax-check.mjs
node --test "test/*.test.js"
node scripts/repository-scan.mjs
node scripts/verify-release.mjs
node scripts/verify-iterations.mjs
```

`verify-iterations.mjs` 在任何迭代缺证据时必须返回非零。当前预期 I0–I11 可由仓库本地证据验证；
I12 在八份真实证据全部通过前应保持阻断。

## I12 不可伪造证据

以下文件必须来自实际执行或独立审查，不得由 CI 生成空壳 PASS：

- `evidence/acceptance/i12-security-scans.json`；
- `evidence/acceptance/i12-performance-capacity.json`；
- `evidence/acceptance/i12-72h-stability.json`；
- `evidence/acceptance/i12-restore-drill.json`；
- `evidence/acceptance/i12-signer-rotation.json`；
- `evidence/acceptance/i12-data-protection-response.json`；
- `evidence/acceptance/i12-reproducible-build.json`；
- `evidence/acceptance/i12-independent-reviews.json`。

验证器要求：稳定性实际连续时间不少于 259200 秒；恢复演练达到声明的 RPO/RTO 并验证数据库与
审计头；轮换后新签名人有效、旧签名人无效且未观察到私钥材料；安全、隐私、法律三类独立审查
全部接受且没有未接受 P0。仅创建同名文件不能通过。

## 审计重点

- 检查验收测试是否仅匹配测试名称而没有验证真实语义；
- 检查 default/production 配置是否仍 fail-closed；
- 检查 L2 Ed25519 证明与 L3 EIP-712/ERC-1271 授权边界，不把两者误称为同一签名；
- 检查历史记录、撤销、Pending、Finalize 和 conflict 是否存在部分写入；
- 检查 admin、export、subscription、source adapter 的权限、重放和恢复路径；
- 检查仓库、日志、测试制品及 PR diff 中的秘密、个人资料和明文公网地址；
- 检查 ERC Working Draft 哈希及 interfaceId 漂移是否失败关闭；
- 检查 I12 外部证据的来源、时间、完整性哈希和审查独立性。

## 结果格式

审计结果应逐迭代给出 `PASS/BLOCKED/FAIL`、对应文件、命令、测试、原始证据哈希、缺口和建议。
只有 I0–I12 全部 `PASS` 且 `iteration-acceptance-report.json` 的 `allComplete=true`，才可声明
“13 个迭代按 PRD 可验证交付完成”。生产上线和主网授权仍须另行批准。

