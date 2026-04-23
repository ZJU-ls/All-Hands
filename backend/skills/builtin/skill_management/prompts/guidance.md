# 技能管理 · allhands.skill_management

安装 / 修改 / 删除 Skill。Skill = "能力包"(tool_ids + prompt_fragment),员工挂上就能用。

## 工具地图

| 场景 | 用这个 |
|---|---|
| 看市场里有哪些 skill 可装 | `list_skill_market` |
| 装之前先预览一下这个 skill 带了什么工具 / 提示片段 | `preview_skill_market` |
| 从市场装(推荐 · 自带描述 / 分类 / 版本) | `install_skill_from_market` |
| 从任意 GitHub 仓 / 路径装(给了 URL 即可) | `install_skill_from_github` |
| 改一条现有 skill 的元数据(name / description / tool_ids / prompt_fragment) | `update_skill` |
| 删 skill | `delete_skill`(IRREVERSIBLE · 需确认) |

## 工作套路

1. **安装前 preview** —— 市场里的 skill 名字可能混淆(image-gen / text-to-image),`preview_skill_market` 看到完整描述 + tool_ids 再决定。
2. **分类检索** —— 市场 API 支持 `category` 过滤(画图 / 研究 / 数据 / 写作)· 不要把全量列表都倒给用户,先问"你要哪类"再窄化。
3. **已装 skill 的发现** —— 看员工能用哪些 skill 时,用 `list_skills`(READ · 不在此 pack)。本 pack 是管理(写操作)。
