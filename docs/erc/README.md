# ERC 提交前归档（参考资料，非本仓库实现范围）

本目录是独立 ERC 任务在发布前移交的文件归档。按 `docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md`
第 0 节，L3 ERC 提案及其参考合约不属于本 Oracle 仓库的实现范围：本仓库不自定 ERC 编号、
不提交 ERC 提案，也不把任何 NFT 合约实现列为 Oracle 完成条件。这些文件在此仅作为下游协议
消费接口的参考事实，不改变 Oracle 的交付边界。

## 文件与效力顺序

| 文件 | 阶段 | 效力 |
| --- | --- | --- |
| `ERC_SUBMISSION_CANDIDATE_EN.md` | EIP-1 提交候选稿 | **提交用规范文本**；带 YAML front matter |
| `CLAUDE_AUDIT_REMEDIATION_REPORT_ZH.txt` | 整改报告 | 对 `SUBMISSION_REVIEW_ZH.md` 第一轮意见的逐项回应 |
| `reference/VersionedRWACertificateReference.sol` | CC0 参考实现 | 参考资料；本仓库不编译、不部署 |
| `reference/protocol.cjs` | 参考实现测试套件 | 参考资料；17 项，需外部 hardhat 环境 |
| `GIRAFFE_ERC_FORMAL_ZH.txt` | 正式中文文本 | 内部副本，非规范性译本；与候选稿一致 |
| `GIRAFFE_ERC_FORMAL_EN.txt` | 正式英文文本 | 内部副本；候选稿为唯一规范源（见复核结论 N2） |
| `PRE_SUBMISSION_TEST_REPORT_ZH.txt` | 提交前测试报告 | 记录测试结论及被测文件哈希 |
| `ERC_PRIOR_ART_DUPLICATION_REVIEW_ZH.md` | 查重审查稿 | 查重结论与门禁清单；第 7 节附归档时的关闭状态 |
| `VERSIONED_RWA_CERTIFICATE_LIFECYCLE_ZH.md` | v0.1.1 工作草案 | **阶段记录，已被正式文本取代**；接口代码块不具规范效力 |
| `SUBMISSION_REVIEW_ZH.md` | 提交前审查结论 | 对正式英文文本的技术与格式审查；列出 7 项格式阻断与 7 项技术问题 |

**规范效力顺序**：`ERC_SUBMISSION_CANDIDATE_EN.md` 为唯一规范源；两份 txt 为内部副本，二者若出现分歧以候选稿为准。工作草案未被改写为冻结形态，以保留阶段记录；其与正式文本的全部已知差异列在该文件顶部的
差异表中。查重审查稿的原有正文同样保留，仅追加门禁关闭状态表。两份正式文本和测试报告为
原样归档，未作任何修改——测试报告第六节记录了两份正式文本的 SHA-256，改动即会使记录失效。

## CI 守卫

`scripts/check-frozen-erc-constants.ts` 在每次 push 时运行（CI 的 `frozen ERC constants` job），
**从规范文本重新推导**而非信任其声明值：

- 逐 selector 重算两个 interface ID，并检查两接口间无 selector 冲突；
- 校验两个 EIP-712 规范类型串在提交候选稿与参考实现中逐字节一致；
- 重算测试报告第六节记录的 5 个 SHA-256。

该守卫不编译也不执行 Solidity，因此不越过 PRD v0.2 第 0 节的范围声明。任一项漂移即 CI 失败；
若确需变更，必须同时更新规范文本、参考实现与测试报告中的哈希，属于一次有意的重新冻结。

## 归档时的独立核验

- 两份正式文本的 SHA-256 与测试报告第六节记录逐位一致；
- 五个文件均为合法 UTF-8；
- 正式文本未出现测试报告第五节所列禁用词（中创、Chainart、ERC-RWO、固定 T+3、固定 T+1），
  也未出现文保链；
- 两个 interface ID 在正式中文文本、正式英文文本和测试报告三处一致。

测试报告引用的 `test/*.test.js`、`scripts/syntax-check.mjs`、`scripts/repository-scan.mjs`、
`protocol.cjs` 与 `VersionedRWACertificateReference.sol` 不在本仓库中，其 13 项 EVM 测试与
27 项 Oracle 回归测试结论未在此处复现。

## 未关闭的对外提交门禁

正式文本中的 `github-username` 与讨论地址仍为占位符，CC0/专利检查无记录，对外发布与
`ethereum/ERCs` 提交均须另行取得明确授权。在这些门禁关闭前，本目录内容不得对外提交。
