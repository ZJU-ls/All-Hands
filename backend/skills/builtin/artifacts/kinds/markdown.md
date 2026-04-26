# kind: markdown · 长文 / 笔记 / 文档草稿

## 何时用

- 用户说「写一份 X / 文档 / 笔记 / 草稿 / 文章 / 整理 / README」
- 内容主要是文字 + 少量代码块 / 表格
- 用户想后续接着改(可以下载或在制品区编辑器里改)

## 何时**不**用

- 想要打印 / 分享给非技术受众 → `pdf`
- 含交互 / 数据图表 → `html`

## 工具

```
artifact_create({
  name: "<descriptive>.md",
  kind: "markdown",
  content: "# 标题\n\n正文...",
  description: "<一句话>"
})
```

## 内容结构建议

```markdown
# 一级标题(主题)

> 一句话引言 · 给读者锚定

## 关键要点

- 三五条要点 · 每条 ≤ 一行
- 数据用粗体强调

## 详细分析

正文段落 · 一段一个意思。

```python
# 嵌入代码块用三反引号 + 语言
def hello(): pass
```

## 结论

收尾 · 下一步行动。
```

## 内联预览策略

- ≤ 200KB → 聊天里 markdown 渲染 (h1 标题 / bullets / code block 高亮)
- > 200KB → 卡片提示 · 用户在制品区看完整渲染

## 工作流

1. 写完整 markdown 字符串
2. `artifact_create({kind: "markdown", ...})`
3. 一句话说文档在讲什么

## 常见坑

- ❌ 用 emoji 当标题(`# 🎉 成功!`)→ 在某些渲染器对齐错 · 谨慎
- ❌ 表格列分隔符 `|` 数量不一致 → 渲染错位 · 写完检查
- ❌ 代码块没指定语言 → 没语法高亮 · 加 `language` 提示(```python / ```ts 等)
- ❌ 内嵌 html → markdown 渲染器可能不解析 · 真要混用就直接产 html artifact

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 渲染只显示原文 | kind 错 · 必须 markdown 不能 code |
| 列表没缩进生效 | 嵌套列表前空 2 个空格 · 不是 4 |
