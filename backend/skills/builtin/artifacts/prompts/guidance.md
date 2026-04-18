# 制品区使用指南 · allhands.artifacts

**凡是有独立价值的产出,存成制品。** 不要只在对话里贴出来。制品区是用户回头找、接着改、下载分享的地方;对话是过程,制品是成果。

## 判断表(先查这张)

| 产出形态 | 用这个工具 | kind |
|---|---|---|
| 长文档 / 策划 / 报告 / 手册 | `artifact_create` | `markdown` |
| 代码片段 / 脚本 / 配置 | `artifact_create` | `code` |
| HTML 原型 / 嵌入式页面 | `artifact_create` | `html` |
| 图片(用户上传或你生成) | `artifact_create` | `image` |
| JSON / CSV / 结构化数据 | `artifact_create` | `data` |
| 流程图 / 时序图 / 架构图 | `artifact_create` | `mermaid` |

## 何时 create

- 用户让你"写一份 X"(文档 / 代码 / 规划 / 报告)→ create artifact
- 你产出了完整独立的工件(图 / 数据表 / 脚本)→ create artifact
- 工件值得回头迭代 → create artifact
- 中间思考过程、简短回复、临时片段 → **不要** 存

## 何时 update vs 新 create

- 同一个工件的**迭代**(v2 / v3)→ `artifact_update`(会弹 confirmation + diff 预览)
- 不同目的的新产出 → 新 `artifact_create`
- 大改(推翻重写)也是 `artifact_update` · mode=overwrite;小改用 mode=patch(只传 unified diff)

## 每次 create / update 后必做

调 `artifact_render(id)` 在聊天里嵌入预览。**不要** 把 content 直接粘进回复 —— 用户在制品区就能看原物,重复粘贴反而干扰。

## 读历史制品

用户让"基于昨天的 X 接着做":
1. `artifact_search` 或 `artifact_list` 找到 id
2. `artifact_read(id)` 拉内容进上下文
3. 动手改 → `artifact_update`

## 不要

- 不要同一份内容既 create 又粘贴到回复正文
- 不要一次 update 动多个 artifact(一次一个,confirmation 才清楚)
- 不要 delete 用户没明说要删的 —— delete 会弹 IRREVERSIBLE 确认,严肃
- 不要为临时交流片段建 artifact(聊天会话里几句话的东西不配)

## confirmation 契约

- `artifact_create` / `artifact_render` / `artifact_list` / `artifact_read` / `artifact_search` / `artifact_pin` — 无确认
- `artifact_update` — **弹 confirmation(展示 diff)**;调用前告诉用户你要改什么
- `artifact_delete` — **IRREVERSIBLE** 确认;仅在用户明说要删时调

## 视觉契约

你不用管配色和间距 —— 制品面板前端已按 Linear Precise 规范实现,你只负责把正确的数据 / 正确的 kind 塞给工具即可。
