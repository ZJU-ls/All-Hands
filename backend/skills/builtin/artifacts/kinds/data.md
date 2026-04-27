# kind: data · JSON 数据集

## 何时用

- 用户说「给我数据 / JSON / 数据集 / API 响应样本」
- 结构化数据 · 不是报表(报表用 xlsx / csv)
- 下游会被程序消费(不是给人读的)

## 工具

```
artifact_create({
  name: "users-sample.json",
  kind: "data",
  content: "[\n  {\"id\": 1, \"name\": \"Alice\"},\n  {\"id\": 2, \"name\": \"Bob\"}\n]",
  description: "<一句话>"
})
```

`content` 必须是合法 JSON 字符串。建议格式化(2-space 缩进)便于人审。

## 内联预览策略

- ≤ 200KB → 聊天里语法高亮 + 可折叠 JSON viewer
- > 200KB → 卡片提示 · 制品区看 / 下载

## 工作流

1. 准备 JSON 数据(注意 trailing comma 不合法)
2. `artifact_create({kind: "data", ...})`
3. 一句话说数据 schema · 给个使用 hint

## 常见坑

- ❌ Python None / True / False 没改成 null / true / false → JSON 解析失败
- ❌ 单引号 `'a'` 不是 JSON · 必须双引号 `"a"`
- ❌ 数据集太大 → 分页或按需求精简(给前 100 条)
- ❌ 数据里包含敏感信息(token / password)→ 立刻提醒用户脱敏

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 工具报 invalid JSON | 用 `json.dumps` 序列化保真 · 不要手写 |
| 用户说「我要表格不是 JSON」 | 改用 `csv` 或 `xlsx` |
