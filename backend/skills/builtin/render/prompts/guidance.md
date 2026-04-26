# 可视化渲染指南 · allhands.render

## 何时调用

向用户展示信息时优先用 `allhands.render.*` 工具,而不是写一大段 markdown。结构化工具让用户一眼看到关键数据。

触发关键词:展示「比较 / 列表 / 表格 / KPI / 趋势 / 进度 / 对比 / 选项 / 步骤」 → 用这套技能。

## 工作流

1. **判断展示形态**(看下面对照表)
2. **选 1 个工具调用** — 一条消息一个 viz · 必要时再组合
3. **保证数据完整** — 用户决策需要的字段全部露出 · 不能只给 ✓/✗

## 判断表(对照选工具)

| 展示什么 | 用这个工具 |
|---|---|
| 多条记录 × 多属性 | `allhands.render.table` |
| 单对象详情 | `allhands.render.kv` |
| 2-6 个并列方案 | `allhands.render.cards` |
| 时间顺序 | `allhands.render.timeline` |
| 步骤 / wizard | `allhands.render.steps` |
| 代码片段 | `allhands.render.code` |
| 文本前后对比 | `allhands.render.diff` |
| 提示 / 警告 | `allhands.render.callout` |
| 外链推荐 | `allhands.render.link_card` |
| 长说明 (>500 字) | `allhands.render.markdown_card` |
| 单 KPI 数值 | `allhands.render.stat` |
| 时间趋势 | `allhands.render.line_chart` |
| 类别对比 (≤ 20) | `allhands.render.bar_chart` |
| 占比 (≤ 6 片) | `allhands.render.pie_chart` |

## 调用示例

```
# 「展示三个候选模型的延迟对比」
allhands.render.bar_chart({
  title: "三模型延迟对比 (p50)",
  bars: [
    {label: "gpt-4o", value: 320},
    {label: "claude-3-haiku", value: 180},
    {label: "qwen3-plus", value: 240}
  ],
  unit: "ms"
})

# 「展示运行结果」
allhands.render.kv({
  title: "Q1 销售简报已生成",
  rows: [
    {key: "运行耗时", value: "2.3s"},
    {key: "Token 用量", value: "8,432"},
    {key: "artifact id", value: "art_xxx"}
  ]
})
```

## 常见坑

- **不要写「1. 这个 2. 那个」markdown 列表** · 能用 cards / steps / table 就用
- **数据量 > 100 行** · 不要 table · 改 `artifact_create(kind=data)` 存数据 + `artifact_render` 预览
- **不生成带按钮的交互 UI**(除非用户明确要)· render 只展示
- **运行 / 测试 / 实验结果** 必须把用户下一步决策需要的字段全部露出(延迟 / Token / 成本 / 失败原因) · 不能只 ✓/✗
- **单行简短回复**(「好的 · 已完成」)直接说 · 不用 render

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| 不确定用哪个 viz | 先 `allhands.render.markdown_card` · 下一轮迭代 |
| `bar_chart` 数据 > 20 项 | 切换 `table` 或者把数据筛 top-N |
| 用户说「太花哨」 | 简化成 callout / kv / 或纯文本回复 |

## 视觉契约

颜色 / 间距 / 边框由前端按 Brand Blue Dual Theme 实现 · 你只塞正确数据即可。
