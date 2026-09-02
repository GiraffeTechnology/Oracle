# review/ 目录导读

本目录是提交前审查材料,**不进 PR**。

2026-08-30 按 `ADR_007_REGISTER_PROJECTION_AXIOM_ZH.md` 的公理对提案做了整体重写(标题、接口、接口 ID、参考实现、测试全部更换)。下表标明每份文件相对这次重写的位置,避免把历史记录误读为现行设计。

## 现行

| 文件 | 内容 |
| --- | --- |
| `ADR_007_REGISTER_PROJECTION_AXIOM_ZH.md` | 重写所依据的公理与两条被推翻的旧规则 |
| `ADR_008_PERISHABLE_EXERCISE_TRIGGER_ZH.md` | 不可回补权利以"被争议"而非"非终局"为闸门;封闭可由治理派生,不需新原语 |
| `ADR_009_SCOPE_AUTHORITY_NOT_RULES_ZH.md` | 标准的两条边界:厘清权力而非定规则;不代替 oracle。据此删除的条款,含 `IDeferredEntitlement` 的删除决议 |
| `ADR_006_ENTITLEMENT_DURING_PENDING_ZH.md` | 可回补 / 不可回补权利的分类与处理;已升为规范正文(文内的接口 ID 影响估算属历史) |
| `CHANGELOG_REWRITE_ZH.md` | 重写与其后两项作者裁定的完整变更记录、发现的语义漏洞与全链验证结果 |
| `PREP_READY_LEDGER_V9.json` | 现行哈希、接口 ID 与验证状态(文件名沿用 V9,内容已更新) |
| `EIPW_V0.11.0_RESULT.json` | 对现行正文的 eipw 运行记录与负向对照 |
| `NOVELTY_ASSESSMENT_CURRENT_DRAFT_ZH.md` | **针对现行稿的查重与新颖性(2026-09-02)**。含此前从未核查的最近邻 ERC-5805/6372、ERC-1400 家族不是 EIP 的验证、以及升 Review 时的链接状态硬约束实测 |
| `NOVELTY_INDEPENDENT_ASSESSMENT_ZH.md` | 针对 V1–V9 的旧评估,**结论不可沿用**(那是另一个提案)。保留为历史 |
| `REVIEWER_REVIEW_POST_REWRITE_ZH.md` | **重写后的评审视角全面审查(2026-09-02)**。1 项阻断、3 项重大、3 项中等,均在正文/实现中核实并给出行号;含"我确认没问题的部分" |
| `PROOF_PATH_ADVERSARIAL_REVIEW_ZH.md` | 证明路径对抗性审查;结论仍成立(证明路径在重写中未改变),文中的接口/合约名是旧名 |
| `ERC_PRIOR_ART_DUPLICATION_REVIEW_ZH.md` | prior-art 比对 |
| `HKEX_RULE_CONFORMANCE_AUDIT_ZH.md` | 按 HKEX 官方规则原文核对本标准;含一处已修的事实错误与一项待作者裁定的重大缺口(H-1) |
| `IPR_CC0_GATE_ZH.md`、`ERC_IPR_CC0_RELEASE_CHECKLIST_ZH.md`、`PUBLISH_AUTHORIZATION_TEMPLATE_ZH.md` | IPR / CC0 与发布授权 |
| `SUBMISSION_CHECKLIST_ZH.md` | 提交清单 |

## 重写前的历史记录(保留为证据,不代表现行设计)

`ADR_001_CONFORMANCE_TIERS.md`、`ADR_002_FINALIZATION_TRANSFER_SEMANTICS.md`、`ADR_003_NEUTRAL_PROTOCOL_NAMING.md`、`ADR_004_UNKNOWN_SETTLEMENT_SEMANTICS.md`、`ADR_005_PROOF_GATED_FINALIZATION.md`、`CHANGELOG_V9_ZH.md`、`V9_TEST_REPORT_ZH.md`、`FORMAT_AND_TEST_LOG_ZH.txt`、`GIRAFFE_ERC_FORMAL_ZH.txt`、`ERC_V2_NEW_FEEDBACK_CLOSURE_ZH.md`、`EXTERNAL_AUDIT_OPINION_CLOSURE_ZH.md`、`N_M_PROVENANCE_AND_CLOSURE_ZH.md`、`REVIEWER_PERSPECTIVE_ZH.md`。

其中 `REVIEWER_PERSPECTIVE_ZH.md` 的 BLOCKER-1(持有人可在 deadline 前单方取消,搁置已在远端落定的记录)已修复,修复在重写中保留;MAJOR-3(无 Profile 可发现性)已由 `registerId` / `verificationProfile` 关闭(`registerDescriptor` 曾一并加入,2026-08-31 删除);MAJOR-2 由 ADR-007 的重新框定取代。

上述文件中出现的 `IVersionedCertificate` `0xebaa86a0`、`IDeferredCertificateSettlement` `0x2773d4c9`、`VersionedCertificateReference.sol`、"39/41 passing" 等,均为重写前的值。现行值是 `IRegisterProjection` `0x6309e170`、`IProjectionSettlement` `0xfd0f6337`(**两个接口**)、`RegisterProjectionReference.sol`、27 passing。`IRegisterProjection` 的 ID 变动过三次(`0x3e925bdc` → `0x3ce71a8d` → `0x6309e170`),各 ADR 内记录的是当时的值,只有本行是现行值。
