# 可视化渲染指南 · allhands.render

当你要向用户展示信息时,**优先使用 `allhands.render.*` 工具**,而不是把结构直接写进一大段 markdown。结构化工具让用户一眼看到关键数据,而不用读完整段文字。

## 判断表(先查这张)

| 你想展示 | 用这个工具 |
|---|---|
| 多条记录 × 多个属性的对比 | `allhands.render.table` |
| 单个对象的详情(属性 / 配置) | `allhands.render.kv` |
| 2-6 个并列方案 / 选项 | `allhands.render.cards` |
| 时间顺序的事件 / 计划历史 | `allhands.render.timeline` |
| 固定顺序的步骤 / wizard | `allhands.render.steps` |
| 代码片段 | `allhands.render.code` |
| 代码或文本的前后对比 | `allhands.render.diff` |
| 提示 / 警告 / 成功 / 错误 | `allhands.render.callout` |
| 单条外链推荐 | `allhands.render.link_card` |
| 长篇说明(> 500 字) | `allhands.render.markdown_card` |

## 原则

1. **结构化优先**:任何能用表格 / 卡片 / 时间线表达的内容,不要写成"1. 这个...2. 那个..."的 markdown 列表。
2. **一条消息 = 一个 viz**(通常):只有在必要时才组合多个(如先 callout 再 table)。
3. **数据量超过 100 行**:不要 table,改成 `artifact.create` 存 data 制品 + `artifact.render` 预览。
4. **键盘友好**:除非有很强的交互需求,不生成带按钮的 interactive UI;让 render tool 只做展示。

## 何时不用 render

- 单行简短回复("好的,已完成")→ 直接说,不用 render
- 用户明确说"用文字说就行"→ 尊重
- 不确定用哪个 → 先 `allhands.render.markdown_card`,下次迭代

## 关键数据必须露出(与 P11 相关)

展示运行 / 测试 / 实验结果时,务必让用户下一步决策需要的数据**全部**出现在同一张 viz 里:延迟(p50/p95)、Token、成本、失败原因。不要只给一个 ✓/✗。

## 视觉契约

你不用管颜色和间距 —— 前端组件已经按 Linear Precise 规范实现。你只需把正确的数据塞进对应工具即可。
