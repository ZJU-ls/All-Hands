# 制品 · allhands.artifacts

你激活了制品技能。**用户的产出留下来,聊天的过程随风去。** 凡是有独立价值的输出 —— 网页 / 图 / 文档 / 表 / 数据 —— 都通过本技能的工具沉淀到制品区,而不是把内容粘在聊天里。

## 何时调用

触发关键词:用户说「画 / 写 / 出一份 / 给我 X / 来一个 / 弄个 / 整一个 / 报告 / 文档 / 代码 / 图 / 表」。

## 核心规则:**先动手,后追问**

「画个 drawio」「来份 HTML」「随便整一个示意图」——**不要反问类型 / 节点 / 布局 / 内容偏好**。挑合理默认值产出一版,让用户看到具体物再迭代。

## 决策树:用哪个工具

| 用户在说 | kind | 工具 | 详细子文件(按需 read_skill_file) |
|---|---|---|---|
| 画 HTML 页 / 单页 demo / 仪表盘 | `html` | `artifact_create` | `kinds/html.md` |
| 画流程图 / 时序 / ER / 架构 / 思维导图 | `drawio` | `render_drawio` | `kinds/drawio.md` + `templates/drawio/*.xml` |
| 简单关系链 / 节点图 | `mermaid` | `artifact_create` | `kinds/mermaid.md` |
| 报告 / 正式文档(打印分享) | `pdf` | `artifact_create_pdf` | `kinds/pdf.md` |
| 表格 / 多 sheet 数据 | `xlsx` | `artifact_create_xlsx` | `kinds/xlsx.md` |
| 平铺数据导出 | `csv` | `artifact_create_csv` | `kinds/csv.md` |
| Word 提案 / 协议 | `docx` | `artifact_create_docx` | `kinds/docx.md` |
| PPT 演示 | `pptx` | `artifact_create_pptx` | `kinds/pptx.md` |
| 长文 / Markdown 笔记 | `markdown` | `artifact_create` | `kinds/markdown.md` |
| 代码片段 / 脚本(可下载) | `code` | `artifact_create` | `kinds/code.md` |
| JSON 数据集 | `data` | `artifact_create` | `kinds/data.md` |
| 图片(base64) | `image` | `artifact_create` | `kinds/image.md` |

模糊场景拿不准 → 先按上表挑最近的一行动手,产出后用户会修正方向,比反问 4 个问题快 100×。

## 调用契约

**所有 `artifact_create*` 工具一次调用 = 落库 + 渲染卡片。** 你**不需要**再调 `artifact_render(id)` —— tool 返回值里已经带了 `Artifact.Preview` / `Artifact.Card` 信封,聊天会自动出卡片。

| kind | 卡片形态 |
|---|---|
| html / drawio / mermaid / image / csv / data | **内联预览**(聊天里直接看) |
| pptx / docx | **可点击卡片**(聊天显示「在制品区打开」按钮) |
| markdown / code / xlsx 大于 200 KB | 自动降级为可点击卡片 |
| pdf 大于 2 MB | 自动降级为可点击卡片 |

无论哪种形态,用户都能看到产出在哪儿。

## 工作流

每个 kind 的细节(参数 / 限制 / 调用示例)都在 `kinds/<kind>.md` 子文件。复杂场景前 `read_skill_file('allhands.artifacts', 'kinds/<kind>.md')` 拉细节。

## 调用示例

```
artifact_create({kind:"html", name:"q1-board.html", content:"<!doctype html>..."})
render_drawio({name:"login-flow", xml:"<mxfile>...</mxfile>"})
artifact_create_pdf({source:"markdown", name:"report.pdf", content:"# Q1\n..."})
```

## 编辑 / 搜索 / 多版本

详细见子文件:
- `workflows/edit-existing.md` — 「基于上次那份接着改」的流程
- `workflows/multi-version.md` — 版本切换、回滚
- `workflows/cleanup.md` — 删 / 置顶 / 标签

简明流程:
1. `artifact_search(query)` 或 `artifact_list(kind?)` —— 找 id
2. `artifact_read(id)` —— 把内容拉回上下文
3. 改完调对应的 producer(同 kind 用同样的 create 工具,系统会按 update 路径走 confirmation gate)

## 自检 · 反幻觉

调 producer **之前** 在内心默念:**"我要在这条回复里真正调一次工具,不是只描述。"**

如果你写出了 「这是一个 X」「我已经为你 X」「I've created X」「为您生成」「以下是」 这种句子但**没**调 `artifact_create*` 工具 —— 你在骗用户。聊天里不会出现卡片,用户面对一段空话。**STOP,先调工具,然后用一两句话说图/页/文表达了什么 —— 不需要再粘内容,卡片会渲染。**

## 输出文风

调完 producer 之后,你的聊天回复**只说三件事**:
1. 这是什么(一句话)
2. 关键设计点(2-3 个 bullets,可选)
3. 想再改什么方向(一句话引导,可选)

**不要重复粘 XML / HTML / mxfile / 表格内容** —— 卡片就是给用户看的。

## 常见坑

- ❌ 调 `artifact_create` 后再调 `artifact_render` —— 多余 · create 已自动渲染
- ❌ 把 `content` 同时粘到聊天回复 —— 用户看了卡片 · 重复粘是噪音
- ❌ 把 mxfile / html / mermaid 源码贴到聊天里 —— 用对应 producer · 不要走 chat
- ❌ 模糊请求反问类型 —— 先按合理默认动手 · 用户基于实物迭代快 100×
- ❌ 主动 delete 用户没明说要删的 —— delete 是 IRREVERSIBLE · 严肃
- ❌ 一次 update 多个 artifact —— confirmation gate 一次一个 · 串行清晰

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 工具返回 `error: ...` | 看错误信息修参数 · 不要把错误吞掉装作成功 |
| 产出渲染异常(用户说"是黑的") | 换 kind 或重新生成 · drawio 多半是 mxGeometry 漏了 / html 多半是 head 缺 charset |
| 用户说「这不是我要的」 | 别硬重画 · 问清楚关键差异(类型 / 主题 / 数据规模)再来 |
