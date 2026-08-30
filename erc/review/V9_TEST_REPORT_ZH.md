# V9 提交前技术验证报告

日期：2026-08-29  
状态：当前工作源验证通过；最终包哈希由打包阶段另行固定

## 环境

- Node.js `v24.19.0`
- Hardhat `2.29.0`
- ethers `6.17.0`
- solc `0.8.26+commit.8a97fa7a.Emscripten.clang`
- 测试网络：Hardhat 本地 EVM；无钱包、RPC、测试链资产或外部 signer

## 结果

| 门禁 | 结果 |
| --- | --- |
| 工作参考实现协议套件 | 39/39 PASS |
| `erc-submission-assets/eip-xxxx` 独立目录套件 | 39/39 PASS |
| submission static gate | PASS |
| candidate Solidity fences compile + ABI parity | PASS |
| final PREP_READY preflight | PASS |
| official `eipw 0.11.0` synthetic-substitution lint | PASS / 0 diagnostics |

## 当前冻结值

- Candidate SHA-256：`7300AC2003A4374FE30EF77134418C1E9F6A187F3AB00FF33FCECA3606FA81EB`
- Reference Solidity SHA-256：`C09CE29455F7077E4F270CAF2142474EB7981A1900573C3EE1CA566577C6DFE4`
- Protocol tests SHA-256：`821DD151F600D3229D3275740FBC38B4DC9F36284BAE6D1D1A00A5C4998E64CE`
- `IVersionedCertificate` interface ID：`0xebaa86a0`
- `IDeferredCertificateSettlement` interface ID：`0x2773d4c9`

## 覆盖

覆盖编译、interface ID、远端 ledger/validator-set pin、Authority==holder、零 Authority 拒绝、初始化事件、Pending、转移锁、任意 relayer、非 callback 合约收款方、完整字段逐项篡改、Merkle membership、错误 root/ledger/validator set、阈值不足、非 validator、重复签名、proof/高度 replay、锚点 finalization 复检、inactive anchor 下 holder 取消、未知 settlement、第三方/非空取消拒绝、deadline、追加式历史及最大 deadline。

## 解释限制

本报告不包含 Hoodi 或产品部署门禁，因为通用 ERC 提交不依赖测试链。测试通过不构成 Ethereum 接受、法律有效性、现实资产真实性或专利意见。
