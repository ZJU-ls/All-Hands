# All Hands · Design Tokens 详表

源头:`web/styles/themes/brand-blue/{light,dark}.css` 是权威 · 这里是给 LLM 抄的副本。**任何颜色一定走 var(--xxx)**,不要硬写 hex。

## 浅主题(prefers-color-scheme: light · 默认)

```
Surfaces              | Light                            | Dark
----------------------|----------------------------------|---------------------------------
--bg                  | #F6F8FC                          | #0A0D14
--surface             | #FFFFFF                          | #11151F
--surface-2           | #EDF1F8                          | #1A1F2E
--surface-3           | #DFE6F0                          | #242A3C
--surface-4           | #B9C4D4                          | #3A425A

Borders               |                                  |
--border              | #DFE6F0                          | rgba(255,255,255,.06)
--border-strong       | #B9C4D4                          | rgba(255,255,255,.12)

Text                  |                                  |
--text                | #141A26                          | #E2E6F1
--text-muted          | #5C667A                          | #8690AE
--text-subtle         | #8B96AB                          | #5A6483

Brand · 主色          |                                  |
--primary             | #0A5BFF (royal azure)            | #2E5BFF (electric cobalt)
--primary-hover       | #0848D1                          | #4A74FF
--primary-fg          | #FFFFFF                          | #FFFFFF
--primary-muted       | rgba(10,91,255,.10)              | rgba(46,91,255,.12)
--primary-soft        | rgba(10,91,255,.10)              | rgba(46,91,255,.14)
--primary-glow        | rgba(10,91,255,.22)              | #6E8BFF
--accent              | #4EA8FF (sky highlight)          | #6E8BFF (cobalt glow)

Status                |                                  |
--success             | #0FA57A                          | #2EBD85
--warning             | #D97706                          | #F5A524
--danger              | #DC2626                          | #F04438
--success-soft        | rgba(15,165,122,.10)             | rgba(46,189,133,.14)
--warning-soft        | rgba(217,119,6,.10)              | rgba(245,165,36,.14)
--danger-soft         | rgba(220,38,38,.10)              | rgba(240,68,56,.14)

Roles · 对话角色色     |                                  |
--role-user           | #0A5BFF                          | #4A74FF
--role-lead           | #6366F1 (indigo)                 | #A78BFA (violet)
--role-worker         | #0FA57A                          | #2DD4BF
--role-tool           | #D97706                          | #FBBF24

Data viz · 6 阶图表色 |                                  |
--viz-1               | #0A5BFF azure                    | #4A74FF cobalt
--viz-2               | #0FA57A emerald                  | #2DD4BF teal
--viz-3               | #D97706 amber                    | #FBBF24 amber
--viz-4               | #DC2626 rose                     | #F87171 rose
--viz-5               | #6366F1 indigo                   | #A78BFA violet
--viz-6               | #0EA5E9 sky                      | #38BDF8 sky
```

## Spacing · 间距

```
4   |  ↑ tight (icon gap, pill padding y)
8   |  paragraph gap, button gap
12  |  card inner spacing tight
14  |  card inner spacing default
16  |  section blocks
20  |  card padding
24  |  page margin (mobile)
32  |  page margin (desktop), section gap
48  |  hero padding y
64  |  hero padding y (landing)
```

## Radius · 圆角阶梯

```
4px   pill, kbd, small inline tag
6px   chip, badge
8px   button, input
10px  small card, code block
12px  card (default)
14px  large card
16px  feature card, modal
20px  hero card / showcase
24px  poster, full-page hero
999px pill (capsule)
```

**规则:组件越大越圆。** card 默认 12px,大 hero 类元素 16-24px。

## Shadow · 阴影 / 光晕

```
--shadow-sm  | 0 1px 2px rgba(15,23,42,.04), 0 1px 1px rgba(15,23,42,.03)   /* 细微浮起 */
--shadow-md  | 0 4px 14px rgba(15,23,42,.06), 0 2px 4px rgba(15,23,42,.04)  /* hover state */
--shadow-glow| 浅: 0 8px 24px rgba(10,91,255,.18)                            /* CTA 强调 */
             | 暗: 0 0 0 1px rgba(110,139,255,.35), 0 12px 32px rgba(46,91,255,.4)
```

暗主题阴影几乎看不见,改用 **glow**(primary-glow 内发光 + 大阴影)。

## Typography · 字体

```
font-family: -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC",
             "Microsoft YaHei", system-ui, sans-serif;
```

字号阶梯:
```
11px  pill, eyebrow, table header (uppercase + letter-spacing .06em)
12px  caption, footnote
13px  default UI (button, table cell)
14px  body (default)
15px  body emphasis, tagline
17px  hero lead
20-24px  h2 / h3
28-36px  h1 (in card / wrap)
56-96px  hero h1 (landing / poster)
```

字重:
```
400  default body
500  pill, button, eyebrow
600  h3, table header
700  h1, h2, stat value
800  hero h1 (landing / poster)
```

字距:
```
-.03em  hero h1 (landing)
-.025em h1 (default)
-.02em  h2, stat value
-.015em section h2
.04em   uppercase tag
.06em   stat label
.08em   eyebrow
.12em   poster eyebrow
```

## Animation · 微动效

```
transition: all 200ms ease;          /* default */
transition: transform 200ms ease,
            box-shadow 200ms ease,
            border-color 200ms ease;  /* card hover */

translateY(-1px) → translateY(-2px)  /* 卡片 hover · 越大动越多 */
```

**禁止**:JS 动画库(Framer / GSAP)· 长 keyframes loop · 视差。CSS transition + transform 足够。

## 三个签名签证你的产出真是 All Hands

1. **渐变标题**(hero h1 用 primary→indigo→accent 三色)
2. **prefers-color-scheme: dark 自适配**(暗主题完整 token + mesh hero)
3. **font-variant-numeric: tabular-nums**(任何数字 KPI)

少一个就显平庸 · 三个齐上立刻有品牌感。
