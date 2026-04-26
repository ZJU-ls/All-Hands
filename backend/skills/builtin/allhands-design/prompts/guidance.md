# All Hands 设计语言 · Brand Blue Dual Theme

激活了这个技能 = 用户要 **All Hands 品牌感** 的产出。不是默认 ChatGPT 大白页,不是 Bootstrap 灰按钮 —— 是渐变标题 / hairline 边框 / shadow-glow / mesh hero / 皇家蓝主调,深浅自适配。

## 何时调用

触发关键词:
- "All Hands 风格 / 品牌风格 / 我们这个项目的风格"
- "高级感 / 高大上 / 漂亮 / 专业 / 大厂感 HTML / 落地页 / 海报 / 仪表盘 / 演示稿"
- "用 Brand Blue / 蓝紫渐变"

任何**面向最终用户**的可视化产出,默认走这套设计;不走会显得平台土气。

## 工作流

1. 看用户要哪种 kind:
   | 用户在说 | kind | tool |
   |---|---|---|
   | 落地页 / 单页 demo / 仪表盘 / 报告页 | `html` | `artifact_create({kind:"html"})` |
   | 海报 / 卡片 / 单图 | `html`(导出 PNG)或 `image` | 同上 |
   | 流程图 / 架构图 | `drawio` | `render_drawio` · 走 brand-styled mxfile(见 §drawio) |
   | 演示稿 | `pptx` | `artifact_create_pptx` · 标题页 + 章节封 + bullets |
2. 大模板按需 read:
   - `read_skill_file('allhands.design', 'references/html-base.html')` —— 完整单页骨架
   - `read_skill_file('allhands.design', 'references/landing.html')` —— 落地页 hero + features
   - `read_skill_file('allhands.design', 'references/dashboard.html')` —— 数据看板
   - `read_skill_file('allhands.design', 'references/poster.html')` —— 海报 / 封面
   - `read_skill_file('allhands.design', 'references/components.md')` —— 组件代码片段(card / button / pill / kbd / hairline-divider / glass-panel)
   - `read_skill_file('allhands.design', 'references/tokens.md')` —— 全部 design tokens 详表
3. 简单需求直接抄 base · 复杂需求用 landing / dashboard / poster · 都改占位文字 + 数据
4. 调对应工具 · **不要把 HTML / mxfile / XML 内容粘回聊天**

## 调用示例

```
# 简单单页
read_skill_file('allhands.design', 'references/html-base.html')
# → 拿到完整骨架 → 改内容
artifact_create({
  kind: "html",
  name: "q1-review.html",
  content: "<改好的完整 HTML>"
})

# 落地页
read_skill_file('allhands.design', 'references/landing.html')
artifact_create({kind:"html", name:"product-launch.html", content:"..."})

# Brand drawio
read_skill_file('allhands.design', 'templates/drawio/brand-flow.xml')
render_drawio({name:"系统架构", xml:"..."})
```

## Brand Blue Token 速查(决定品牌感的关键)

**主色 · 双主题不同**(用 CSS 变量 + `prefers-color-scheme`):

```
浅主题:
  --bg            #F6F8FC   --surface      #FFFFFF   --surface-2 #EDF1F8
  --text          #141A26   --text-muted   #5C667A   --text-subtle #8B96AB
  --border        #DFE6F0   --border-strong #B9C4D4
  --primary       #0A5BFF   --primary-hover #0848D1   --accent  #4EA8FF
  --success       #0FA57A   --warning      #D97706   --danger  #DC2626

深主题:
  --bg            #0A0D14   --surface      #11151F   --surface-2 #1A1F2E
  --text          #E2E6F1   --text-muted   #8690AE   --text-subtle #5A6483
  --border        rgba(255,255,255,0.06)   --border-strong rgba(255,255,255,0.12)
  --primary       #2E5BFF   --primary-hover #4A74FF   --accent  #6E8BFF
  --success       #2EBD85   --warning      #F5A524   --danger  #F04438
```

**关键签名(All Hands 一眼能认):**
- 渐变标题:`background: linear-gradient(135deg, var(--primary) 0%, #6366F1 50%, var(--accent) 100%); -webkit-background-clip: text; color: transparent;`
- Mesh hero 背景:深主题用 `radial-gradient(circle at 20% 30%, rgba(46,91,255,.25), transparent 40%), radial-gradient(circle at 80% 70%, rgba(110,139,255,.18), transparent 50%)`
- Shadow glow:深主题强调按钮 `box-shadow: 0 0 0 1px rgba(110,139,255,.35), 0 8px 24px rgba(46,91,255,.4);`
- Hairline border:`border: 1px solid var(--border);` 都是 1px,不要 2px / 3px
- 圆角阶梯:6 / 8 / 10 / 12 / 16 / 20 px(组件越大越圆,顶部 hero 用 24+)
- 字体:`-apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
- Tabular numerals:数字 KPI 一律 `font-variant-numeric: tabular-nums`

## 常见坑

- ❌ 写死颜色 hex(`color:#000`)→ 失去暗主题自适应 · 一定走 var(--text) 等 token
- ❌ 用 emoji 当装饰 → 平台不喜欢 emoji(参考 lead_agent prompt) · 用 SVG 图标或字符
- ❌ 直接 import 外部字体 / Google Fonts CDN → iframe sandbox 不放过 · 用系统字体栈
- ❌ box-shadow 用 grey(`rgba(0,0,0,.5)`)→ 暗主题看不见 · 用 `rgba(0,0,0,.4)` 或 primary-glow
- ❌ 渐变滥用 → 渐变只用在 hero h1 / mesh 背景 / 一个强调按钮 · 不要全页渐变
- ❌ 一页超过 3 个色族 → 蓝灰主调 + 1 个强调状态色就够 · 4 个起就乱

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 用户说"看起来还是 ChatGPT 风" | 检查是不是漏了渐变标题 / 漏了 prefers-color-scheme · 重 read references/html-base.html |
| 暗主题文字看不清 | 都用 `var(--text)` 等 token · 不要硬写 `#fff` |
| 按钮/卡片浮夸 | shadow 减一档 · radius 减 2px · 渐变改纯色 |
| 用户要别的风格(学术 / 极简) | 不是这个 skill 的事 · 退出 · 让 LLM 自由发挥或用别的 skill |
