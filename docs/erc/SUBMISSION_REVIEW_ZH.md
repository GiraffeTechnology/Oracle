# Giraffe ERC 提案提交前审查结论

| 项目 | 内容 |
| --- | --- |
| 审查对象 | `GIRAFFE_ERC_FORMAL_EN.txt`（正式英文文本，SHA-256 `FF1CE231…F616D`） |
| 参照材料 | `GIRAFFE_ERC_FORMAL_ZH.txt`、`PRE_SUBMISSION_TEST_REPORT_ZH.txt`、`ERC_PRIOR_ART_DUPLICATION_REVIEW_ZH.md`、`VERSIONED_RWA_CERTIFICATE_LIFECYCLE_ZH.md` |
| 规则依据 | EIP-1（审查日 eips.ethereum.org 原文） |
| 审查日期 | 2026-08-23 |
| 审查性质 | 技术与格式审查；不构成安全审计、法律意见或提交授权 |

## 1. 结论

技术方向合理，但**当前文件不具备提交条件**。存在两类问题：

- **格式硬阻断 7 项**：提交后会被 ERC 自动校验直接打回，属机械修复；
- **实质技术问题 3 项（T1–T3）**：会在 ERC 编辑审查和 Ethereum Magicians 讨论中被追问，其中两项一旦调整即改变 ABI。

因此建议的次序是**先定 T1/T2/T3，重新冻结 ABI 并重跑测试，最后套 EIP-1 格式**。当前冻结的两个
interface ID 与测试报告中记录的文件哈希，会随 ABI 调整一并作废。

## 2. 已独立核实为真的部分

| 核验项 | 结果 |
| --- | --- |
| `IVersionedRWACertificate` interface ID = `0xebaa86a0` | **精确复现** |
| `IDeferredCertificateSettlement` interface ID = `0x2773d4c9` | **精确复现** |
| 两接口之间 selector 冲突 | 无重叠 |
| 标题 `Versioned RWA Certificate Settlement` | 36 字符（上限 44）、title case、不含 “standard”、不含编号 —— 合规 |
| 必需章节 Abstract / Specification / Security Considerations / Copyright | 齐全 |
| RFC 2119 / RFC 8174 引用样板 | 存在且措辞正确 |
| 正式文本禁用词（中创、Chainart、ERC-RWO、固定 T+3/T+1、文保链） | 0 处 |
| 两份正式文本 SHA-256 与测试报告第六节记录 | 逐位一致 |

### 2.1 interface ID 的核验方法

使用独立实现的 keccak-256（以空串向量及 `transfer(address,uint256)` = `0xa9059cbb` 自检通过）
逐个计算函数 selector 后 XOR，不含继承自 IERC165 的 `supportsInterface(bytes4)`：

| 接口 | selector | 函数签名 |
| --- | --- | --- |
| 核心 | `0x7f223fe0` | `currentCertificate(uint256)` |
| 核心 | `0xc74966e3` | `certificateAt(uint256,uint64)` |
| 核心 | `0x53c1dfa3` | `certificateAuthority(uint256)` |
| | **`0xebaa86a0`** | **XOR，与文本声明一致** |
| 扩展 | `0x115785ee` | `settlement(bytes32)` |
| 扩展 | `0x17c86e05` | `pendingSettlementOf(uint256)` |
| 扩展 | `0x02b8df09` | `beginSettlement(uint256,bytes32,address,bytes32,uint64)` |
| 扩展 | `0xae1cd909` | `finalizeSettlement(bytes32,bytes32,bytes32,uint64,bytes)` |
| 扩展 | `0x8d483922` | `cancelSettlement(bytes32,bytes32,bytes)` |
| | **`0x2773d4c9`** | **XOR，与文本声明一致** |

该核验与测试报告使用的 solc 路径相互独立，可用 `cast sig "<签名>"` 复核任一行。

## 3. 格式硬阻断

| # | 问题 | 修复 |
| --- | --- | --- |
| F1 | 无 YAML front matter，且文件为 `.txt` | 改为 `erc-XXXX.md`，开头以 `---` 包裹 preamble |
| F2 | 缺 `description` 字段 | 必填；≤140 字符、句首大写、不得含 “standard” 或编号 |
| F3 | `Status: Working Draft` 非合法状态 | 新提交必须为 `Draft` |
| F4 | `Discussions-To: To be created` | 必须为 Ethereum Magicians 帖子 URL；不得用 GitHub PR 或临时/可锁定链接 |
| F5 | Copyright 缺 markdown 链接 | 逐字改为 `Copyright and related rights waived via [CC0](/LICENSE).` |
| F6 | `Requires: ERC-165, ERC-721` 写法 | front matter 中应为 `requires: 165, 721`（纯数字） |
| F7 | 接口代码为纯缩进文本 | 改用 ` ```solidity ` 围栏 |

**不是问题的一项**：作者行中 `..., Giraffe Technology Holding Limited` 这种不带 handle 的纯名称
形式，EIP-1 明确允许（仅需至少一位作者带 `(@username)`）。该处只需替换 `github-username` 占位符。

## 4. 实质技术问题

### T1（最高）授权格式未规范化，扩展接口最关键的互操作点是空的

`finalizeSettlement` 的 `authorityData` 为裸 `bytes`，格式完全由实现自定；EIP-712 与 ERC-1271
仅为 SHOULD。但规范同时要求授权必须绑定 12 个字段、必须域分离、必须防重放，并发授权还必须
校验当前证书哈希与预期版本 —— **这些安全属性全部依赖一个未规范化的字节串**。

后果：两个均"完全合规"的实现，其权威签名彼此无法验证；钱包与索引器在不了解具体实现的前提下
无法校验任何一份授权。对一个以可发现接口为卖点的 ERC，这是最易被质疑之处。

另需注意：工作草案原本承诺“英文提案前冻结 typed-data schema”，正式文本反而放弃了冻结。

建议：将 EIP-712 提升为 MUST 并固定 type hash；或至少增加
`verifyFinalizationAuthorization(...) view returns (bool)`，使授权可被第三方独立校验。

### T2（高）核心接口单独使用时没有任何写入路径

核心接口仅剩 3 个 view 与 3 个 event。`CertificateInitialized` 与 `CertificateSuperseded`
没有任何标准函数会触发：只实现核心、不实现可选扩展的合约，**永远无法以标准方式完成一次证书
替代**，替代只能走实现自定义的管理函数。等于核心标准化的只是读法与事件词汇表，全部实质语义
都在可选扩展中。

工作草案 §20 开放问题 8 本已提出是否拆为两个 ERC；当前答案实际上是"拆了，但核心被掏空"。

建议二选一：核心与扩展合并为一个 ERC；或在核心中补一个最小的规范化证书替代入口。

### T3（高）“一物一 token”在正式文本中已无规范性表述

删除 `assetIdOf` 后，全文没有任何一句要求一个 token 对应唯一链下资产，ERC-8325 仅为 MAY。
合规实现可以完全不暴露资产关联，消费者无法从标准接口判断某份证书属于哪件资产。这与摘要中
“connecting authoritative off-chain records”的定位、以及 PRD 的 PROTOCOL-001 均不一致。

建议：即使不重新定义 assetId，也应补一条规范性要求 —— 实现必须通过 ERC-8325 或 profile
定义的方式暴露资产关联。

### T4（中）与 ERC-6997 的差异论证偏薄，且措辞可被反将

Rationale 批评 ERC-6997“允许 approved 账户直接转移”，但本提案第 4 节同样允许
“an approved address, or an operator”发起 settlement —— 真正差异只在“pending 期间不能绕过”，
不在“谁能发起”。

查重审查要求的逐函数差异矩阵、以及“ERC-8325 + ERC-6997 + ERC-7943 组合仍不足”的证明均未写入
正文（对应门禁 3、6 仅部分关闭）。“这不就是三个标准的组合吗”是可预期的首个提问，正文目前
仅两句话回应。

### T5（中）Test Cases 写的是义务而非用例

该节内容为“参考实现必须测试……”，不是可复核的测试用例；且无 Reference Implementation 节，
也未链接 `VersionedRWACertificateReference.sol`。测试报告称该文件通过 13 项测试，但提案读者
看不到任何实现。

### T6（低）强制事件顺序

`CertificateSuperseded` → `Transfer` → `SettlementFinalized` 的顺序为 MUST，在 ERC 中少见，
会约束基于 OpenZeppelin 内部函数组织代码的实现。建议降为 SHOULD，或说明该顺序对索引器为何必需。

### T7（低）证书承诺算法被定死

Definitions 将 certificate hash 固定为 keccak256，而 Rationale 又称 canonicalization 由 profile
定义。若后续需与链下 PKI 对齐（如 SHA-256）将被卡住。建议保留 `bytes32`，由 profile 定义承诺函数。

## 5. 建议修复顺序

1. 决策 T1（EIP-712 是否提升为 MUST 并冻结 schema）与 T2（核心与扩展是否合并）；
2. 决策 T3（资产关联的规范性表述）；
3. 重新冻结 ABI，重算两个 interface ID，重跑 EVM 测试并更新测试报告中的文件哈希；
4. 补 T4 的逐函数差异矩阵与组合不足论证，补 T5 的参考实现链接；
5. 处理 T6、T7；
6. 最后套用 EIP-1 格式，修复 F1–F7；
7. 关闭 GitHub 用户名、Discussions-To、CC0 与专利门禁；
8. 取得明确授权后方可发布讨论帖及提交 `ethereum/ERCs` PR。

**在第 3 步完成前不要修格式** —— ABI 一动，F 类修复需全部重做。

## 6. 本次审查未覆盖的事项

- 测试报告引用的 `VersionedRWACertificateReference.sol`、`protocol.cjs`、`test/*.test.js`、
  `scripts/syntax-check.mjs`、`scripts/repository-scan.mjs` 不在本仓库中，其 13 项 EVM 测试与
  27 项 Oracle 回归测试结论**未在此复现**；
- 未进行安全审计、形式化验证或 gas 分析；
- 未逐句核对中英文本的规范等效性（英文 63 处 MUST / 18 处 MUST NOT，中文 41 处“必须” /
  20 处“不得”，数量差异明显）。ERC 仅提交英文本；中文本若对外使用，建议标注为非规范性译本；
- 未就 CC0、专利与必要权利作任何判断。
