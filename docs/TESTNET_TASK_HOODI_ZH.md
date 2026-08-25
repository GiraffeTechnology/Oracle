# Codex 任务书：在公链测试网执行 Giraffe ERC 参考实现测试

| 项目 | 内容 |
| --- | --- |
| 被测对象 | `erc-reference/contracts/VersionedRWACertificateReference.sol` |
| 测试套件 | `erc-reference/test/protocol.cjs` |
| 本地基线 | `npx hardhat test` → 17 passing / 0 failing（solc 0.8.26，optimizer runs=200，viaIR，chainId 31337） |
| 目标网络 | **Hoodi（chainId 560048）**；Sepolia 仅作可选复跑 |
| 裁决依据 | `DECISIONS_ZH.md` D-002 |
| 日期 | 2026-08-25 |

## 0. 网络选择

**使用 Hoodi，chainId 560048。** 依 `DECISIONS_ZH.md` D-002。Sepolia 仅在需要时作可选复跑。
Holesky 已于 2025 年 9 月废弃，不得使用。

已记录的权衡（不构成阻断，仅作背景）：ethereum.org 将 Sepolia 列为应用与合约开发的默认
推荐测试网，Hoodi 的定位是验证者与质押测试。两者均可执行本合约测试。

**chainId 必须从 RPC 实际读取并断言等于 560048，不得在测试中硬编码** —— EIP-712 域随
chainId 变化，硬编码会产生错误的域分隔符，而这正是本次上链最值得验证的部分。

**不得部署到主网，不得使用真实资金。**

## 1. 本次上链测试能证明与不能证明什么

**能证明**（本地测试无法覆盖）：

- 真实 chainId 下的 EIP-712 域分离与签名验证 —— 本地固定 chainId 31337 会掩盖域分隔符错误；
- 真实区块时间下的 deadline 与过期行为（无作弊码）；
- 真实部署可行性与 EIP-170 运行时大小；
- ERC-1271 合约权威在真实部署合约上的验证路径。

**不能证明**：不构成安全审计、形式化验证或经济性分析；状态机正确性本地已覆盖，公链不增加新证据。

## 2. 现状（执行前必读）

- 测试自带 solc 编译（`protocol.cjs` 中的 `compile()`），不依赖 hardhat artifacts；
- 涉及三个合约：`VersionedRWACertificateReference`、`AssetAnchorRegistryLifecycleMock`、
  `ERC1271AuthorityMock`；
- **chainId 为动态读取**（`protocol.cjs:80`），EIP-712 域天然可移植 —— **不要改成硬编码**。

## 3. 必须改造的三点

### 3.1 时间作弊码（阻断项）

`protocol.cjs` 第 398、430、490 行使用 `evm_setNextBlockTimestamp` 与 `evm_mine`，公链不存在。
受影响用例：

1. `rejects expired authority data and finalization after settlement deadline`
2. `rejects concurrent pending settlement and reused settlement IDs`
3. `allows holder cancellation after deadline without changing holder or certificate`

**改法**：deadline 改为 `now + 90` 秒，随后真实等待至 `deadline + 1` 并确认已产生新区块
（Hoodi 与 Sepolia 同为约 12 秒出块）。相应提高这三个用例的 mocha timeout。

**禁止跳过或标记为 pending** —— 这三项正是公链测试中最有价值的部分。

### 3.2 部署次数

`beforeEach` 为每个用例重新部署 2 个合约并 mint，17 个用例约 51 笔交易。可将不可变部署提升至
`before`、按 `tokenId` 隔离用例以降低耗时与 gas。**不得为此弱化任何断言**；若采用此改法，
需在报告中说明用例隔离方式。

### 3.3 账户：只有 2 个测试钱包时的角色合并（约束条件）

测试套件原本使用 6 个角色。**在只有 2 个可操作测试钱包的前提下仍可完整运行 17 个用例**，
依据是：`authority` 只用私钥做 EIP-712 签名，从不发送交易（`finalizeSettlement` 由
administrator 发出），因此**可以是一个零余额的临时密钥**。

原角色的实际交易行为：

| 角色 | 是否发交易 | 说明 |
| --- | --- | --- |
| `administrator` | 是 | 默认签名者：部署 2 个合约并 mint |
| `owner` | 是（11 处） | 主要操作者 |
| `operator` | 是（1 处） | 以被批准 operator 身份尝试转移，必须失败 |
| `outsider` | 是（1 处） | 提交有效权威取消数据 |
| `recipient` | 是（多轮用例中轮换为持有人后） | finalize 的接收方 |
| `authority` | **否** | **仅签名，无需 gas** |

**要求的映射方案**：

- **W1（注资）** = `administrator` + `operator` + `outsider` + 目标地址 B
- **W2（注资）** = `owner`（初始持有人） + 目标地址 A
- **K3（零余额临时密钥，测试内生成）** = `authority`

必须满足的不变量：`W1 ≠ W2`；`K3 ∉ {W1, W2}`（否则"错误签名人"与"权威签名"无法区分）。

**陷阱（必须处理）**：W1 同时承担 `operator` 与 `outsider`。若某个用例已把 W1 批准为
operator，而后续"外部地址提交有效权威取消数据"的用例仍复用同一 token，则该用例不再能证明
*无特权调用者*也可取消。因此：**批准只能在 operator 用例内授予，并在该用例结束时撤销**；
或为取消类用例使用未授予任何批准的独立 tokenId。此项须在报告中明确说明处理方式。

**多轮 T+n 用例需要改造**：`protocol.cjs:569` 的
`destinations = [recipient, outsider, operator, owner]` 在合并后会退化为
`[W1, W1, W1, W2]`，而循环内的 `if (destination.address === currentOwner.address) continue;`
会跳过其中约一半迭代，使 8 轮交割降为 4 轮。**改为 `[W1, W2]` 交替**即可让 8 轮全部执行，
覆盖率不降反稳。不得直接减少循环轮数。

**注资与用量**：`beforeEach` 会导致约 51 笔交易，且全部由 W1、W2 承担。建议先按 3.2 节把
不可变部署提升到 `before` 以降低交易量（若这样做，必须显式重置用例间的批准状态，见上方陷阱），
并确保两个钱包各自持有充足的测试网 ETH。

**本方案的已知损失**（须在报告中如实记录）：`administrator` 与 `owner` 不再是独立地址，
因此"单一管理员不得绕过权威授权"这一性质在本轮上链测试中不具备独立地址的证据强度；
该性质仍由本地 17 项测试覆盖。

## 4. 网络与密钥配置

- 在 `hardhat.config.cjs` 增加 hoodi 网络，`url` 取自环境变量 `HOODI_RPC_URL`，
  `accounts` 取自环境变量，**只提供 W1、W2 两个私钥**；`authority` 密钥在测试内以
  `ethers.Wallet.createRandom()` 生成并仅用于签名，不得注资、不得写入配置；
- **私钥与 RPC key 只能来自环境变量，绝不得写入仓库、配置文件或提交历史**；
- 使用一次性测试账户，不得复用任何持有价值或用于其他用途的密钥；
- 运行前断言 `provider.getNetwork().chainId === 560048n`；不等则立即中止，不得继续执行。

## 5. 数据合规（重要）

测试网是公开链，写入不可撤回。**只能使用现有合成 fixture**（如 `certificate-v1`、
`asset-anchor-1`）。不得写入任何真实证书字节、真实登记引用、真实资产标识、仓单信息或任何
个人信息。此项与 PRD 的隐私要求一致。

## 6. 需要交付的证据

1. 网络名称与从 RPC 实际读取的 chainId（须为 560048）；
2. 三个合约的部署地址与部署交易哈希；
3. 完整测试输出，含 passing / failing 计数与逐用例结果；
3b. 角色映射实况：W1 / W2 地址、`authority` 临时地址，以及 operator 批准的授予与撤销位置；
4. 三个时间相关用例的实际等待时长与前后区块号；
5. **链上接口核验**：对已部署合约调用 `supportsInterface`，确认以下返回 `true`：
   - `0x01ffc9a7`（ERC-165）
   - `0x80ac58cd`（ERC-721）
   - `0x4a967b01`（ERC-8325 `IAssetBoundTokenId`）
   - `0xebaa86a0`（`IVersionedRWACertificate`）
   - `0x2773d4c9`（`IDeferredCertificateSettlement`）

   并确认 `0xffffffff` 返回 `false`；
6. 一次真实 finalize 的交易哈希，并从 receipt 确认 `CertificateSuperseded`、`Transfer`、
   `SettlementFinalized` 三个事件齐备（顺序为 SHOULD，不作为失败条件）；
7. 运行时字节码大小，确认低于 24,576 字节；
8. 若有失败项，**如实报告**，不得跳过用例或放宽断言。

## 7. 不得进行的操作

- 不得修改 ABI、两个 EIP-712 规范类型串或两个 interface ID —— 任何改动都会使已冻结的
  `0xebaa86a0` / `0x2773d4c9` 及测试报告中记录的文件 SHA-256 失效；
- 不得为使测试通过而放宽 MUST 级断言；
- 不得部署到主网或使用真实资金；
- 不得提交私钥、RPC key 或 `.env` 文件。

## 8. 完成后

在 `PRE_SUBMISSION_TEST_REPORT_ZH.txt` 中新增一节记录测试网结果（网络、chainId、合约地址、
交易哈希、用例结果），并更新第六节中因改动而变化的文件 SHA-256。

测试网通过**不构成**外部安全审计、法律意见、监管批准或 Ethereum 背书，也不解除
GitHub 用户名、Ethereum Magicians 讨论地址、ERC 编号、CC0 与专利结论、对外发布授权
这五项提交前门禁。
