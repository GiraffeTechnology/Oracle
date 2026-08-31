Giraffe ERC 正式提交前准备包说明

更新日期：2026-08-30
发起主体：Giraffe Technology Holding Limited
技术标题：Asynchronous Register Projection for NFTs
前身：Proof-Verified Deferred Asset Settlement（V1–V9），已按 review/ADR_007_REGISTER_PROJECTION_AXIOM_ZH.md 的公理整体重写
状态：PREP_READY 候选；未发布、未创建讨论、未创建 PR、未分配 ERC 编号
作者：Michael Yip (@GiraffeTechnology)

公开候选布局：
- ERCS/erc-xxxx.md：唯一规范文本
- assets/eip-xxxx/：CC0 Solidity 参考实现和 32 项本地 EVM 测试

review/ 目录只包含提交前审查材料：ADR、反馈闭环、N/M 来源记录、prior-art、新颖性独立评估、证明路径对抗性审查、评审视角批评、IPR/CC0、测试记录、发布授权模板和官方 eipw 核验摘要。它不属于未来 ethereum/ERCs PR 的必提交文件；正式 PR 只提交 ERCS 与 assets 下的 6 个文件。

标准要解决的问题：链下登记册必然异步，链上无法消除这段时滞。但登记册的每一次变更都有唯一身份——生效时刻，加上对其内容的承诺。本标准用这个身份把登记册投影到 ERC-721 上：条目只增不改，生效时刻严格递增，record commitment 在代币内唯一，因此**任何一个过去的瞬间恰好解析出一个确认持有人**。代币全程照常交易；ownerOf 是可交易头寸，投影是确认记录。落在缺口内的权利：不可回补的（如投票）对新旧双方都不可行使且永久消灭；可回补的（如分红）递延，待投影落定后补记给该瞬间的确认持有人。

边界：
- xxxx 是编辑流程占位符，不是自称编号；
- discussions-to URL 必须在获授权并真实创建讨论后填写，这是唯一剩余的阻断项；
- 不包含 Hoodi、钱包、测试资产、RPC/SIN、密钥、签名、内部服务器或产品部署证据；
- 不构成 Ethereum 背书、监管批准、法律意见、专利意见或现实资产权利证明；
- 参考实现的证明 Profile 刻意最小化，其两项局限（不检测验证人分叉签名、验证人集合不可变）已在文件头声明，生产 Profile 必须自行解决。

最终发布只需两项用户输入：Ethereum Magicians 讨论 URL；按 PUBLISH_AUTHORIZATION_TEMPLATE_ZH.md 作出的明确发布授权（含 IPR/CC0 确认）。随后按 SUBMISSION_MANUAL_ZH.md 执行：创建讨论、填写真实 URL、在 ethereum/ERCs fork 运行官方 eipw、创建非强推 PR。
