# kind: docx · Word 文档

## 何时用

- 用户说「Word / docx / 提案 / 协议 / 合同模板」
- 用户最终要拿去 Word / WPS 编辑(不是只看,而是要改 + 走流程)

如果用户只是要看 → `pdf` 更好。需要交互 / 数据看板 → `html`。

## 工具

```
artifact_create_docx({
  name: "proposal.docx",
  blocks: [
    { type: "heading", level: 1, text: "Q1 提案" },
    { type: "paragraph", text: "我们建议..." },
    { type: "list", ordered: false, items: ["重点一", "重点二", "重点三"] },
    { type: "heading", level: 2, text: "时间线" },
    {
      type: "table",
      headers: ["阶段", "起止", "负责人"],
      rows: [
        ["调研", "1 月", "Alice"],
        ["设计", "2 月", "Bob"],
        ["实施", "3 月", "团队"]
      ]
    },
    { type: "code", language: "python", text: "def hello(): pass" }
  ],
  description: "<一句话>"
})
```

## 支持的 block 类型

| type | 必备字段 | 用途 |
|---|---|---|
| `heading` | `level` (1-6) · `text` | 章节标题 |
| `paragraph` | `text` | 普通段落 |
| `list` | `ordered` (bool) · `items` (list[str]) | 无序 / 有序列表 |
| `code` | `text` · `language` (可选) | 等宽段落 |
| `table` | `headers` · `rows` | 表格 |

未知 type 会被跳过 + 一条 warning。

## 内联预览

docx 不内联(就算内联了也只显示文本,失去 Word 排版意义)→ **总是返 Artifact.Card**(可点击 → 制品区下载)。这是预期行为,用户在 Word / WPS 打开看正确版式。

## 工作流

1. 把内容组织成 `blocks[]` 序列
2. `artifact_create_docx({name, blocks})`
3. 一句话说 docx 内容是什么 · 用户点卡片下载到本地用 Word 打开

## 常见坑

- ❌ blocks 里塞 list / dict 当 text → 自动 stringify · 用户看到 `['a', 'b']` 字面量 · 提前打平
- ❌ table 的 rows 长度跟 headers 不一致 → 列错乱 · 必须一致
- ❌ 想要图片 → 当前不支持 · 用 `pdf` (html source + base64 img)

## 失败兜底

| 现象 | 做什么 |
|---|---|
| Word 打开报损坏 | 通常是 blocks 结构错 · 检查 type / 必备字段 |
| 标题层级乱 | level 必须 1-6 · 不要 0 或 7+ |
