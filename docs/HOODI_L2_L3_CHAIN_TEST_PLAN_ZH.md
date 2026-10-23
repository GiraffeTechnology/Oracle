# Giraffe Oracle L2–L3 Hoodi 链上测试方案

## 0. 文档控制

| 项目 | 内容 |
| --- | --- |
| 状态 | `BLOCKED_BEFORE_PREFLIGHT`；等待受控 broker、ERC 冻结输入及第 5 节门禁的权威结果 |
| 首选网络 | Hoodi testnet |
| 固定 chainId | `560048` |
| L2 配置 | `giraffe-oracle-l2/production-v1`（以合成/隔离依赖执行） |
| L3 Profile | `giraffe-rwa-certificate-settlement/wd-0.1.1` |
| 测试资产 | `UNIT-A39`，仅测试、无价值、无法律效力、不转移现实权利 |

本方案验证 Oracle L2 事实、证明、撤销和状态映射能否被 L3 Working Draft 合约正确消费。
它不构成主网授权、ERC 正式编号、真实资产登记、NFT 正式发行、销售、金融化或法律权属确认。

### 当前阻断记录（2026-08-25）

- blocker：`CONTROLLED_BROKER_AND_PROTOCOL_GATES_PENDING`；
- W1/W2 ownership self-test: `NOT_VERIFIED`;
- W1/W2 ACL gate: `NOT_VERIFIED`;
- Pending: verify section 5 against current wallet and protocol evidence; do not reuse expired results;
- 尚未执行 Hoodi preflight、主网访问、业务签名、广播、转账或 nonce 占用；
- 本状态既不是测试失败，也不是验收通过；门禁完成后从第 5 节重新开始，不继承任何推测结果。

## 1. 测试目标

1. 在 Hoodi 测试网的实际 chain identity、区块时间、gas、nonce、交易 receipt 和 finality 条件下验证 L2–L3 边界。
2. 验证 L3 合约同时公开候选接口 `0xebaa86a0`、`0x2773d4c9` 及 ERC-8325
   `0x4a967b01`；缺少任一接口即失败。
3. 验证 Oracle 的 `VALID → TRANSFER_PENDING → VALID` 映射与合约
   `NONE → PENDING → FINALIZED/CANCELLED` 生命周期一致。
4. 验证 Pending 期间持有人仍为 `from`，全部 ERC-721 转移和批准路径均被阻断。
5. 验证 Finalize 在同一交易内完成证书版本 `+1`、追加历史、持有人转移、nonce 消耗和状态终结。
6. 验证过期、撤销、冲突、错误用途、错误主体、错误链、错误合约、错误 nonce 及错误签名全部失败关闭。
7. Produce an independently reviewable on-chain evidence package without secrets.

## 2. 冻结输入与变更门禁

执行前必须逐字节复核以下 L3 产物锁；任一值不一致即停止：

| 产物 | SHA-256 |
| --- | --- |
| 中文正式工作稿 | `8179c5405674a3e54350261136c77470704f2460b9a0d7d6b28a506ab969224a` |
| 英文正式工作稿 | `300303bd7c9952b9a7fa78fcf5402572833883320cd3f3a519daf224a93e7b9a` |
| 英文提交候选 | `c335f2e10475cf96e5e78e092b826f82b937a9d0f2f0eee8c647296fc2b952fc` |
| Solidity 参考实现 | `9e27355d8826915119b1651e77d8db0a3bec93ab7e9485c642d8417ae96b3951` |
| 测试向量 | `e70985ce2ba848c7b5c27032947dc85291ad6026c708f11c9c49b39d10a7b361` |

ABI、interfaceId、EIP-712 type string、`authorityData` 编码或参考实现发生任何变化时，必须创建
新版本 Profile 并重新完成本方案，不得直接替换哈希继续执行。Working Draft 的 custom error selector
和事件顺序不是稳定协议接口，测试不得依赖 revert string、错误 selector 或日志顺序判断合规。

## 3. Component and control boundaries

### 3.1 Oracle

- 提供锁定的 L2/L3 Profile、合成 Oracle 证明、撤销/到期/冲突负向向量和预期结果；
- 在广播前验证资产、证书、仓储、前序证书、用途、主体和状态的一致性；
- 对 receipt、事件、合约查询结果和 Oracle 审计事件进行对账；
- 不读取钱包秘密，不签 EVM 交易，不管理钱包 nonce，不广播交易。

### 3.2 Protocol reference implementation

- 从冻结参考实现生成 ABI、bytecode、init-code hash、selector、calldata hash 和 EIP-712 digest；
- 维护 17 项协议测试及 Hoodi runner；
- 不替 Oracle 判断链下事实，不替钱包任务读取或使用私钥。

### 3.3 Controlled wallet signer

- Exclusively manage W1/W2 ownership self-tests, balances, pending nonces and exact offline transaction signing;
- 只接受 chainId、from、nonce、value、init-code/target、selector、完整 calldata 及 policy hash
  全部钉死的单笔请求；
- Use the configured Hoodi-only controlled route for estimate, simulate, broadcast, receipt and finality;
- 每个钱包严格串行管理 nonce；receipt/finality 未完成前不得签署其下一笔交易；
- 返回公开地址、交易哈希、区块、gas、状态和摘要，不返回私钥、助记词、密钥引用、raw signed tx、
  RPC、服务器地址或凭据；
- 任意请求与批准 manifest 不一致时拒绝，不自行修改 calldata、gas 语义、recipient 或网络；
- DAO governance is outside these test cases; do not trigger proposals, voting or asset governance.

## 4. 钱包和测试角色

| 逻辑角色 | 公开地址 | 用途 |
| --- | --- | --- |
| W1 | `<TEST_WALLET_1_ADDRESS>` | Test administrator, operator, deployment and destination holder |
| W2 | `<TEST_WALLET_2_ADDRESS>` | Initial test holder and settlement `from` |
| Test Authority | 每轮临时生成并仅公开地址 | 只签锁定的 EIP-712 测试授权；不持币、不签交易 |

Configured wallets are test-only and must not receive or operate real-value assets. W1/W2 use only valueless Hoodi test currency for gas; every call has `value=0`. Do not claim, move or use mainnet assets. Other test wallets are outside these EVM roles and must not contribute to W1/W2 balance or nonce calculations.

## 5. P0 执行前门禁

下列门禁必须一次性全部通过：

1. 固定通道证明网络为 Hoodi、chainId=`560048`，并以注册表中的完整 genesis 值通过身份门禁；
2. The 63 local Oracle tests pass, and the pinned protocol reference implementation has corresponding passing test evidence;
3. 第 2 节五项原始字节哈希全部匹配；
4. `UNIT-A39` manifest 与资产字节哈希匹配，标签包含
   `TEST ONLY / NO VALUE / NO LEGAL EFFECT / NO RIGHTS TRANSFER`；
5. W1/W2 ownership self-tests, ACL checks and address matching pass;
6. 两钱包余额足以覆盖审计后的 gas upper bound，并保留失败重试缓冲；
7. pending nonce 已读取并建立单任务、单钱包排他锁；
8. 每项部署 init-code hash 与调用 target/selector/calldata hash 已形成只读 manifest；
9. estimate 与 simulate 成功，且返回链身份已证明；
10. 证据目录位于仓库外，使用 exclusive-new、regular、non-reparse 文件；
11. 主网、未知链、任意 RPC、任意签名、faucet、swap、bridge、定时器和并发广播均被拒绝；
12. 没有真实个人资料、完整证书、精确仓储位置或保密登记文件进入请求、日志或链上数据。

任一门禁失败即停止，不得改用浏览器钱包、明文私钥、任意 RPC、其他链或手工 nonce 绕过。

## 6. 测试阶段与用例

### Stage A：只读预检

| ID | 用例 | 预期结果 |
| --- | --- | --- |
| H-A01 | chain identity、latest block/time、fee | Hoodi/560048 且 identity attested |
| H-A02 | W1/W2 余额和 pending nonce | 余额满足预算；nonce 可建立排他锁 |
| H-A03 | 五项协议产物和 UNIT-A39 哈希 | 全部精确匹配 |
| H-A04 | 编译产物、EIP-170 runtime size、init-code hash | 编译可复现、runtime 不超限、hash 固定 |
| H-A05 | 部署和调用 estimate/simulate | 成功且 value=0；无状态变化 |

### Stage B：部署和初始化

| ID | 用例 | 预期结果 |
| --- | --- | --- |
| H-B01 | 部署 test-only Asset Anchor Registry | receipt 成功，runtime hash 匹配 |
| H-B02 | 部署版本化证书/递延交割合约 | receipt 成功，constructor 参数和 runtime hash 匹配 |
| H-B03 | 可选部署 ERC-1271 Authority 测试实现 | 仅用于 ERC-1271 正负路径，不保存真实密钥 |
| H-B04 | 注册 UNIT-A39 test-only anchor | anchor active，链上仅出现允许的哈希和测试标签 |
| H-B05 | 初始化证书 v1 并将 Token 交付 W2 | owner=W2、version=1、历史长度=1、状态 NONE |

### Stage C：Oracle→协议正常流程

| ID | 用例 | 预期结果 |
| --- | --- | --- |
| H-C01 | 生成绑定 UNIT-A39/合约/Token/用途/有效期的 L2 证明 | 离线验证有效，公开字段最小化 |
| H-C02 | 三个 ERC-165 候选/依赖接口及已声明基础接口 | 必需接口为 true，`0xffffffff` 为 false |
| H-C03 | W2→W1 beginSettlement | owner 仍为 W2；状态 PENDING；Oracle 映射 TRANSFER_PENDING |
| H-C04 | Pending 时测试两个 safeTransferFrom、transferFrom、approve、setApprovalForAll | 全部失败且 holder/证书/nonce 不变 |
| H-C05 | 使用锁定的 authorityData finalize | 同一 receipt 内 version=2、owner=W1、nonce 已用、状态 FINALIZED |
| H-C06 | Finalize 事件集合 | 同一交易含 CertificateSuperseded、Transfer、SettlementFinalized；不依赖顺序 |
| H-C07 | Oracle 对账 | 链上 v2 hash、previous hash、holder、settlement 与 L2 审计记录一致 |

### Stage D：失败关闭和重放

| ID | 用例 | 预期结果 |
| --- | --- | --- |
| H-D01 | 错误 authority、错误用途或错误 subject | finalize 失败，全部状态不变 |
| H-D02 | 过期 authorityData | 失败且 nonce 不应被消费 |
| H-D03 | 已用 nonce 重放 | 失败且证书/holder 不变 |
| H-D04 | 修改 chainId、verifyingContract、tokenId、settlementId 或证书 hash | 域分离生效，签名无效 |
| H-D05 | Oracle 证明已撤销、过期或状态冲突 | Oracle 不生成可执行授权；不得提交广播 |
| H-D06 | 缺失任一必需 interfaceId | compatibility gate 失败，不得声明兼容 |
| H-D07 | 非连续证书版本或 previous hash 错误 | finalize 失败且无部分更新 |
| H-D08 | 重复 begin/finalize/cancel 或终态逆转 | 全部拒绝 |
| H-D09 | ERC-1271 错误 magic value、revert 或错误 signer | 失败且状态不变 |

### Stage E：真实时间和取消

使用最新链上时间生成短期 deadline，并等待真实 Hoodi 区块时间跨越 deadline。不得使用
`evm_mine`、`evm_setNextBlockTimestamp`、skip 或本地时间替代链上时间。

| ID | 用例 | 预期结果 |
| --- | --- | --- |
| H-E01 | deadline 前 holder 自行取消 | 拒绝 |
| H-E02 | deadline 前 Authority 授权取消 | CANCELLED；owner/证书不变 |
| H-E03 | deadline 后 W2 取消 | CANCELLED；owner/证书不变；Oracle 恢复 VALID |
| H-E04 | deadline 后 finalize | 拒绝 |

## 7. 交易签名与广播规程

每笔允许交易必须依次执行：

1. 读取 chain identity、pending nonce、fee，并对精确 unsigned transaction estimate/simulate；
2. 生成最长一小时有效的单笔 policy，钉死 chainId、wallet、from、nonce、value、gas、fee、
   init-code hash 或 target/selector/calldata hash；
3. The controlled wallet component invokes the configured offline signer and writes an exclusive-new file outside the repository;
4. 调用方离线解码并复核 chainId/from/nonce/to/value/data 与 policy 完全一致；
5. Pass the raw signed transaction only through sensitive stdin to the configured Hoodi bridge;
6. bridge 必须返回 chain identity attested 和与 raw transaction 本地摘要一致的 tx hash；
7. 读取 receipt，确认 status=success、contract/log/state 与预期一致；
8. 等待受控通道报告 finalized；若 finality 能力不可用，返回 `FINALITY_UNAVAILABLE` 并停止，
   不自行假定确认块数；
9. 清理 repo 外 request/policy/raw transaction 文件，仅保留非敏感摘要和公开链上证据；
10. 完成该 nonce 后才可处理同钱包下一交易。

## 8. 证据包

每项用例保存一条不可变 JSON 记录，至少包含：

- planVersion、profileId、五项产物哈希、testCaseId；
- chainId、完整 chain identity 校验结果、observedAt、区块号和区块时间；
- W1/W2 公开地址、交易前后 nonce/余额；
- requestSha256、policySha256、unsignedTransactionSha256、signedTransactionSha256；
- txHash、receipt status、blockNumber、gasUsed、effectiveGasPrice；
- contract address、runtime bytecode hash、selector、calldata hash；
- 相关事件的 topic/data hash 及解码后的非敏感字段；
- 链上查询的 owner、certificate version/hash、settlement status、used nonce；
- Oracle attestation envelope hash、revocation/status 结果和对账结论；
- expected、actual、pass、errorCode；失败项不得省略。

证据包不得包含 raw transaction、私钥、助记词、密钥路径、RPC/服务器地址、完整证书、个人资料、
仓储精确位置或未批准的原始资产文件。最终生成 manifest、文件数、逐文件 SHA-256 和总包 SHA-256。

## 9. 停止、回滚与通过标准

立即停止条件包括：链身份不符、余额不足、nonce 冲突、哈希漂移、policy 漂移、simulate revert、
receipt 失败、非预期事件、状态部分更新、finality 不可用、秘密/个人数据泄漏风险或任何主网迹象。

测试合约和 Token 均保留 test-only 标识，不尝试删除链上历史。所谓回滚只包括停止后续广播、撤销
本地临时授权、清理 repo 外敏感临时文件、冻结证据包并登记事件；不得以补发交易掩盖失败。

A complete pass requires all P0 checks and required Stage A–E cases to pass, on-chain state to reconcile with Oracle, no unexplained nonce/gas/event differences, no exposed secrets or personal data, and independently reviewable evidence for each component.
通过结论只能表述为“Pinned Working Draft 在 Hoodi 测试网的技术互操作测试通过”，不得表述为
ERC 正式标准、主网可用、监管批准或现实权利已转移。

## 10. 钱包+DAO回传格式

钱包+DAO应先只读回传一次 preflight：

```json
{
  "network": "hoodi",
  "chainId": 560048,
  "chainIdentityAttested": true,
  "wallets": {
    "ArtFi1": { "addressMatch": true, "ownershipSelfTest": "pass", "balance": "public-value", "pendingNonce": "public-value" },
    "ArtFi2": { "addressMatch": true, "ownershipSelfTest": "pass", "balance": "public-value", "pendingNonce": "public-value" }
  },
  "estimateReady": true,
  "simulateReady": true,
  "broadcastReady": true,
  "finalityReady": true,
  "blockNumber": "public-value",
  "blockTimestamp": "public-value",
  "observedAt": "public-value",
  "blockers": []
}
```

该 preflight 只证明执行能力，不授权签名或广播。业务交易必须等待 Oracle/ERC runner 提交精确 manifest。
在 ERC 任务自行确认提交前准备完成之前，钱包+DAO回传 preflight 后必须保持等待，不得联系 ERC、
不得准备业务 raw transaction、不得签名或广播。
