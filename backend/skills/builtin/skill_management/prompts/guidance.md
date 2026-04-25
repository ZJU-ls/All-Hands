# 技能管理 · allhands.skill_management

## 何时调用

用户说「装一个 X 技能」「市场有什么 skill」「删除某个技能」「改 skill」「升级」 → 这套技能。

## 工作流

1. **市场盘点** — `list_skill_market(category?, q?)` · 别一次性把全量给用户
2. **装前预览** — `preview_skill_market(slug)` · 看 description + tool_ids + prompt_fragment 头几行
3. **装** — `install_skill_from_market(slug)` 或 `install_skill_from_github(repo_url)`
4. **改 / 删** — `update_skill(skill_id, ...)` · `delete_skill(skill_id)`(IRREVERSIBLE)

## 工具地图

| 场景 | 用 |
|---|---|
| 看市场可装 | `list_skill_market` |
| 装前预览 | `preview_skill_market` |
| 从市场装 | `install_skill_from_market` |
| 从 GitHub 装 | `install_skill_from_github` |
| 改 skill | `update_skill` |
| 删 skill | `delete_skill`(IRREVERSIBLE) |

## 调用示例

```
# 「装一个画图技能」
list_skill_market(category="diagrams")
# → 看到 [drawio-creator, mermaid-pro, ...]
preview_skill_market(slug="drawio-creator")
# 用户确认后
install_skill_from_market(slug="drawio-creator")
# → 拿到 skill_id · 用户去 employee 设计页挂上即可

# 「装一个我朋友写的 GitHub skill」
install_skill_from_github(repo_url="https://github.com/foo/my-skill")
```

## 常见坑

- **不要一次列完全部市场 skill** — 量大时窄化后再回 · 「画图 / 研究 / 写作」选一个 category
- **从 GitHub 装的 skill 同名覆盖 builtin** — DB 行优先 · 用户其实在 shadow 内置 · 多嘴提示一下
- **删 builtin skill 不能完全删** — Builtin 来自磁盘 · 数据库行删了重启又会注册回去 · 想真正禁用要改 employee.skill_ids
- **`update_skill` 改 builtin** — 同上,效果是「在 DB 里覆盖一份」 · 重启 yaml 再注册回原状

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `list_skill_market` 报 "rate limited" | github_token 没设 · 或者 anon 60/h 用完了 · 等等再试 / 加 token |
| `install_skill_from_market` 报 "slug not found" | slug 大小写敏感 · 重新 list 看精确写法 |
| `install_skill_from_github` 报 "no SKILL.md / SKILL.yaml" | 那 repo 不是合规 skill · 让用户给正确仓库 |
| `delete_skill` 后用户员工依然能用 | 那是 builtin · 见上 「常见坑」末两条 |
