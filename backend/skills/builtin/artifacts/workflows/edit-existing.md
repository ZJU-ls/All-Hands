# workflow: 编辑已有制品

## 触发

用户说:
- 「基于昨天那份接着改」
- 「在 X 报告里加一节 Y」
- 「Q1 deck 的第 3 页改成 Z」
- 「把上次那个 HTML 的颜色调蓝」

## 三步

### 1 · 找 artifact_id

不知道 id 时:

```
artifact_search(query="Q1 deck")          # 全文搜
# 或
artifact_list(kind="pptx", limit=20)      # 按 kind 列
```

返回 `[{id, name, kind, version, updated_at, ...}]`。挑出目标的 `id`。

### 2 · 读回内容

```
artifact_read(artifact_id)
# 返回 {content, mime_type, version, ...} 或 {content_base64, ...}
```

把 content 内化成上下文,准备改。

### 3 · 改完写回

**关键决定:overwrite 还是 patch?**

- `mode: "overwrite"` —— 大改 / 整段重写。把完整新内容传过去
- `mode: "patch"` —— 小改 · 仅 TEXT kinds(markdown / code / html / data / mermaid) · 传 unified diff

```
artifact_update(
  artifact_id="abc-123",
  mode="overwrite",
  content="<完整新内容>",
  change_message="加了风险章节"   # 推荐 · 写到 ArtifactVersion.change_message
)
```

`update` 会弹 confirmation gate,前端展示 diff,用户确认后才落库。同一个 artifact 自动 v+1,旧版本可 rollback。

## 多种制品组合编辑

用户说「把 Q1 报告里的趋势图换成最新数据」可能涉及两个 artifact:
1. drawio 趋势图
2. 报告 docx / pdf

各自独立编辑,confirmation 各自弹。**不要一次 update 多个 artifact**。

## 常见坑

- ❌ 没先 read 就 update → 用户最近改过的内容被你的旧版本覆盖 · 总是先 read
- ❌ patch 模式给 binary kind → 报错 · binary 必须 overwrite
- ❌ 不写 change_message → 历史看不出每版改了啥
