# All Hands · pptx 骨架(Brand Blue)

`artifact_create_pptx` 接 `slides[]`,每张 slide 一个 layout。这里给 brand-flavored 的 6-slide 标准稿大纲 + 每张 slide 的内容形态约定。

## 标准 6-slide deck

| 序号 | layout | 用途 |
|---|---|---|
| 1 | `title` | 主题封面 · 三色渐变标题 + 副标题 + 日期 |
| 2 | `bullets` | Key Points · 3-5 条要点 |
| 3 | `section` | 章节封 · 大字主题(暗主题更出彩) |
| 4 | `bullets` | 关键指标 · 用「数字 + 字段」结构 |
| 5 | `image-right` | 图配文 · 如 drawio 截图(image_url 用 base64 data URL) |
| 6 | `bullets` | 总结 · 3 条结论 + 1 行 next steps |

## 调用示例

```
artifact_create_pptx({
  name: "q1-review.pptx",
  slides: [
    {
      layout: "title",
      title: "Q1 业务回顾",
      subtitle: "All Hands · 2026 年第一季度"
    },
    {
      layout: "bullets",
      title: "关键发现",
      bullets: [
        "ARR 增长 18% · 续约率 94%",
        "新签客户数 1,240 · YoY +35%",
        "成本下降 7% · 团队效能提升"
      ]
    },
    {
      layout: "section",
      title: "第二章 · 风险与对策"
    },
    {
      layout: "bullets",
      title: "三大风险",
      bullets: [
        "竞品压力 · A 公司新功能 · 应对:加速 v2 路线",
        "人才流失 · 关键岗位 · 应对:股权激励调整",
        "成本曲线 · 模型推理 · 应对:开 GPU 议价 + 长上下文 caching"
      ]
    },
    {
      layout: "image-right",
      title: "Q1 趋势可视化",
      bullets: [
        "ARR 曲线持续上扬",
        "月环比 +5% / 6% / 7%",
        "Q4 略放缓但未失速"
      ]
      // image_url: "data:image/png;base64,..."  // 可选 · 嵌入截图
    },
    {
      layout: "bullets",
      title: "下一季度",
      bullets: [
        "v2 GA · 4 月底",
        "进入 EMEA · 5 月开始",
        "招聘 · 全栈 5 人 / SE 3 人"
      ]
    }
  ],
  description: "Q1 业务回顾标准 6 张 deck"
})
```

## 关键点

- **layout=title 用作主题封面**,标题会以默认 Office "Title Slide" master 渲染。Brand 色无法在 pptx 工具层注入(Office 用自己的 theme),所以纯靠**字数和层级清晰**取胜。
- **layout=section 用于章节封**,只有 title。**必须用** —— 单纯 bullets 翻 5 张不分章 = 信息流糊。
- **image-right** 在右半边放图,左半 title + bullets。`image_url` 必须 `data:image/png;base64,...`(不能 https)。
- **每张 bullets ≤ 5 条**。多了塞不下,Office 会自动缩字号,看着廉价。
- 相似主题用平行结构: 「问题 · 影响 · 应对」、「指标 · 现状 · 目标」 —— 让翻页节奏稳定。

## 内联预览 vs 下载

PPTX 永远走 `Artifact.Card`(聊天里只显示卡片 · 点击在制品区下载)· 因为 Office layout / theme 体感只有在 PowerPoint / Keynote / WPS 打开时才完整。聊天里硬展示标题 + bullets 会让用户误以为 PPT 长那样。

## 失败兜底

| 现象 | 做什么 |
|---|---|
| Office 打开报"无法读取"| layout 错 · 必须 title/bullets/section/image-right 之一 |
| 中文乱码 | 不该出现 · 默认 fallback 字体支持中文 · 如出报 issue |
| image_url 不显示 | 检查 base64 前缀是否 `data:image/png;base64,` 完整 |
