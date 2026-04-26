# kind: xlsx · Excel 工作簿

## 何时用

- 用户说「Excel / xlsx / 表格 / 多 sheet / 工作簿」
- 数据结构化、可能要排序 / 筛选 / 图表
- 用户要拿去 Excel / Numbers / 飞书表格里继续编辑

## 工具

```
artifact_create_xlsx({
  name: "sales-q1.xlsx",
  sheets: [
    {
      name: "Q1",
      headers: ["产品", "销量", "金额"],
      rows: [
        ["A 产品", 100, 9999.99],
        ["B 产品", 50, 4500],
        ["C 产品", 200, 12000]
      ]
    },
    {
      name: "Q2 预测",
      headers: ["产品", "目标"],
      rows: [["A 产品", 150], ["B 产品", 80]]
    }
  ],
  description: "<一句话>"
})
```

## 单元格类型

自动推断:`bool` / `int` / `float` / `str` / `null`。混合类型同列时按 str 渲染。

字符串以 `=` 开头会被自动转义(防 formula injection),用户在 Excel 里看到的就是字面量。如果**真的**想要公式,加注释让用户知道。

## 多 sheet 是默认能力

```
sheets: [
  { name: "汇总", headers: [...], rows: [...] },
  { name: "明细", headers: [...], rows: [...] },
  { name: "趋势", headers: [...], rows: [...] }
]
```

## 内联预览策略

- ≤ 200KB → 聊天里表格内联(显示 sheet 切换 + 前 N 行)
- > 200KB → 卡片提示 · 用户在制品区看

## 工作流

1. 把数据组织成 `sheets[]` · 每个 sheet 一个 `{name, headers, rows}` 对象
2. `artifact_create_xlsx({name, sheets, ...})`
3. 一句话说 workbook 包含什么

## 常见坑

- ❌ rows 不是矩形(每行列数不同)→ Excel 解析报错 · 缺值用 null 占位
- ❌ headers 数量 ≠ rows 第一行长度 → 列对不齐 · 检查
- ❌ 单元格塞了 dict 或 list → 自动 stringify · 但用户不想看 `{'k': 'v'}` · 提前打平

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 工具返回 size 超 | 拆分成多个小 workbook 或换 csv |
| 中文 sheet 名乱码 | 不应该 · 报 issue · 临时换英文 sheet name |
