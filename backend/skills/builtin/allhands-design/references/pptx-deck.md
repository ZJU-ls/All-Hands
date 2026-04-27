# pptx 设计语言 · brand-blue dual theme

激活 `allhands-design` 后,产 `.pptx` 走 `artifact_create_pptx`。**工具只接 primitives**(`text` / `rect` / `line` / `image` / `chart`,绝对坐标 / 颜色 / 字号都得你给),所以这份指南承担**全部设计决策**。

> 默认画布 13.333" × 7.5"(16:9 widescreen)。所有坐标 / 尺寸单位是 inch,左上角 (0,0)。
> 颜色必须 `#RRGGBB` 六位 hex。
> chart `series[i].values` 长度必须 == `categories` 长度。
> 错配时工具回 `{error, field, expected, received, hint}`,照 hint 改下一轮就对。

## 1. 4 条设计原则(source: [Anthropic skills · pptx](https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md))

1. **60-70% 主色 / 1-2 辅色 / 1 个尖锐 accent** —— 同一张 deck 不要 4+ 色族
2. **重复一个视觉母题**(色带 / 圆形 / 横线 / 数字角标)贯穿 deck
3. **One idea per slide** —— 一页只讲一个观点
4. **字号梯度**:title ≥ 36pt · subtitle 24pt · body 16-18pt · caption ≤ 12pt

## 2. brand-blue token 表(source: `web/styles/themes/brand-blue/{light,dark}.css`)

### dark theme(deck 默认)

| token | hex | 用途 |
|---|---|---|
| `bg` | `#0a0e1a` | page / slide 背景 |
| `surface` | `#131826` | 卡片 / 区块底 |
| `text` | `#e7eaf3` | 主文 |
| `text-muted` | `#93a0b4` | 次文 / caption |
| `primary` | `#3b82f6` | 主色 · 强调元素 |
| `accent` | `#60a5fa` | accent · 一处尖锐对比 |
| `hairline` | `#1e2536` | 细分隔线 |

### light theme

| token | hex | 用途 |
|---|---|---|
| `bg` | `#ffffff` | page / slide 背景 |
| `surface` | `#f6f8fc` | 卡片 / 区块底 |
| `text` | `#0a0e1a` | 主文 |
| `text-muted` | `#64748b` | 次文 / caption |
| `primary` | `#2563eb` | 主色 |
| `accent` | `#3b82f6` | accent |
| `hairline` | `#e6eaf2` | 细分隔线 |

**用法:** 一张 slide 的 `background` 与文字色族**绑死同一主题**(dark 主题用 dark token,反之亦然)。一页里 `accent` ≤ 1 处。

## 3. 字号梯度(直接抄)

| 角色 | size_pt | weight |
|---|---|---|
| 标题(opening / 章节封) | 56-72 | bold |
| 内页标题 | 36-44 | bold |
| 副标题 / lead | 24-28 | normal |
| 正文 / bullet | 16-18 | normal |
| caption / footer | 11-13 | normal |
| KPI 大数字 | 60-96 | bold |

行距:正文 `line_spacing: 1.4`,大字标题 `1.05`。

## 4. 视觉母题(贯穿一份 deck)

挑一个母题,每页都用一次,deck 就有节奏:

- **左色带**:`rect` x=0 y=0 w=0.18 h=7.5 `fill_hex=primary` —— 每页左侧贴一道窄色带
- **底部 hairline**:`rect` x=0 y=7.36 w=13.333 h=0.04 `fill_hex=hairline` —— 每页底缘细线
- **页码徽章**:右下角 `text` 小字 "01 / 18" —— text-muted

挑一种用足整个 deck,**不要混用**。

## 5. 叙事节奏

```
封面 → 目录 → 章节 1 (章节封 → 内容 × 1-3 → 数据 × 0-1)
                → 章节 2 → ... → 收束
```

10-18 页是常见区间,< 6 页太短(没 narrative),> 24 页用户走神。

## 6. Layout 模板索引

每个模板放在 `templates/<name>-<theme>.json`(`<theme>` 是 `dark` 或 `light`)。整张 slide 的 `shapes[]` 已铺好,你只改 `text` / `categories` / `series.values` 这种内容字段。

**调用模板:**

```
read_skill_file("allhands-design", "templates/cover-dark.json")
# → 拿到完整 slide spec(已含背景、色带、字号)
# 改文字 → 直接放进 artifact_create_pptx 的 slides[i]
```

| 模板 | 用途 |
|---|---|
| `cover` | 封面 · 大标题 + 副标题 · 一张 deck 一张 |
| `agenda` | 目录 · 编号 + 章节名 · 居左对齐 |
| `section-divider` | 章节封 · 大数字 + 短词 + 副标题 |
| `title-content` | 内页标题 + 正文段(最常用) |
| `two-column` | 左右各一栏文字 · 适合对比 |
| `image-text` | 左大图 · 右文字 · 文字默认 5-6 行内 |
| `kpi-grid` | 4 个数字徽章(最多 4 个 · 多了拥挤) |
| `chart-with-caption` | 整页图表 + 顶部 1 行解读 |
| `quote` | 居中大字引语 · 引言下方署名 |
| `closing` | 收束页 · 短句 + 联系方式 / 下一步 |

## 7. 反例(看到要警觉)

- ❌ 一页 5+ bullets · 拆成多页或换 two-column
- ❌ title > 30 字 · 信息密度过高
- ❌ KPI grid 超过 4 个数字 · 用户记不住
- ❌ 同一 fill 颜色重复 5+ 次贴 · 失去层次
- ❌ chart + 大段文字共一页 · 没 focus
- ❌ 一张 deck 4+ 个色族 · 杂

## 8. 调用示例(从模板到 deck)

```
read_skill_file("allhands-design", "templates/cover-dark.json")  # → 字典 A
read_skill_file("allhands-design", "templates/title-content-dark.json")  # → 字典 B
read_skill_file("allhands-design", "templates/closing-dark.json")  # → 字典 C

# 改 A.shapes[i].text 等内容字段
# 把 [A, B, C] 直接放进 slides

artifact_create_pptx({
    name: "<descriptive>.pptx",
    page: { background: { color_hex: "#0a0e1a" } },  # dark 主题
    slides: [A, B, C]
})
```

模板与你的内容**逐字段比对** —— 哪里改 text、哪里改数字、哪里换图,一目了然。

## 9. 失败时怎么办

| 现象 | 看 envelope 的什么字段 | 改法 |
|---|---|---|
| `field=slides[i].shapes[j].fill_hex` | `expected` 里有 `#RRGGBB` | 改成 `#3b82f6` 这种六位 hex |
| `field=...x+w` 超 page width | `expected` 列出 page 宽度 | 减小 x 或 w |
| `field=...categories` 缺失 | `expected: non-empty array` | 给 chart 加 `categories: [...]` |
| `field=...series[k].values` 长度错 | hint 里有 categories 长度 | 把 values 数补齐 |
| `field=...data_b64` decode 失败 | hint: PNG/JPEG no line breaks | 重新 base64 编码图片 · 不要带 `data:` 前缀 |
