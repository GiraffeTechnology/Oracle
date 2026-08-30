# Giraffe ERC 最终发布授权模板

状态：等待权利人填写两项输入  
用途：在提交前技术包验收通过后，作为创建 Ethereum Magicians 讨论和 `ethereum/ERCs` PR 的唯一人工授权记录。

## 输入一：最终作者 GitHub 用户名

`@REPLACE_WITH_GITHUB_USERNAME`

该账户必须真实存在、可接收 GitHub 通知，并获授权代表 Giraffe Technology Holding Limited 参与 ERC 流程。不得由技术人员猜测或代填。

## 输入二：明确发布授权

权利人应原样确认或签署以下完整声明；不得预填 PASS：

> 我确认 Giraffe Technology Holding Limited 及相关贡献者有权将最终 SHA-256 清单所列的 Giraffe ERC 候选规范、参考实现和测试按目标仓库要求及 CC0 发布；没有已知第三方保密义务、合同限制或不兼容许可证阻止该发布；已完成必要的专利及其他权利审查，结论允许公众自由实现该候选规范；我确认作者 GitHub 用户名真实且获授权，并明确授权创建对应的 Ethereum Magicians 讨论、填写其 `discussions-to` URL，并以非强推方式创建 `ethereum/ERCs` PR。该授权不构成 Ethereum 背书、监管批准或现实资产真实性声明。

授权消息须由有权代表 Giraffe Technology Holding Limited 的确认人发出，并在同一条消息中写明确认人姓名及职务/权限依据；授权时间由系统按 UTC 留痕。授权自动绑定同目录 `.sha256` sidecar 所列的最终 ZIP SHA-256，不要求用户另行抄写哈希。

## 执行边界

- 在收到上述两个输入前：不得发布讨论帖、不得创建 PR、不得把占位符替换成猜测值。
- 收到后：先验证授权绑定的包 SHA，再替换作者用户名；创建讨论帖后填写实际 URL；复制到目标 fork 后运行官方 `eipw`；最后创建 PR。
- `eip: XXXX`、`ERCS/erc-xxxx.md` 和 `assets/eip-xxxx/` 是编辑流程占位符，不要求用户预先提供编号；按目标仓库当时流程处理。
