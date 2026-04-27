# kind: pdf · 可打印分享文档

## 何时用

- 用户说「报告 / 正式文档 / PDF / 可打印 / 可分享 / 打印版」
- 内容有清晰章节 / 标题层级
- 用户最终要发给别人或归档

## 工具

```
artifact_create_pdf({
  name: "<descriptive>.pdf",
  source: "markdown",      # 或 "html"
  content: "# Q1 报告\n\n营收 +18%...",
  title: "<可选 · PDF metadata>",
  description: "<一句话>"
})
```

`source` 决定渲染管线:
- `markdown` —— 推荐 · 用 markdown-pdf 默认主题,适合长文 / 报告
- `html` —— 想精细控制版式时用 · 内容必须是完整 HTML 文档

## 渲染规则

- 体积 ≤ 1MB
- 字体内嵌 PingFang SC / Inter · 中英混排无问题
- A4 默认页面 · 自动分页
- 内联图片只支持 `data:` URL · 不能引外网 src

## 内联预览策略

- ≤ 2MB → 聊天里 PDF 内联预览(可滚动)
- > 2MB → 自动降级成可点击卡片(用户去制品区看)

## 调用示例

### markdown 源

```
artifact_create_pdf({
  name: "q1-review.pdf",
  source: "markdown",
  content: "# Q1 业务回顾\n\n## 关键指标\n\n- ARR: +18%\n- 客户: 1240\n\n## 风险\n\n续约率下降 ...",
  title: "Q1 2026 业务回顾",
  tags: ["report", "q1"]
})
```

### html 源(更精细控制)

```
artifact_create_pdf({
  name: "proposal.pdf",
  source: "html",
  content: "<!doctype html><html><head><style>...</style></head><body>...</body></html>"
})
```

## 工作流

1. 决定 source(默认 markdown)
2. 写内容 · 用清晰章节
3. `artifact_create_pdf(...)` 一次完成
4. 一句话说文档在讲什么 · 不要重复粘正文

## 常见坑

- ❌ 用 emoji 做标题 → PDF 字体可能不支持 · 渲染成方块
- ❌ 引外部图片 src → 渲染时拉不到 · 用 base64
- ❌ html source 没 `<!doctype html>` → 默认样式不生效
- ❌ 表格用了 colspan / rowspan 复杂结构 → markdown-pdf 渲染错 · 拆成多个简单表

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 文档内容空白 | 检查 markdown 是否有正文 · 标题之外要有内容 |
| 中文乱码 | 切到 source=html · 自己控制 font-family |
| 图片不显示 | 用 base64 data: URL · 不要 https://... |
