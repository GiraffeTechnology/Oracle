# ERC 提交前检查表（V9）

日期：2026-08-29  
验收口径：`PREP_READY` 表示提交材料已完成，但尚未对外发布；`SUBMIT_READY` 只有取得真实作者用户名、权利人明确发布授权及真实讨论 URL 后才成立。

## 技术与文本门禁

- [x] 唯一英文规范候选；英文审阅副本逐字节一致。
- [x] 作者使用显式未解析占位符，不冒用或猜测个人身份。
- [x] Definitions、Profile、完整 proof binding、远端高度与 replay、原子性、取消和隐私边界完整。
- [x] Authority MUST nonzero、MAY equal holder；独立背书由消费者 out of band 核验。
- [x] certificate-conforming / settlement-conforming 两级语义明确。
- [x] 非 callback 合约收款方及未知 settlement 行为明确。
- [x] Motivation 有三个中性 illustrative 用例；Rationale 含 W3C VC/EAS 非 EIP 对照。
- [x] `ERC_V2_NEW_FEEDBACK_ZH.md` A1–A3、B1–B2、C1–C4、D1、E1–E5 逐项闭环或明确 superseded/not-applicable。
- [x] N1–N4 有来源并闭环；N5/N6/M1–M4 的原报告穷尽检索未找到，未虚构语义；完整替代门禁已建立。
- [x] prior-art 状态由官方源快照复核；无不存在的 ERC-1643 或伪造状态。
- [x] 官方 `eipw.toml` 的 frontmatter 顺序、章节顺序、相对链接与 Copyright 规则已纳入本地门禁。
- [x] CC0 参考实现与公开测试资产不含钱包、RPC、凭据、测试链材料或内部运维数据。
- [x] Solidity ABI、selectors、interface IDs、canonical proof type names 与规范同步。
- [x] 当前本地 EVM 39 项、公开资产副本、Solidity candidate block、静态提交门禁全部从最终工作源重跑。
- [x] 提交前包含逐文件 SHA-256 索引、技术验证记录和单一发布授权模板。

## 仅剩两项用户输入

- [ ] 将 `@REPLACE_WITH_GITHUB_USERNAME` 替换为真实且获授权的 GitHub 用户名。
- [ ] 权利人按 `PUBLISH_AUTHORIZATION_TEMPLATE_ZH.md` 明确授权 CC0/IPR 发布、创建 Ethereum Magicians 讨论及创建 `ethereum/ERCs` PR。

讨论 URL 是授权后的执行产物；ERC 编号是编辑流程产物，均不构成额外用户输入。收到授权后仍须在目标 fork 对最终文件运行当时最新版官方 `eipw`，并只以非强推方式提交。
