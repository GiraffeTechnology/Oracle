# I12 合成签名人轮换演练

## 边界

本演练仅用于验证 Oracle I12 轮换控制的软件行为，不是生产 HSM、受保护签名服务或正式轮换仪式的替代证据。输出必须保持 `acceptanceEligible=false`，不得复制为 `evidence/acceptance/i12-signer-rotation.json`，也不得据此把 I12 标记为完成。

演练只使用进程内临时生成的 Ed25519 合成密钥。禁止使用 ArtFi1/ArtFi2、生产钱包、真实私钥、助记词或密钥路径；禁止 RPC、网络、广播、业务交易和 nonce 操作。

## 验收步骤

1. 进程内生成 old/new 两组一次性 Ed25519 KeyObject，不导出私钥。
2. 验证 old signer 在轮换前可签发并验证合成 attestation。
3. 向 `AuditJournal` 依次写入 requested、new-activated、prior-retired 三个公开哈希事件。
4. 验证 new signer 在轮换后可签发并验证。
5. 验证 old signature 在新 signer set 下返回 `SIGNATURE_INVALID`。
6. 验证 retired old signer 的验证和新签发均返回 `SIGNER_SET_NOT_ACTIVE`。
7. 验证审计哈希链完整，并确认修改中间事件后链校验失败。
8. 公开报告只包含 signer-set 标识、公钥指纹、事件哈希和布尔结果；扫描禁止私钥、助记词、seed 和 raw transaction 字段。

## 执行

仅输出到 stdout：

```text
node scripts/run-i12-synthetic-signer-rotation.mjs
```

一次性写入固定本地结果文件（使用 exclusive-create，已有文件时拒绝覆盖）：

```text
node scripts/run-i12-synthetic-signer-rotation.mjs --write-fixed-output
```

固定结果为 `output/i12-synthetic-signer-rotation.json`。复核者应另外计算脚本和结果文件 SHA-256，并确认：

- `newSignerAccepted=true`；
- `oldSignerRejected=true`；
- `rotationAudited=true`；
- `auditChainVerified=true`；
- `tamperedAuditChainRejected=true`；
- `privateMaterialObserved=false`；
- `networkUsed=false`、`rpcUsed=false`、`transactionSigned=false`、`nonceConsumed=false`；
- `acceptanceEligible=false`。

正式 I12 仍需在受保护生产等价签名设施中完成独立轮换仪式，并由外部证据链证明私钥材料未被审计人员观察。

