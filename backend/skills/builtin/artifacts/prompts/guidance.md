# 制品区使用指南 · allhands.artifacts

## 何时调用

**凡是有独立价值的产出,存成制品。** 不要只在对话里贴出来。制品区是用户回头找、接着改、下载分享的地方;对话是过程 · 制品是成果。

触发关键词:用户说「写一份 X / 帮我做 / 给我导出 / 存下来 / 报告 / 文档 / 代码片段 / 图」 → 用这套技能。

## 工作流

1. **判断 kind**(看下面对照表)
2. **创建** — `artifact_create({name, kind, content, description?, tags?})`
3. **嵌入预览** — `artifact_create` 后立刻 `artifact_render(id)` · 不要把 content 重复粘到回复
4. **迭代** — 同一份制品 v2 / v3 用 `artifact_update`(会弹 confirmation + diff 预览)
5. **找历史** — `artifact_search(query)` 或 `artifact_list(kind?)` · 拿到 id 再 `artifact_read(id)` 拉回上下文

## 判断 kind 的对照表

| 产出形态 | kind |
|---|---|
| 长文档 / 策划 / 报告 / 手册 | `markdown` |
| 代码片段 / 脚本 / 配置 | `code` |
| HTML 原型 / 嵌入式页面 | `html` |
| 图片(用户上传或你生成) | `image` |
| JSON / CSV / 结构化数据 | `data` |
| 流程图 / 时序图 / 架构图 | `mermaid` 或 `drawio` |
| Office 文档 | `pdf` / `xlsx` / `docx` / `pptx`(用专门的 `artifact_create_pdf` 等工具) |

## 调用示例

```
# 「帮我写一份 Q1 销售报告」
artifact_create(
  name="q1-sales-review.md",
  kind="markdown",
  content="# Q1 销售回顾\n\n营收同比 +18%...",
  description="Q1 销售关键指标 + 趋势"
)
artifact_render(id)   # 立即在聊天里嵌入预览
# 不要 把 markdown 内容再粘一份到回复正文

# 「基于昨天那份接着改 · 加一节风险点」
artifact_search(query="Q1 销售")            # 找到 id
artifact_read(id)                            # 内容回到上下文
artifact_update(id, mode="overwrite", content="<新版本>")
# 弹 confirmation gate · 用户看 diff 后批准
```

## 常见坑

- **不要同一份内容既 create 又粘贴回复正文** · 用户在制品区就能看,重复反而干扰
- **不要一次 update 多个 artifact** · 一次一个,confirmation 才清楚
- **不要为临时交流片段建 artifact** · 聊天里几句话的东西不配
- **不要 delete 用户没明说要删的** · delete 弹 IRREVERSIBLE 确认 · 严肃
- **大改要 mode=overwrite** · 小改才用 patch(只传 unified diff)
- **kind=html 不是 markdown** · 用户说「网页」「demo」「HTML 页面」用 html;说「文档」「报告」用 markdown

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `artifact_create` 报 "name 必填" | 给一个清楚的文件名 · 加扩展名(.md / .py 等) |
| `artifact_update` 报 "version mismatch" | 用户在你 read 之后改过 · 重新 read 拿最新 v 再改 |
| `artifact_render` 报 "id not found" | id 错了或被删了 · `artifact_search` 重新找 |
| 用户说预览没渲染 | 检查 kind 是否对(markdown 渲染 md · html 渲染 iframe) · 重新 create with 正确 kind |

## confirmation 契约

- READ + 创建类(`create / render / list / read / search / pin`)— 无确认
- WRITE 改类(`update`)— 弹 confirmation 显示 diff
- IRREVERSIBLE(`delete`)— 弹严肃确认 · 仅用户明说要删时调

## 视觉契约

你不用管配色和间距 — 制品面板前端已按 Brand Blue Dual Theme 实现 · 你只负责把正确数据 / 正确 kind 塞给工具即可。
