# N1–N6 / M1–M4 来源与闭环记录（V9）

日期：2026-08-29  
原则：编号只在找到原始定义时作逐项语义结论；缺失原文不得靠上下文猜测。

## 1. 来源证明

对当前 ERC 工作目录、2026-08 微信附件目录及附件 ZIP 中全部 Markdown/TXT 条目做只读全文检索，唯一找到的编号式 v2 原文是：

- 容器：`GIRAFFE_ORACLE_REPORTS_cb75c3c.zip`
- ZIP SHA-256：`55B5B2FB72805A696C6932B4C010C2679917C7F2E03DD14187DEF1190106825C`
- 条目：`docs/erc/SUBMISSION_REVIEW_ZH.md`
- 条目 SHA-256：`D4EB106D4BD55AE083B20717117AA86822C797931B320FA09658728CBC6144BF`

该原文只定义 N1–N4。未找到 N5、N6、M1–M4 的原始标签、标题或判定标准。`ERC_V2_NEW_FEEDBACK_ZH.md` 提到另一份“v2 验证报告”，但该报告不在当前工作源或附件集合中。

## 2. 有原文项目的闭环

| 编号 | 原问题 | 当前结论 | 权威证据 |
| --- | --- | --- | --- |
| N1 | `CertificateInitialized` 缺少规范性发出条件 | CLOSED | 英文规范明确初始 v1 创建 MUST emit `CertificateInitialized`；参考实现 mint 发出该事件；39 项测试显式断言初始化事件与历史链。 |
| N2 | 两份英文规范并存 | CLOSED | `ERC_SUBMISSION_CANDIDATE_EN.md` 是工作源中的唯一规范文本；`GIRAFFE_ERC_FORMAL_EN.txt` 仅是逐字节同步副本，提交包只放一份 `ERCS/erc-xxxx.md`。门禁要求两者内容相同。 |
| N3 | `requires` 未升序 | CLOSED / SUPERSEDED INPUT SET | 当前 proof-model 仅依赖 `165, 721`，已升序；旧 `712, 1271` 随 Authority 签名设计移除。静态门禁验证精确值。 |
| N4 | 强制依赖 Review 状态的 ERC-8325 | CLOSED | ERC-8325 已从 `requires` 删除；asset anchor 是远端记录绑定字段或可选 Profile 集成，不构成强制 ERC 依赖。参考实现可选 registry，不影响核心接口。 |

## 3. 无原文标签的处置

| 编号 | 来源状态 | 验收处置 |
| --- | --- | --- |
| N5 | SOURCE NOT FOUND | 不虚构原问题；以当前完整格式门禁替代未知标签，不声称“按 N5 原文关闭”。 |
| N6 | SOURCE NOT FOUND | 同上。 |
| M1 | SOURCE NOT FOUND | 同上。 |
| M2 | SOURCE NOT FOUND | 同上。 |
| M3 | SOURCE NOT FOUND | 同上。 |
| M4 | SOURCE NOT FOUND | 同上。 |

“SOURCE NOT FOUND”是来源审计的最终事实，不是代码缺陷，也不是对未知内容作 PASS。若将来取得带可复算哈希的原报告，应新增补充映射，不覆盖本记录。

## 4. 不依赖未知编号的完整替代门禁

为避免缺失标签成为质量盲区，V9 对当前候选执行以下可验证门禁：

1. YAML 字段及顺序与官方 `config/eipw.toml` 对齐；`requires` 为升序整数。
2. 章节仅使用官方顺序：Abstract、Motivation、Specification、Rationale、Backwards Compatibility、Test Cases、Reference Implementation、Security Considerations、Copyright。
3. Copyright 逐字为 `Copyright and related rights waived via [CC0](../LICENSE.md).`
4. 正文提案链接使用相对路径；无不存在的 ERC-1643；Draft/Review/Stagnant 先例不进入 `requires`。
5. 英文规范、公开资产、参考实现 ABI、selectors 与两项 interface ID 同步。
6. 39 项本地 proof-model 测试、Solidity 候选块编译/ABI 对照、公开边界扫描和提交静态门禁全部从当前字节重跑。
7. 最终提交准备包逐文件列 SHA-256，且排除钱包、私钥、RPC、Hoodi 内部证据和产品部署材料。

这些门禁覆盖当前候选的完整可验证表面，但不冒充 N5/N6/M1–M4 原始语义。
