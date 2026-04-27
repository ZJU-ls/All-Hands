# kind: csv · 平铺数据导出

## 何时用

- 用户说「CSV / 导出 / 平铺数据 / 一份数据」
- 只要一张表(没 sheet 概念)
- 下游消费方要 CSV(Excel / Pandas / SQL import / 飞书)

需要多 sheet → `xlsx`。需要复杂格式 → `pdf` 或 `docx`。

## 工具

```
artifact_create_csv({
  name: "users.csv",
  headers: ["id", "email", "joined_at"],
  rows: [
    [1, "alice@x.com", "2026-01-15"],
    [2, "bob@y.com", "2026-02-20"]
  ],
  description: "<一句话>"
})
```

## 编码 / 分隔

- UTF-8 with BOM —— Excel for Windows 打开 CJK headers 不乱码
- 默认分隔符 `,` —— 字段含 `,` 时自动加引号
- 换行 `\r\n` —— 跨平台兼容

## 内联预览策略

聊天里直接展示前 N 行表格(虚拟滚动)。所有 csv 都内联(csv 体量小)。

## 工作流

1. 把数据组织成 `headers + rows`
2. `artifact_create_csv({name, headers, rows})`

## 常见坑

- ❌ rows 长度 ≠ headers 长度 → 行错位 · 检查
- ❌ 字段里有未转义的引号 → 解析错 · 工具会自动转义,但你**不要**手动加引号
- ❌ 把日期写成 `2026/4/26` → Excel 美式区会解释成 4 月 26 日 · 推荐 ISO `2026-04-26`

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 用户说 Excel 打开乱码 | UTF-8 BOM 应该 ok · 让用户检查打开方式(数据→自文件,而非双击) |
| 字段有逗号显示串行 | 工具应自动加引号 · 如出 issue 改用 `\t` 分隔(导出 tsv) |
