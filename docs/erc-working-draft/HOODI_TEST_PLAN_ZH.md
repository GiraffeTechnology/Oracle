# Giraffe ERC Hoodi 真实测试计划

Status: execution preparation is complete; controlled wallet references and the configured remote ACL checks remain pending.

网络：Hoodi testnet  
固定 chainId：`560048`  
禁止范围：任何主网、生产 L1、未知链、bridge、swap、faucet、真实资产或个人数据

## 1. 测试目标

在 Hoodi 的真实 chainId、真实区块时间和真实交易 receipt 下复跑本地 17 项 ERC 测试，补充验证：

- EIP-712 域分离使用真实 `chainId=560048`；
- deadline、超期确认和超期取消不依赖 EVM 时间作弊码；
- 参考合约、锚点登记 Mock 和 ERC-1271 Authority Mock 可真实部署；
- Pending 期间全部 ERC-721 转移入口被封锁；
- 证书替代、持有人转移和交割完成保持原子性；
- 五个 ERC-165 接口返回值和 `0xffffffff` 反例正确；
- 运行时字节码低于 EIP-170 上限。

## 2. 钱包与角色

- W1: `<TEST_WALLET_1_ADDRESS>`
- W2: `<TEST_WALLET_2_ADDRESS>`
- K3 / Authority：每个测试 fixture 在内存中随机生成的零余额临时钱包，仅签署提案规定的 EIP-712 数据。

角色映射：W1=`administrator + operator + outsider + destination B`；W2=`owner + destination A`。测试按钱包分别串行管理 pending nonce，不并发签名或广播。

## 3. 受控写入链路

每一笔成功交易必须依次经过：

1. 从固定 Hoodi 读取通道获取 pending nonce、fee 和 gas estimate；
2. 为该单笔交易生成最长一小时有效的精确 Hoodi policy；
3. 部署交易固定完整 init-code Keccak；调用交易固定 target、selector 和完整 calldata Keccak；
4. `Invoke-ArtFiOfflineSignerV1` 输出签名交易到 repo 外 exclusive-new 文件；
5. 校验签名交易的 chainId、from、nonce、to、value 和 calldata；
6. Broadcast only with `broadcast-stdin` through the configured Hoodi bridge;
7. 仅在 bridge 返回链身份已证明后接受交易哈希；
8. 通过 bridge 的 `receipt` 串行确认成功后，才处理该钱包下一 nonce。

不得读取、接收或记录私钥、助记词、内部钱包引用、RPC key 或 RPC endpoint。日志只记录公开地址、nonce、交易哈希、区块号及 request/policy/signed-transaction 的 SHA-256。

## 4. 真实时间用例

三个时间相关用例使用当前区块时间加 90 秒的 deadline。测试轮询真实 Hoodi 新区块，直至链上时间严格超过 deadline，并记录实际等待毫秒数、起止区块号和起止区块时间。不得使用 `evm_setNextBlockTimestamp`、`evm_mine`、skip 或 pending 标记。

## 5. UNIT-A39 隔离测试资产

本轮 Hoodi 测试资产为 `UNIT-A39`。测试模型记录 `owner=ArtCCH`、`custodian=ArtCCH`；该记录只用于测试证据一致性，Hoodi NFT、交易、事件或转移不产生、确认、转移或消灭任何现实法律权利，也不承担法律后果。慈善、ICO、主网或正式发行条款均不适用。

权威 test-only manifest 已交付并授权在 Hoodi 公开锚定。runner 必须从隔离目录读取 manifest，复核资产文件字节数和 SHA-256，并自动注入其中的 `assetFileSha256Bytes32`；环境变量如存在则必须与 manifest 完全一致。测试不得读取、复制或上传交接包以外的原始文件及保密登记文件，不得自行替换、推导或猜测哈希。隔离测试数据必须标注：`TEST ONLY / NO VALUE / NO LEGAL EFFECT / NO RIGHTS TRANSFER`，不得进入任何生产集合、上架或主网流程。

## 6. 必须收集的证据

- chain identity、chainId 和 genesis gate；
- W1/W2 公开地址与测试前后余额；
- 每次部署地址与部署交易哈希；
- 17 项逐项输出及 passing/failing 统计；
- Authority 临时公开地址；
- operator approval 的授予和清除证据；
- 三个真实时间用例的等待与区块证据；
- 五个 ERC-165 接口的 true 结果和 `0xffffffff=false`；
- 一次真实 finalize receipt 中三个必要事件；
- 运行时字节码大小；
- 所有失败项和阻断，不得隐瞒或弱化断言。

## 7. Pre-execution verification

以下三项必须同时通过后才能签名或广播：

1. The installed, audited offline broker completes real ownership self-tests for the pinned W1/W2 references;
2. The configured remote ACL permits only the required Hoodi-only actions through the configured bridge;
3. The authoritative UNIT-A39 bytes32 value, test-only manifest, file hash verification and permission for public Hoodi anchoring are confirmed.

任一项失败即保持 fail-closed，不得改用私钥、任意 RPC 或其他链路绕过。
