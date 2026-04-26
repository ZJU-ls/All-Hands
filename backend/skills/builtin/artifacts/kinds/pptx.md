# kind: pptx · PowerPoint 演示

## 何时用

- 用户说「PPT / pptx / 演示 / 幻灯片 / deck」
- 用户最终要 PowerPoint / Keynote / WPS 演示文稿打开

如果用户只是要看一份图文混排页面 → `html` 更轻 + 可交互。

## 工具

```
artifact_create_pptx({
  name: "deck.pptx",
  slides: [
    { layout: "title", title: "季度回顾", subtitle: "Q1 2026" },
    { layout: "bullets", title: "亮点",
      bullets: ["营收 +18%", "客户数 +35", "续约 94%"] },
    { layout: "section", title: "第二章 · 风险" },
    { layout: "image-right", title: "趋势",
      bullets: ["环比稳定上升", "Q4 略有放缓"],
      image_url: "data:image/png;base64,..." }
  ],
  description: "<一句话>"
})
```

## 支持的 layout

| layout | 必备 | 可选 |
|---|---|---|
| `title` | `title` | `subtitle` |
| `bullets` | `title` | `bullets[]` · `body` |
| `section` | `title` | (分章封页) |
| `image-right` | `title` | `image_url`(data: URL)· `bullets[]` |

未知 layout 自动跳过 + warning。

## 内联预览策略

pptx **永远** 返 `Artifact.Card`(聊天里只显示卡片)。原因:在线预览只能展示标题 + bullets 文字,会让用户误以为 PPT 长那样;用户在 PowerPoint / Keynote 打开才有完整布局 / 图形 / 字体。

## 工作流

1. 想清楚要几页 + 每页 layout
2. 标题页 + 章节页 + 内容页混合用 · 不要全是 bullets
3. `artifact_create_pptx({name, slides})`
4. 一句话说 deck 在讲什么 · 用户点卡片下载

## 常见坑

- ❌ 一张 slide 塞 20 个 bullets → 渲染挤 · 拆成多张
- ❌ image_url 用 https://... → 当前生成器不会拉外网 · 失败 · 用 base64 data URL
- ❌ 想要复杂图表 / 动画 → 当前不支持 · 在 slide 里嵌入说明 + 把图作为 separate artifact (drawio / image)

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 用户说"打开是空白" | 检查每张 slide 是否有 title 字段 · title 必填 |
| layout 不识别 | 用 `title` / `bullets` / `section` / `image-right` 之一 |
| 字体异常 | 现代 Office 默认字体 (Calibri / 等线) · 中文用系统默认 · 不指定 font |
