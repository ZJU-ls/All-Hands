# 03 · Visual Design · Brand Blue Dual Theme

> **视觉方向:Arc / Raycast 活力蓝 · 双主题(light + dark)· theme pack 架构**
>
> **此文档是 v1 视觉契约。** 所有 `web/` 下的新增代码必须遵守;违反打回。权威决策来源:[ADR 0016 · Brand-Blue Dual Theme](./adr/0016-brand-blue-dual-theme.md)。Token 值或契约变更必须先改本文件,再同步 `web/styles/themes/` 与 `design-system/MASTER.md`。

## 作废与替代

本版本**整体替代** 2026-03 的 "Linear Precise" 规范。以下旧条款**全部废止**,PR 中再出现一律打回:

- 旧 §0 "三条最高纪律"(禁第三方 icon 库 · 颜色密度 ≤ 3 · 动效 2px 位移上限)
- 旧 §0.4 "BAN 1"(禁 colored `border-left` accent)与 "BAN 2"(禁 gradient text)—— ADR 0013 相关条款作废
- 旧 §2 "第三方 icon 禁令" —— ADR 0009 从"唯一 icon 来源"降级为"特殊符号来源"
- 旧 §3.4 "Card hover 只变边框亮度 · 禁位移" —— 改为允许 `-translate-y-px` / `shadow-soft` 交互反馈
- 旧 §5 "`.light` / `.dark` class 硬切" —— 改为 `data-theme-pack` + `data-theme` 双维度

**保留**(未受影响):

- ADR 0012 viz palette(`viz-1…viz-6`)· 独立于主题
- ADR 0013 字号阶梯的表(`text-caption…text-display`)· 仅作废其中的 BAN 1 / BAN 2
- §9.1 Voice & Tone · I-0013 文案纪律
- §7 Component Registry 机制

---

## § 0 · 五条设计原则(取代旧"三条最高纪律")

本契约不再以禁令为主,而以**设计指引**为主。5 条原则排序即优先级,冲突时高位覆盖低位。

### P1 · 跨主题一致性

dark 与 light 必须传递**同一份信息语义** —— 激活 / 层级 / 状态区分方式一致,**只是色值变**。
- 侧边栏激活在 dark 是 `bg-primary/10` + 左 2px 色条 → light 也必须是 `bg-primary-muted` + 左 2px 色条
- 主要 CTA 在 dark 用 `shadow-glow-sm` 强调 → light 对应用 `shadow-soft` / `shadow-soft-lg`,**不能**一个有发光另一个什么都没有
- e2e 视觉回归在两个主题各跑一遍

### P2 · Token 优先

一切颜色 / 字号 / 圆角 / 阴影 / 动效走 token,**不写具体值**。
- JSX 里**禁止**十六进制、`bg-blue-500`、`text-zinc-400` 等 Tailwind 原色类
- Tailwind 的 `colors`、`boxShadow`、`borderRadius`、`transitionDuration` 全部指向 CSS 变量
- 唯一例外:`design-system/proposals/*.html` 原型 —— 那是探索样板,不是生产代码

### P3 · 扩展性设计

组件**只消费 token**,不依赖具体 pack。任何加第二套主题(`forest-green` / `mono-cipher` / …)都应**零改组件**,只改 `web/styles/themes/<pack>/*.css`。
- 新 token 必须写进 `tokens.css`(接口定义,无值)
- 每个 pack 必须导出完整 token 集 · 缺项启动 assert 报错
- 语义色(success / warning / danger)色相不变 —— 避免"绿变红"翻转

### P4 · 品牌可感

v1 MVP 阶段允许并鼓励建立产品识别:
- **允许** gradient `background-clip: text` 做 hero / display 标题
- **允许** `colored border-left` / `border-top` 做 accent(取代旧 BAN 1)
- **允许** `shadow-glow-sm` / `shadow-glow`(暗主题 primary 发光)与 `shadow-soft-lg`(亮主题抬升)
- **允许** 大字号 hero(72–84px display)· 点阵 logo · BrandMark provider 原色

### P5 · 动效克制

松绑但不放任:
- **允许**:`hover:-translate-y-px` · `animate-float`(6s 装饰 orb)· `animate-ping` / `pulse-ring` · `animate-shimmer` · 一次性 `ah-fade-up` 入场 · `background-clip: text` 静态 gradient
- **禁止**:Framer Motion / GSAP / react-spring / CountUp.js 等 JS 动画库(CSS + Tailwind keyframes 足够)
- **禁止**:`scale > 1.05` 大幅缩放 · 超过 500ms 的交互过渡(shimmer / float 无限动画除外)
- **禁止**:干扰阅读的持续闪烁(cyber `flicker` 留给未来 theme pack)

---

## § 1 · Design Tokens(canonical source)

实现层次:

```
web/styles/themes/
├── tokens.css                 ← 变量接口(无值)· 组件只依赖这层
├── brand-blue/
│   ├── light.css              ← :root[data-theme-pack="brand-blue"][data-theme="light"]
│   ├── dark.css               ← :root[data-theme-pack="brand-blue"][data-theme="dark"]
│   └── index.css              ← @import light + dark
└── _next-pack/                ← 未来扩展
```

Tailwind 映射在 `web/tailwind.config.ts`:所有 `colors` / `boxShadow` / `transitionDuration` 指向 `var(--…)`,darkMode 配置为 `['class', '[data-theme="dark"]']`。

### 1.1 颜色 token 接口(语义用途)

下列 token 名是**全 pack 共享接口** · 任何新 pack 必须完整实现。

**结构层**

| Token | 用途 |
|---|---|
| `--color-bg` | 页面最底层背景 · body · app shell 外壳 |
| `--color-surface` | 第一层容器 · card · topbar · sidebar |
| `--color-surface-2` | 第二层容器 · hover 态 · nested card · composer tint |
| `--color-surface-3` | 第三层 · shimmer / skeleton / 微差分组 |
| `--color-surface-4` | 第四层 · **新增** · tab well · inset section · 更深 nested |
| `--color-border` | 默认边框 · divider · card 外框 |
| `--color-border-strong` | 强调边框 · hover 态 input · 分区边线 |

**文本层**

| Token | 用途 |
|---|---|
| `--color-text` | 主要文本 · 标题 · body · 表单值 |
| `--color-text-muted` | 次要文本 · 说明 · 未选中 nav |
| `--color-text-subtle` | 提示 · placeholder · caption · metadata |

**主色 + 强调**

| Token | 用途 |
|---|---|
| `--color-primary` | 品牌主色 · 主 CTA bg · 激活色条 · 焦点环 |
| `--color-primary-hover` | primary hover 态(亮/暗取向不同) |
| `--color-primary-fg` | primary 背景上的前景文字(一般 `#FFFFFF`) |
| `--color-primary-muted` | `primary/10` 常用透明叠加预设 · 激活 bg tint |
| `--color-primary-glow` | **仅 dark** · highlight / shadow-glow 用 |
| `--color-primary-soft` | `primary/15` 更强 tint · badge 背景 · hairline accent |
| `--color-accent` | 副强调色(azure-sky / cyan) · 图表辅色 · 装饰 orb |

**语义状态**

| Token | 用途 | 对应 `*-soft` |
|---|---|---|
| `--color-success` | 正向状态 · 运行正常 · 测试通过 | `--color-success-soft` |
| `--color-warning` | 警告 · 额度接近上限 · deprecated | `--color-warning-soft` |
| `--color-danger` | 错误 · 失败 · 不可逆动作 | `--color-danger-soft` |

`*-soft` 统一为对应主色的 10–15% 不透明叠加,用于 badge / callout / toast 背景。

### 1.2 · 1.3 Brand-Blue 具体值(light + dark)

选择器 `:root[data-theme-pack="brand-blue"][data-theme="<light|dark>"]`。light 取 V2 Azure Live 的 paper 系,dark 取 V1 Cobalt Precision 的 ink 系。

| Token | Light | Dark |
|---|---|---|
| `--color-bg` | `#F6F8FC` | `#0A0D14` |
| `--color-surface` | `#FFFFFF` | `#11151F` |
| `--color-surface-2` | `#EDF1F8` | `#1A1F2E` |
| `--color-surface-3` | `#DFE6F0` | `#242A3C` |
| `--color-surface-4` | `#CED7E4` | `#3A425A` |
| `--color-border` | `#DFE6F0` | `rgba(255,255,255,0.06)` |
| `--color-border-strong` | `#B9C4D4` | `rgba(255,255,255,0.12)` |
| `--color-text` | `#141A26` | `#E2E6F1` |
| `--color-text-muted` | `#5C667A` | `#B6BDD1` |
| `--color-text-subtle` | `#8B96AB` | `#8690AE` |
| `--color-primary` | `#0A5BFF` | `#2E5BFF` |
| `--color-primary-hover` | `#0848D1` | `#6082FF` |
| `--color-primary-fg` | `#FFFFFF` | `#FFFFFF` |
| `--color-primary-muted` | `rgba(10,91,255,0.10)` | `rgba(46,91,255,0.14)` |
| `--color-primary-soft` | `rgba(10,91,255,0.15)` | `rgba(110,139,255,0.20)` |
| `--color-primary-glow` | `rgba(10,91,255,0.00)` * | `#6E8BFF` |
| `--color-accent` | `#4EA8FF` | `#63D3FF` |
| `--color-success` | `#0FA57A` | `#2EBD85` |
| `--color-warning` | `#D97706` | `#F5A524` |
| `--color-danger` | `#DC2626` | `#F04438` |
| `--color-success-soft` | `rgba(15,165,122,0.12)` | `rgba(46,189,133,0.16)` |
| `--color-warning-soft` | `rgba(217,119,6,0.12)` | `rgba(245,165,36,0.16)` |
| `--color-danger-soft` | `rgba(220,38,38,0.12)` | `rgba(240,68,56,0.16)` |

\* light 无发光,保留 token 接口存在以满足 P3 "每个 pack 必须实现所有变量" 契约。

### 1.4 字体

```css
--font-sans: 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
--font-feature-settings: 'cv11', 'ss01', 'ss03';
--letter-spacing-base: -0.011em;
```

**加载**:`web/app/layout.tsx` 用 `next/font/google` 挂载;CDN 备源在 `proposals/*.html` 里用 `fonts.googleapis.com`。

**使用规约**:
- 普通 UI 文本 → `font-sans`(Inter 的 `cv11 ss01 ss03` 特性提升数字与字母辨识)
- 以下场景**必须** `font-mono`:URL / endpoint / id / trace_id · 代码 / JSON / tool args · kbd chip · uppercase section label · 方向符(`→ ← ⌘ ↵`)

### 1.5 字号阶梯(保留自 ADR 0013)

| 用途 | Token | Size | Weight | Tracking |
|---|---|---|---|---|
| Hero / landing display | `text-hero` | 72–84px | 600–800 | `-0.04em` |
| 页面 display | `text-display` | 32 | 600 | `-0.02em` |
| 页面标题 / H1 | `text-xl` | 24 | 600 | `-0.02em` |
| 卡片标题 / 抽屉头 / H2 | `text-lg` | 19 | 600 | `-0.015em` |
| Body · 对话 · input | `text-base` | 15 | 400 | default |
| 二级 UI · 表单 label | `text-sm` | 13 | 500 | default |
| Caption · mono meta · trace_id | `text-caption` | 12 | 500 | default |
| UPPERCASE section label | `text-caption` | 12 | 600 | `0.08em` |

`text-hero` 为新增:仅限 landing / empty-state 大字,正常页面不用。

```css
--leading-heading: 1.2;
--leading-body:    1.6;
--leading-data:    1.45;
```

### 1.6 圆角

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 4px | kbd chip · badge · status dot 外壳 |
| `--radius` | 6px | 默认 button · 小徽章 |
| `--radius-md` | 8px | input · 默认 card |
| `--radius-lg` | 12px | 对话气泡 · toast · pill nav item |
| `--radius-xl` | 16px | modal · drawer · 大容器 |
| `--radius-2xl` | 20–24px | hero preview · landing 级卡片 · avatar group wrapper |

### 1.7 间距

基于 4px 网格 · 常用阶梯:`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`。Tailwind 默认的 `p-1 / p-2 / p-3 / p-4 / p-6 / p-8 / p-12 / p-16 / p-24` 对齐。

常见节奏:
- 按钮:`h-8 px-3`(32px 高 · 小号)/ `h-9 px-4`(36 · 默认)/ `h-11 px-5`(44 · 主要 CTA)/ `h-12 px-6`(48 · hero CTA)
- 卡片内边距:`px-4 py-3` 紧凑 / `px-5 py-4` 标准 / `px-6 py-5` 宽松
- 段落间隔:`space-y-2` 列表 · `space-y-4` 章节 · `space-y-6` 大块 · `space-y-8` 页面级

### 1.8 阴影

light pack 靠 `shadow-soft-*` 建立层级;dark pack 靠 `shadow-glow-*` 建立强调。**组件只写语义名**,具体值由 pack 注入。每个 pack 必须实现全部 8 个 token(另一方可为 `none` 或等效值)以保证组件一份代码跨 pack 生效。

| Token | Light 值 | Dark 值 |
|---|---|---|
| `--shadow-soft-sm` | `0 1px 2px rgba(10,43,120,.04), 0 1px 3px rgba(10,43,120,.06)` | `none` |
| `--shadow-soft` | `0 4px 12px -2px rgba(10,43,120,.06), 0 2px 4px rgba(10,43,120,.04)` | `none` |
| `--shadow-soft-lg` | `0 24px 64px -24px rgba(10,91,255,.18), 0 8px 24px -8px rgba(10,43,120,.08)` | `none` |
| `--shadow-pop` | `0 2px 0 rgba(10,91,255,.9)` | `0 2px 0 rgba(46,91,255,.9)` |
| `--shadow-glow-sm` | `none` | `0 0 12px -2px rgba(110,139,255,.35)` |
| `--shadow-glow` | `none` | `0 0 28px -4px rgba(110,139,255,.45)` |
| `--shadow-glow-lg` | `none` | `0 12px 48px -12px rgba(46,91,255,.55)` |
| `--shadow-hairline` | `inset 0 1px 0 rgba(255,255,255,.6)` | `inset 0 1px 0 rgba(255,255,255,.04)` |

### 1.9 动效 token

```css
--dur-fast:   150ms;   /* kbd chip · badge · 颜色切换 */
--dur-base:   220ms;   /* 按钮 · card hover · modal 入场 */
--dur-slow:   320ms;   /* tab 切换 · progress 填充 */
--dur-float:  6000ms;  /* 仅 animate-float 装饰 orb */

--ease-out-soft: cubic-bezier(0.16, 1, 0.3, 1);
--ease-out:      cubic-bezier(0.4, 0, 0.2, 1);
```

### 1.10 Keyframes 白名单

| 名称 | 用途 | 循环 |
|---|---|---|
| `ah-fade-up` | 入场 · translateY 6→0 + opacity 0→1 · 220ms | 一次性 |
| `float` | 装饰 orb · translateY 0→-6→0 · 6s | 无限 |
| `pulse-ring` / `animate-ping` | 状态点脉动 · 2.2s | 无限 |
| `shimmer` | skeleton 骨架 · background-position -200% → 200% · 2.4s linear | 无限 |
| `ah-bar-in` | 激活色条 scaleY 0→1 · 180ms | 一次性 |
| `scan` | 保留 · 暂不用 | — |
| `flicker` | 保留 · cyber theme pack 用 | — |

新增 keyframe 必须先改本文件再改 `web/styles/` —— 不在白名单里的 animation 在 code review 打回。

---

## § 2 · Icon 体系(取代旧"图形只能来自几何")

### 2.1 Lucide 作为主来源

业务所有 icon 统一从 Lucide 出。**禁止**在业务组件里直接 `import { X } from 'lucide-react'` —— 必须经 `<Icon>` 封装。

### 2.2 `<Icon>` API 契约

实现:`web/components/ui/icon.tsx`。

```tsx
import { Icon } from "@/components/ui/icon";

<Icon name="users" size={16} />
<Icon name="sparkles" size={20} strokeWidth={1.75} className="text-primary" />
```

Props:

| Prop | 默认 | 说明 |
|---|---|---|
| `name` | — | Lucide icon name(kebab-case) |
| `size` | `16` | 默认 16px;nav / 表单常 16;hero / feature 20–24 |
| `strokeWidth` | 按 pack | dark pack 默认 `1.75`(V1 精密感)· light pack 默认 `2`(V2 明快感) |
| `className` | — | 颜色靠 `text-*` 类驱动 · 内部统一 `stroke="currentColor"` |

日后整体切换底层库(Phosphor / Tabler)只改 `<Icon>` 内部实现,不动调用点。静态契约扫描(`web/tests/icon-import-contract.test.ts`)守门:任何业务文件 `import { .* } from 'lucide-react'` 直接打回,仅 `components/ui/icon.tsx` 白名单。

### 2.3 自有 icon 集(降级)

`web/components/icons/` **保留**,但范围收窄到"特殊符号":
- app logo(点阵 / ah 字样)
- provider / model brand marks(配合 BrandMark)
- 装饰字符(箭头 · hairline · decorative glyph)

旧 `web/components/ui/icons.tsx` 的 5 个 legacy 图元(`check` / `arrow-right` / `external` / `copy` / `plus-minus`)迁移到 Lucide (`check` / `arrow-right` / `external-link` / `copy` / `plus` + `minus`),文件删除。

### 2.4 BrandMark 组件

Provider / model 官方色 logo 保留独立调色(Anthropic 铁锈橙 / DeepSeek 蓝 / Qwen 紫 / Kimi / MiniMax / Zhipu / Bailian)—— **这是 ADR 0009 中唯一保留的条款**。渲染走 `<BrandMark provider="anthropic" size={16} />`,不走 `<Icon>`。

### 2.5 激活色条(2px primary bar)

组件级激活信号。位置因组件而异(参见 §3)。样式:`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary` + `animation: ah-bar-in 180ms var(--ease-out-soft) both`(transformOrigin top)。

### 2.6 状态点

`relative inline-block w-1.5 h-1.5` 容器,内嵌两层 `absolute inset-0 rounded-full`:底层 `bg-<tone> animate-ping opacity-50`,顶层 `bg-<tone>`(纯色)。色:`success` / `warning` / `danger` / `primary` / `text-subtle`(idle)。脉动版用于 running / queued,静态版(去 ping 层)用于 done / idle。

### 2.7 键盘 Chip

`font-mono text-[10px] px-1.5 py-0.5 rounded-sm border border-border bg-surface text-text-muted [border-bottom-width:2px]`。

light 表现 = 白底 + paper-300 边 + paper-600 字;dark = `bg-white/5` + `border-white/10` + `text-text-muted`。`border-bottom: 2px` 给实体按压感(跨主题一致)。

### 2.8 Mono 方向符

`→ ← ↑ ↓ · ⌘ ↵ Esc ⇧ ⌥` 继续使用,mono 字体下渲染整齐。用于:inline 提示(`list → detail`)· breadcrumb 分隔 · 快捷键组合。

---

## § 3 · 组件契约

每个组件给"视觉描述 + Tailwind 类样板"两段。类样板里只用 token 类(`bg-primary` / `text-text-muted`),**不写**具体色值或 Tailwind 原色。

### 3.1 Button

五种变体 + 三档尺寸。

| Variant | 样本 |
|---|---|
| `primary` | `bg-primary text-primary-fg hover:bg-primary-hover shadow-soft dark:shadow-glow-sm` + `hover:-translate-y-px active:translate-y-0 transition` |
| `secondary` | `bg-surface text-text border border-border hover:border-border-strong hover:bg-surface-2` |
| `outline` | `bg-transparent text-text border border-border hover:border-primary hover:text-primary` |
| `ghost` | `text-text-muted hover:text-text hover:bg-surface-2` |
| `danger` | `bg-danger text-white hover:bg-danger/90 shadow-soft` |

尺寸:

- `sm` → `h-8 px-3 text-sm rounded-md`
- `md`(默认)→ `h-9 px-4 text-sm rounded-lg`
- `lg`(CTA)→ `h-11 px-5 text-base rounded-xl`
- `hero`(landing only)→ `h-12 px-6 text-[15px] font-semibold rounded-xl shadow-soft-lg`

Loading 态:替换内容为 Lucide `loader-2` + `animate-spin`,保留宽度;disabled → `opacity-50 cursor-not-allowed pointer-events-none`。

### 3.2 Input

基类:`w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-text placeholder-text-subtle transition-colors focus:outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-muted)]`。

- Textarea:同色 · 按行高 · `leading-[var(--leading-body)]`
- Number input:`font-mono tabular-nums`
- Leading icon:`pl-9` + 左侧绝对定位 `<Icon>` · `text-text-subtle`
- Error:`border-danger` + focus 用 `danger-soft` ring + 下方 `text-caption text-danger`
- Suffix:`absolute right-2 text-text-subtle`

### 3.3 Select

触发器同 Input 外观 + 右 `<Icon name="chevron-down" size={14} />`。面板 `bg-surface border-border shadow-soft dark:shadow-glow-sm rounded-lg`,展开策略走 `web/lib/popover-placement.ts`(垂直 + 水平 flip · `maxHeight` clamp 视口 · 见 §3.21)。Error `border-danger` · Disabled `opacity-50 pointer-events-none`。

### 3.4 Badge

三种填充 × 六种语义色(`primary` / `success` / `warning` / `danger` / `accent` / `neutral`)。

- `solid` → `h-5 px-2 rounded-sm text-caption font-medium bg-<tone> text-<tone>-fg`
- `soft` → `h-5 px-2 rounded-sm text-caption font-medium bg-<tone>-soft text-<tone>`
- `outline` → `h-5 px-2 rounded-sm text-caption font-mono uppercase border border-border text-text-muted`

### 3.5 Card

默认:`rounded-xl bg-surface border border-border shadow-soft-sm dark:shadow-hairline transition-all duration-[var(--dur-base)] hover:border-border-strong hover:shadow-soft hover:-translate-y-px`。

变体:
- `featured` → 左侧 1px `linear-gradient(to bottom, var(--color-primary), transparent)` hairline accent(≤ 25% 透明度)
- `glass`(仅 dark · topbar)→ `bg-surface/70 backdrop-blur-xl border-white/5`
- 选中态 → `ring-1 ring-primary` 或左 2px 激活色条(§2.5)

### 3.6 Nav Item(侧边栏菜单)

`relative flex items-center gap-2 h-8 px-3 rounded-md text-sm transition-colors`。

- Active:`bg-primary-muted text-primary` + 左 2px primary 色条(§2.5)
- Inactive:`text-text-muted hover:text-text hover:bg-surface-2`
- 折叠态(48px sidebar)只渲染 `<Icon>` + tooltip

### 3.7 Section Label(侧边栏分区标题)

`px-3 mt-3 mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-subtle`。

### 3.8 Modal / Dialog

- 遮罩:`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center`
- 容器:`w-full max-w-lg rounded-2xl bg-surface border border-border shadow-soft-lg dark:shadow-glow animate-[ah-fade-up_220ms_var(--ease-out-soft)]`
- Header `px-6 py-4 border-b border-border` — `<Icon>` + `text-lg font-semibold`
- Body `px-6 py-5 text-sm text-text-muted leading-[var(--leading-body)]`
- Footer `px-6 py-4 border-t border-border flex justify-end gap-2` — Cancel(secondary · 默认 focus)+ Confirm(primary / danger)
- Danger 动作必须 `variant="danger"` + 明确动词文案(`删除员工` 而非 `确定`)

### 3.9 Toast

四种语义色,右上滑入,`ah-fade-up` 入场,驻留 4–6s(hover 暂停)。

基类:`flex items-start gap-3 p-4 rounded-xl border bg-surface shadow-soft dark:shadow-glow-sm border-<tone>/30`。内部:`<Icon>` `text-<tone>` + title(`text-sm font-medium`)+ body(`text-caption text-text-muted`)+ 可选 action(`<Button variant="ghost" size="sm">`)。

### 3.10 Tabs

**Underline**(数据页主用):`flex gap-6 border-b border-border` · 每个 `relative h-10 text-sm`;active `text-text` + 底部 `absolute -bottom-px left-0 right-0 h-0.5 bg-primary`;inactive `text-text-muted hover:text-text`。

**Pill**(settings / secondary nav):容器 `inline-flex p-1 rounded-lg bg-surface-2 gap-1`;每项 `h-8 px-3 rounded-md text-sm`;active `bg-surface text-text shadow-soft-sm`;inactive `text-text-muted`。

### 3.11 Tooltip

触发延迟 300ms · 消失 100ms。`default` → `bg-surface border border-border shadow-soft text-sm text-text`。`dark-inverted`(light pack 需高对比时)→ `bg-text text-bg`。Placement `top` 默认 · 空间不足 flip `bottom`(走 `popover-placement.ts`)。

### 3.12 Avatar

`grid place-items-center rounded-full font-semibold bg-gradient-to-br from-primary to-primary-hover text-primary-fg`。尺寸:`sm w-6 h-6 text-[10px]` / `md w-8 h-8 text-[11px]` / `lg w-10 h-10 text-caption`。

- Fallback:2 字母 initials uppercase
- Group stack:`flex -space-x-2` · 每个 `border-2 border-surface`
- Status dot:右下 `absolute w-2 h-2 rounded-full border-2 border-surface bg-success`(或 `bg-text-subtle` idle)

### 3.13 Progress

- **Bar**:外 `h-1 w-full rounded-full bg-surface-2 overflow-hidden`,内 `h-full bg-primary transition-all duration-[var(--dur-slow)]` + `width: pct%`
- **Ring**:`<svg viewBox="0 0 32 32" className="w-8 h-8 -rotate-90">`,底圈 `stroke="var(--color-surface-2)" strokeWidth="2"`,前圈 `stroke="var(--color-primary)"` + `strokeDasharray` 按 pct 计算 · `strokeLinecap="round"`

### 3.14 Skeleton

`h-4 w-48 rounded-md bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%] animate-shimmer`。2.4s linear 无限,节奏统一。

### 3.15 Loading Spinner

`<Icon name="loader-2" size={16} className="animate-spin text-primary" />` · 不做 custom SVG。

### 3.16 Empty State

居中布局:顶部装饰容器 `relative w-20 h-20`(内嵌 `bg-primary/20 blur-2xl animate-float` orb + 方形卡片 `bg-surface border border-border rounded-2xl` 含 `<Icon size={28} className="text-primary">`)· `text-lg font-semibold` 标题 · `text-sm text-text-muted` 副文 · CTA `variant="primary" size="lg"`。**必须**给下一步动作(见 §9)。

### 3.17 Code Block

外框 `rounded-lg border border-border bg-surface-2 overflow-hidden` · header `h-8 px-3 border-b border-border flex justify-between` 显示语言(`font-mono text-caption text-text-subtle`)+ copy 按钮(`<Icon name="copy" size={12}>`)· body `p-4 font-mono text-[13px] leading-[var(--leading-data)] text-text overflow-x-auto`。

Syntax highlighting 用 `shiki`(构建时)或 `prism-react-renderer`;**禁** CDN highlighter。

### 3.18 Command Palette(⌘K)

容器 `fixed top-[15vh] left-1/2 -translate-x-1/2 w-full max-w-xl rounded-2xl bg-surface border border-border shadow-soft-lg dark:shadow-glow`。

- Header `h-12 px-4 border-b border-border` — `<Icon name="search">` + input + `kbd Esc`
- Body `max-h-[60vh] overflow-y-auto p-2` — section label + items(`h-9 px-3 rounded-md hover:bg-surface-2 text-sm`,尾 `kbd ↵`)
- Footer `h-10 px-4 border-t border-border text-caption text-text-subtle font-mono` — `↑↓ navigate · ↵ select`

### 3.19 Chat Bubble

容器 `flex gap-3 py-4`(user 反向 `flex-row-reverse`)· `<Avatar role>` + 气泡 `relative max-w-[72%] rounded-2xl px-4 py-3 text-sm leading-[var(--leading-body)]`。

- `user` → `bg-primary text-primary-fg`
- `assistant` → `bg-surface border border-border text-text`
- `reasoning`(extended thinking)→ `bg-surface-2 border border-border/50 text-text-muted italic` · 可折叠
- `tool` → `bg-surface-2 border-l-2 border-warning font-mono text-caption`
- `answer` → 与 assistant 同,可选 `ah-sheen` 一次性高光

Role 色详见 §6。

### 3.20 Table

- `<table>` → `w-full border-collapse text-sm`
- `<thead>` → `text-text-subtle text-caption font-mono uppercase tracking-wider`
- `<th>` → `text-left px-4 h-9 border-b border-border font-medium`
- `<tr>` → `border-b border-border hover:bg-surface-2 transition-colors`
- `<td>` → `px-4 h-11 text-text`

Pagination:`flex items-center gap-2 text-caption text-text-muted` · 数字 mono · prev/next 用 `<Icon name="chevron-left/right">` ghost button。

### 3.21 Popover 位置策略(保留自旧规范)

任何"触发器 + 展开面板"必须:

1. **垂直 + 水平 flip**(面板宽于触发器时)· 走 `web/lib/popover-placement.ts` 的 `computePopoverSide` / `computePopoverAlign`
2. **clamp maxHeight** 到可用空间(最小 120px · 边距 8px)
3. **不硬编码方向**:`className={cn(side === "bottom" ? "top-full mt-1" : "bottom-full mb-1", align === "end" ? "right-0" : "left-0")}`
4. **z-index**:面板 `z-20` · 命令面板 `z-30+` · dialog 内嵌面板低 10
5. 渲染在触发器子树(非 portal),避免嵌套 popover click-outside 相互关
6. `open=true` 期间不改 side/align(避免抖动)
7. **不**引 Floating UI / Popper.js / Radix

守门:`web/lib/__tests__/popover-placement.test.ts`(flip 决策 11 用例)· `web/tests/popover-placement-contract.test.ts`(静态扫描 `top-full` / `bottom-full` 必须有 flip 三元)。

---

## § 4 · 布局

### 4.1 AppShell

```
┌────────────────────────────────────────────────────┐
│ Topbar  56–64px  ·  logo + nav + ⌘K + avatar       │
├──────────┬─────────────────────────────────────────┤
│ Sidebar  │                                         │
│  240px   │  Main area · max-w-[1400px] mx-auto     │
│ (48 折叠)│  px-8 py-8                              │
│          │                                         │
└──────────┴─────────────────────────────────────────┘
```

- Topbar 高 56px(dark `h-14`)/ 64px(light `h-16` · 更放松)· sticky top-0 · `backdrop-blur-xl bg-surface/70`
- Sidebar 240px 固定(折叠 48px)· 底部 user chip + 用量摘要卡
- Main max-width 1400px;对话类页面可用 `max-w-5xl` 居中

### 4.2 Sidebar 结构

- Logo 行(44px):点阵 / `ah` 渐变方块 + `allhands` 品牌字 + 版本 chip
- Workspace switcher(组织 / workspace 切换 · pill 下拉)
- 分区(Section Label · §3.7)+ 菜单项(Nav Item · §3.6)
- 底部:usage card(本月 $X / 剩余 Y runs · 用 Progress bar)+ settings chip

### 4.3 Topbar

- Logo(点击 → home)
- Primary nav(Employees · Skills · Gateway · Traces · Market)· pill tabs(§3.10)
- Search / ⌘K 触发 chip(`h-9 px-3 rounded-xl` · placeholder "Search anything…")
- Upgrade CTA(可选)· notifications bell · avatar

### 4.4 Responsive(v1 基础)

- `<768px`:sidebar 变 drawer 左滑 · topbar 左侧汉堡
- 主面板 full-width · 对话输入框固底
- v0 仍 desktop-first · 生产投放前做 QA pass

---

## § 5 · Theme System(新)

### 5.1 双维度切换

```
<html data-theme-pack="brand-blue" data-theme="dark" lang="zh-CN" class="dark">
```

两个属性相互独立:
- `data-theme-pack`:色彩身份(`brand-blue` · 未来 `forest-green` 等)
- `data-theme`:明暗(`light` / `dark` · `system` 在 client 解析成前两者)

Tailwind `darkMode: ['class', '[data-theme="dark"]']` · 两种方式都触发 `dark:` 前缀。

### 5.2 `next-themes` 集成

```tsx
// app/providers.tsx
<ThemeProvider
  attribute="data-theme"
  defaultTheme="system"
  enableSystem
  themes={["light", "dark"]}
>
  <ThemePackProvider defaultPack="brand-blue">{children}</ThemePackProvider>
</ThemeProvider>
```

- `next-themes` 管 light / dark / system 档
- 自写 `ThemePackProvider` 挂 `data-theme-pack` 到 `<html>`
- `useTheme()` 暴露给组件 · settings 页暴露给用户切换

### 5.3 Theme Pack 契约

新建一个 pack:

1. `web/styles/themes/<pack>/light.css` · `dark.css` · `index.css`(各选择器下写完整 token 集)
2. `web/styles/themes/index.css` 加 `@import './<pack>/index.css';`
3. `lib/theme-packs.ts` 注册:`{ id, label, light, dark }`
4. `ThemePackProvider` 的 `packs` 列表加上
5. 更新本文件 §1 旁注"可用 pack" · 更新 `design-system/MASTER.md`

**启动时 assert**:每个 pack 必须实现 `tokens.css` 的**所有**变量名,缺任何一项启动抛错(在 dev 下弹 toast · prod build 失败)。

### 5.4 SSR 友好 · 防闪烁

`next-themes` 默认在 `<head>` 注入一段 inline script,React hydrate 前就设置 `data-theme`,杜绝 FOUC。不再用旧方案的手写 `localStorage.allhands_theme` 脚本。

### 5.5 用户切换入口

- Topbar 右上角 ThemeToggle(`<Icon name="sun" />` / `<Icon name="moon" />` / `<Icon name="monitor" />` 三态)· 点击循环
- Settings → Appearance 页给完整下拉(light / dark / system · 未来加 pack 选择)

---

## § 6 · 消息 Role 着色

role 信息除颜色外**必须**同步 `aria-label="user message"` 等。

| Role | Light (`--color-…`) | Dark (`--color-…`) | 语义 |
|---|---|---|---|
| `role-user` | `#0A5BFF`(= primary) | `#6082FF` | 用户发言 |
| `role-lead` | `#7C3AED`(violet-600) | `#A78BFA` | Lead Agent(唯一紫色 · 不换) |
| `role-worker` | `#0FA57A`(= success) | `#2EBD85` | 员工 / subagent |
| `role-tool` | `#D97706`(= warning) | `#F5A524` | Tool 调用 |
| `role-reasoning` | `#5C667A`(= text-muted) | `#8690AE` | Extended thinking |

色条位置:用户气泡靠右(bubble 填 primary);其他靠左(bubble bg-surface + 左 2px role 色条)。

---

## § 7 · Component Registry(前端 render tool 扩展点)

保持 v0 机制:`web/lib/component-registry.ts` 映射组件名 → React 组件。新组件必须:

- 遵守本文件 token / 组件契约
- 不直接 import lucide-react(走 `<Icon>`)
- 文件独立在 `web/components/render/`
- 同步更新 `backend/src/allhands/api/protocol.py` + `web/lib/protocol.ts` 的 props 类型

新增流程:

1. 后端 render tool 返回 `{ component: "MyThing", props: {...} }`
2. 实现 `web/components/render/MyThing.tsx`(只消费 token · `<Icon>`)
3. `component-registry.ts` 加一行
4. Schema 一致性测试:`backend/tests/integration/test_render_protocol.py`

---

## § 8 · 可访问性

- 全部颜色对比度 **≥ WCAG AA** · dark/light **都要过**
  - `text` on `bg` ≥ 7:1(AAA)· 验证两个 pack
  - `text-muted` on `bg` ≥ 4.5:1(AA)
  - `text` on `primary`(按钮)≥ 4.5:1
- 键盘可达:所有交互元素 `focus-visible` 态显示 **3px primary ring**(`shadow-[0_0_0_3px_var(--color-primary-muted)]`),不靠 `outline: none` 然后没替代
- role 颜色**必须**有对应 `aria-label`(颜色盲友好)
- Confirmation 弹窗默认 focus "Reject" / "Cancel"(避免误确认)
- Motion:尊重 `prefers-reduced-motion: reduce` · `animate-float` / `shimmer` 在 reduce 下停止

---

## § 9 · Voice & Tone(文案纪律 · I-0013 · 保留自旧版)

视觉是骨架,文案是气息。allhands 的 UI 文案和 Lead Agent 的回应必须像同一个产品 —— 冷静、以事实为准、指向下一步,不讨好、不演绎。

**硬规则**:

1. **禁 emoji**(UI 文本 · Agent 回应 · 日志)。图形语义只走 §2 icon 体系。
2. **禁感叹号 `!`**(`太好了!` / `搞定!` / `失败!`)· 句号即可。
3. 代词用 `我` / `你`;**禁** `咱们` / `我们`(稀释责任主体)。
4. 按钮文案**动宾短语**:`发布` / `删除` / `测试发送` / `切换默认`;**禁** `确定` / `OK` / `提交`。Danger 按钮明写后果:`删除员工` 不是 `删除`。
5. 空状态**必须**给下一步动作。范式:`还没有 X · [动作建议]`。
6. 错误文案**指向修复**,不指向失败:`base_url 格式不对,试试 https://api.example.com/v1` 而不是 `调用失败! 请检查!`。
7. Lead Agent **欢迎语**首轮空对话必须给 3 条具体可点示例 prompt。模板见 `backend/src/allhands/execution/prompts/lead_agent.md`。

**语气梯度**:

| 场景 | 语气 | 示例 |
|---|---|---|
| 数据密集(cockpit / traces) | 事实无修饰 | `12 runs running · 3 queued · $0.42 今日` |
| 表单 · 设置 | 平实 · 指生效范围 | `保存后立刻对所有新对话生效,已在跑的 run 不受影响` |
| 空状态 · 引导 | 给下一步 | `还没有员工 · "帮我建一个每天写日报的员工"` |
| 错误 | 指修复 | `base_url 格式不对,试试 https://api.example.com/v1` |

**检查钩子**:`web/tests/voice-tone.test.ts` 扫 emoji / `!` / `咱们` / `我们` 泄漏;`backend/tests/unit/test_lead_welcome.py` 断 Lead prompt 含 3 条 `- "..."` 示例。

---

## § 10 · Composition Primitives(允许的装饰原语)

延展 §P4 品牌可感 · 每条都是既有语汇列明,组件不受新禁。

### 10.1 Sparkline / Micro-viz

纯 SVG · 用于 KPI 趋势 · 活动密度 · 延迟分布。

- 描边 `stroke="currentColor"` 或 `stroke="var(--color-primary)"` · `stroke-width="1.5"` · `fill="none"`
- 高度 ≤ 32px · 宽度自适应
- 末点可额外 `<circle r="2" fill="currentColor" />` 强调
- **禁**:渐变填充 · 多色描边 · chart 库(`recharts` / `d3` / `visx`)

### 10.2 Dotgrid Backdrop

hero / 空态视觉锚 · 不抢焦点。实现:`background-image: radial-gradient(var(--color-border) 1px, transparent 1px); background-size: 18px 18px; opacity: .3`(dark 常用 18px;light 可 32px)。不做 pan / rotate 动画。

### 10.3 Hairline Accent(1px 高光条)

标记"推荐 / featured" · **不**替代 §2.5 激活色条(激活是状态,hairline 是装饰)。实现:`height: 1px; background: linear-gradient(to right, var(--color-primary), transparent); opacity: .4`。

### 10.4 Mesh Gradient Hero · Gradient Text(取代旧 BAN 2)

landing / empty state / marketing 页允许多层 `radial-gradient` 叠 `linear-gradient` 做柔光背景(见 `proposals/v2-azure-live.html` `.mesh-hero`)。`gradient-text` 用 `background-clip: text` + `linear-gradient`,**仅限**hero / display 级,正文和按钮不用。

### 10.5 Glow Orb

装饰光球:`absolute w-40 h-40 rounded-full bg-primary/20 blur-3xl animate-float`。`animate-float` 6s · translateY ±6px · 不重叠文字 · 同 viewport ≤ 3 个 · z-index ≤ 0。

### 10.6 入场动效

`ah-fade-up`(6px translateY + opacity 0→1 · 220ms · `ease-out-soft`)用于路由切换 / 列表初渲染 / modal / toast 入场。`ah-bar-in` 仅限激活色条。`hover:-translate-y-px` 仅限 button / card / nav(位移上限 1px)。

### 10.7 数值变动过渡

KPI 数字变化用 `transition: color var(--dur-fast)` 高亮回落(primary → text)或 `translateY(2px → 0)` 入场。**禁** Framer Motion / react-spring / CountUp.js —— 不做 0→N 滚动计数(噪声大)。

---

## § 11 · 变更流程

### 11.1 Token 改值(brand-blue pack 内部调整)

1. 改 `web/styles/themes/brand-blue/light.css` · `dark.css`
2. 更新本文件 §1.2 / §1.3 对应表格
3. 更新 `design-system/MASTER.md` 的 token 速查
4. `pnpm test` 跑 contrast / voice-tone 契约
5. `pnpm test:e2e` 重拍 light / dark 基线

### 11.2 新 Theme Pack

1. 新建 `web/styles/themes/<pack>/` 目录 · 完整实现 `tokens.css` 所有变量
2. `web/lib/theme-packs.ts` 注册 `{ id, label, meta }`
3. `ThemePackProvider` 的 `packs` 列表加
4. 本文件 §5 "当前可用 pack" 一栏加引用(brand-blue · <new>)
5. 单独 ADR(新 pack 视觉身份说明 · 不必重走本文件)
6. e2e 基线 per pack per theme 一共 2n 张

### 11.3 组件契约变更

1. **先改本文件 §3** 对应组件
2. 再改 `web/components/ui/<Comp>.tsx` 实现
3. 再改 `design-system/MASTER.md` 速查
4. 若 API 变(props 增删)· 更新所有调用点
5. 回归测试 · e2e 基线

### 11.4 新 keyframe / 新原语

1. 本文件 §1.10 / §10 加条目 · 明写使用场景与约束
2. `web/styles/keyframes.css` 实现
3. `tailwind.config.ts` `extend.animation` / `extend.keyframes` 映射
4. 至少在 `/design-lab` 页面给一个示范

### 11.5 Voice & Tone 变更

同步改:本文件 §9 · `backend/src/allhands/execution/prompts/lead_agent.md` Style 节 · `design-system/MASTER.md` Voice 速查表。

---

**契约优先级(冲突时高位覆盖低位)**:

1. 本文件(`product/03-visual-design.md`)
2. [ADR 0016](./adr/0016-brand-blue-dual-theme.md)
3. `design-system/MASTER.md`(战术速查)
4. `web/app/design-lab/page.tsx`(活样本)
5. 具体组件实现

发现冲突 → 立刻停 · 问 maintainer · 必要时开 ADR。
