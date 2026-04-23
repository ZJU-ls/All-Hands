# allhands · Design System MASTER (Tactical Reference)

> 给 Claude 代码会话用的速查表。规范细节看 [../product/03-visual-design.md](../product/03-visual-design.md)。
> 契约变更流程:先改 03-visual-design.md → 再改 globals.css / tailwind.config.ts / themes/ → 再同步本文件。
> 本文件与 03-visual-design.md 冲突时以后者为准。
>
> **当前视觉契约:Brand Blue Dual Theme**(见 [../product/adr/0016-brand-blue-dual-theme.md](../product/adr/0016-brand-blue-dual-theme.md))· 旧 Linear Precise 作废。

---

## 0. 每次开发前的自检

写任何 `web/` 组件前,逐条过:

- [ ] **颜色走 token**:`bg-bg` / `bg-surface` / `text-text-muted` / `bg-primary` 等。JSX 不写十六进制,也不写 `bg-blue-500` / `text-zinc-400`。
- [ ] **双主题都跑过**:组件在 `data-theme="light"` 与 `data-theme="dark"` 下都保留原本语义(激活 / 层级 / 状态)。
- [ ] **Icon 走 `<Icon name="..." />`**:不直接 `import 'lucide-react'`,特殊符号走 `web/components/icons/`。
- [ ] **激活 / 选中用规定语言**:见 §4.1,sidebar / tabs / CTA 各有固定方言。
- [ ] **圆角走 token**:`rounded` / `rounded-md` / `rounded-lg` / `rounded-xl`,不写 `rounded-[13px]`。
- [ ] **Focus ring 走 `ring-primary/20` + `border-primary`**:所有 focusable 元素必须键盘可见。
- [ ] **动效时长走 `--dur-*`**:subtle hover 位移 ≤ 2px,不写 `duration-[450ms]`。
- [ ] **不装 JS 动画库**:没有 Framer Motion / GSAP,CSS + Tailwind keyframes 足够。
- [ ] **Provider / model logo 走 `<BrandMark />`**:不自己拼 `<img>`。
- [ ] **键盘可达 + AA 对比度**:tab 顺序合理,灰字在 bg-surface 上 ≥ 4.5:1。

---

## 1. Token 速查

### 1.1 颜色 token → Tailwind 类

| 想要 | Tailwind 类 | light 值 | dark 值 |
|---|---|---|---|
| 页面底 | `bg-bg` | `#F6F8FC` | `#0A0D14` |
| 卡片 / 侧栏 | `bg-surface` | `#FFFFFF` | `#11151F` |
| 输入底 / hover | `bg-surface-2` | `#EDF1F8` | `#1A1F2E` |
| 微差 | `bg-surface-3` | `#DFE6F0` | `#242A3C` |
| 更深微差 | `bg-surface-4` | `#B9C4D4` | `#3A425A` |
| 正文 | `text-text` | `#141A26` | `#E2E6F1` |
| 次要 | `text-text-muted` | `#5C667A` | `#8690AE` |
| 提示 | `text-text-subtle` | `#8B96AB` | `#5A6483` |
| 边框 | `border-border` | `#DFE6F0` | `rgba(255,255,255,.06)` |
| 强边框 | `border-border-strong` | `#B9C4D4` | `rgba(255,255,255,.12)` |
| 主操作 | `bg-primary text-primary-fg` | `#0A5BFF` / `#FFFFFF` | `#2E5BFF` / `#FFFFFF` |
| primary hover | `hover:bg-primary-hover` | `#0848D1` | `#2048E6` |
| primary 软底 | `bg-primary/10` | — | — |
| primary 发光 | `shadow-glow-sm` / `shadow-glow` | — | `#6E8BFF` 外发光 |
| 副强调 | `bg-accent` / `text-accent` | `#4EA8FF` | `#6E8BFF` |
| 成功 | `text-success` / `bg-success-soft` | `#0FA57A` / `#E3F7EE` | `#2EBD85` / `rgba(46,189,133,.12)` |
| 警告 | `text-warning` / `bg-warning-soft` | `#D97706` / `#FEF3C7` | `#F5A524` / `rgba(245,165,36,.12)` |
| 危险 | `text-danger` / `bg-danger-soft` | `#DC2626` / `#FEE2E2` | `#F04438` / `rgba(240,68,56,.14)` |

### 1.2 字体

| | class |
|---|---|
| UI / 正文 | `font-sans`(Inter variable) |
| URL / id / trace / JSON / kbd | `font-mono`(JetBrains Mono) |

### 1.3 字号阶梯

| 场景 | class |
|---|---|
| Hero 大标题 (landing / empty) | `text-[72px] md:text-[84px] font-semibold tracking-tight leading-[.95]` |
| H1 页标题 | `text-[28px] md:text-[32px] font-semibold tracking-tight` |
| H2 / section 标题 | `text-[18px] md:text-[22px] font-semibold tracking-tight` |
| Label / 卡片标题 | `text-[13px] font-medium` |
| Body | `text-[13px] md:text-[14px]` |
| Caption / meta | `text-[11px] text-text-muted` |
| Micro / section label | `text-[10px] uppercase tracking-[0.08em] text-text-subtle` |

### 1.4 圆角

| class | 尺寸 | 用途 |
|---|---|---|
| `rounded-sm` | 4px | chip / kbd |
| `rounded` | 6px | button 默认 |
| `rounded-md` | 8px | input / small card |
| `rounded-lg` | 12px | card / message |
| `rounded-xl` | 16px | modal |
| `rounded-2xl` | 20-24px | hero / featured card |

### 1.5 间距

Tailwind 默认单位。常用 `gap-2|3|4|5|6|8|12` = `8|12|16|20|24|32|48 px`。

### 1.6 阴影

| class | 用途 |
|---|---|
| `shadow-soft-sm` | 小卡片 hover(light) |
| `shadow-soft` | card resting / modal(light) |
| `shadow-soft-lg` | elevated modal / popover(light) |
| `shadow-pop` | dropdown / command palette(light) |
| `shadow-glow-sm` | primary 按钮 hover(dark) |
| `shadow-glow` | 激活卡片 / CTA(dark) |
| `shadow-glow-lg` | hero orb / floating(dark) |
| `shadow-hairline` | 1px 分隔线替代(dark) |

阴影在主题间自动切换(token 级别),组件不需要写 `dark:shadow-*`。

### 1.7 过渡

| class | 用途 |
|---|---|
| `transition-colors duration-150` | 默认 · 颜色 / 边框变化(`--dur-fast`) |
| `transition-all duration-[220ms]` | 按钮 / 输入聚焦(`--dur-base`) |
| `duration-[320ms] ease-[cubic-bezier(.16,1,.3,1)]` | modal / 入场动效(`--dur-slow` + `--ease-out-soft`) |
| `animate-float` | 6s 上下 6px 装饰 orb(`--dur-float`) |

---

## 2. Icon 速查

### 2.1 业务 icon

```tsx
import { Icon } from '@/components/ui/icon'

<Icon name="users" size={16} className="text-text-muted" />
<Icon name="send" size={18} />
```

底层用 Lucide,不直接 `import { Users } from 'lucide-react'`。

### 2.2 常用 name(Lucide 名)

`users` · `wand-2` · `plug` · `activity` · `settings` · `search` · `bell` · `plus` · `trash-2` · `check` · `x` · `arrow-right` · `arrow-up` · `chevron-down` · `chevron-left` · `chevron-right` · `more-horizontal` · `sparkles` · `zap` · `brain` · `database` · `file-code-2` · `shield-check` · `copy` · `share-2` · `download` · `filter` · `info` · `alert-triangle` · `alert-circle` · `check-circle-2` · `play-circle` · `book-open` · `send` · `user-plus` · `clock` · `calendar` · `star` · `eye` · `lock` · `unlock` · `refresh-cw`

### 2.3 特殊符号

`web/components/icons/` 下自有 · 仅 app logo / brand marks / 装饰字符。不为业务动作新增。

### 2.4 Provider / model logo

```tsx
<BrandMark provider="anthropic" size={20} />
<BrandMark provider="openai" />
<BrandMark provider="bailian" />
```

---

## 3. 组件速查

### Button

```tsx
// primary · md(sm h-8 px-3 text-[12px] · md h-10 px-4 text-[13px] · lg h-12 px-6 text-[14px])
<button className="h-10 px-4 rounded-lg bg-primary hover:bg-primary-hover text-primary-fg text-[13px] font-medium inline-flex items-center gap-2 shadow-soft-sm dark:shadow-glow-sm transition-all duration-[220ms]">发布</button>
```
变体:`secondary` = `bg-surface border border-border hover:border-border-strong hover:bg-surface-2 text-text`;`ghost` = `hover:bg-surface-2 text-text-muted hover:text-text`;`danger` = `bg-danger-soft text-danger hover:bg-danger hover:text-white`。

### Input

```tsx
<input className="w-full h-10 px-3 rounded-md bg-surface border border-border placeholder:text-text-subtle text-text text-[13px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary transition-colors duration-150" />
```
URL / key / id 字段加 `font-mono`。

### Select

```tsx
<button className="h-10 px-3 rounded-md bg-surface border border-border hover:border-border-strong text-[13px] text-text flex items-center justify-between gap-2"><span>{value}</span><Icon name="chevron-down" size={14} className="text-text-muted" /></button>
```
Listbox:`bg-surface shadow-pop border border-border rounded-lg p-1` · option hover `bg-surface-2` · selected `bg-primary/10 text-primary`。

### Badge(solid / soft / outline × 6 色)

```tsx
// soft · solid · outline · 色位换 primary|success|warning|danger|accent|surface-3
<span className="text-[11px] font-medium px-2 py-0.5 rounded-sm bg-primary/10 text-primary">default</span>
<span className="text-[11px] font-medium px-2 py-0.5 rounded-sm bg-primary text-primary-fg">live</span>
<span className="text-[11px] font-medium px-2 py-0.5 rounded-sm border border-border text-text-muted">draft</span>
```

### Card

```tsx
// default / hover / featured(top 1px primary hairline)/ glass
<div className="rounded-lg bg-surface border border-border p-5 shadow-soft-sm" />
<div className="rounded-lg bg-surface border border-border p-5 hover:-translate-y-px hover:shadow-soft dark:hover:shadow-glow-sm transition-all duration-[220ms]" />
<div className="relative rounded-lg bg-surface border border-border p-5 overflow-hidden"><div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/80 via-primary to-accent" />...</div>
<div className="rounded-2xl bg-surface/60 backdrop-blur-lg border border-white/5 shadow-glow p-6" />
```

### Nav Item

```tsx
// active · resting
<a className="relative flex items-center gap-2 h-9 px-3 rounded-md bg-primary/10 text-primary text-[13px] font-medium"><span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r bg-primary" /><Icon name="users" size={16} />员工</a>
<a className="flex items-center gap-2 h-9 px-3 rounded-md text-text-muted hover:text-text hover:bg-surface-2 text-[13px]" />
```

### Tabs

```tsx
// underline · pill
<button className="relative px-3 h-10 text-[13px] text-text-muted data-[active]:text-text">概览<span className="absolute inset-x-3 bottom-0 h-[2px] bg-primary opacity-0 data-[active]:opacity-100 dark:shadow-glow-sm" /></button>
<button className="px-3 h-8 rounded-md text-[12px] text-text-muted data-[active]:bg-surface data-[active]:text-primary data-[active]:shadow-soft-sm">日</button>
```

### Modal

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
  <div className="w-full max-w-lg rounded-xl bg-surface border border-border shadow-soft-lg dark:shadow-glow p-6 animate-[ah-fade-up_320ms_cubic-bezier(.16,1,.3,1)_both]">...</div>
</div>
```

### Toast

```tsx
<div className="flex items-center gap-2 px-4 h-11 rounded-lg bg-success-soft text-success border border-success/20 shadow-soft"><Icon name="check-circle-2" size={16} />已发布</div>
```
色位换:`info` = primary-soft · `warn` = warning-soft · `error` = danger-soft。

### Tooltip

```tsx
<div className="px-2 py-1 rounded bg-text text-bg text-[11px] font-medium shadow-pop">⌘K 打开命令面板</div>
```
dark 下 token 自动反色。

### Avatar

```tsx
<div className="w-8 h-8 rounded-full bg-primary/15 text-primary text-[12px] font-semibold flex items-center justify-center ring-1 ring-border">AL</div>
// group: <div className="flex -space-x-2">{avatars}</div>
// status dot: <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success ring-2 ring-surface" />
```

### Progress

```tsx
// bar
<div className="h-1.5 rounded-full bg-surface-3 overflow-hidden"><div className="h-full bg-primary dark:shadow-glow-sm" style={{ width:'62%' }} /></div>
// ring: svg 28px, stroke=currentColor, track text-surface-3, active text-primary, strokeDasharray="75 100", strokeLinecap="round"
```

### Empty State

```tsx
<div className="relative rounded-xl border border-dashed border-border bg-surface p-10 text-center overflow-hidden">
  <div aria-hidden className="absolute inset-0 opacity-40" style={{ backgroundImage:'radial-gradient(var(--color-border) 1px, transparent 1px)', backgroundSize:'16px 16px' }} />
  <div className="relative"><div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3"><Icon name="sparkles" size={22} /></div><p className="text-[14px] text-text">还没有员工</p><p className="text-[12px] text-text-muted mt-1">跟 Lead Agent 说一声,它会帮你建第一个。</p></div>
</div>
```

### Chat Bubble

```tsx
// user · agent · reasoning · tool-call
<div className="ml-auto max-w-[75%] rounded-2xl rounded-tr-md bg-primary text-primary-fg px-4 py-2.5 text-[13px] shadow-soft-sm dark:shadow-glow-sm" />
<div className="max-w-[75%] rounded-2xl rounded-tl-md bg-surface border border-border text-text px-4 py-2.5 text-[13px]" />
<div className="max-w-[75%] rounded-lg bg-surface-2 text-text-muted italic px-3 py-2 text-[12px] border-l-2 border-accent" />
<div className="max-w-[75%] rounded-lg bg-surface border border-border font-mono text-[12px] p-3"><div className="text-accent">fetch_url(...)</div><div className="text-text-muted">→ 200 OK · 1.2 KB</div></div>
```

### Table + Pagination

```tsx
<table className="w-full text-[13px]">
  <thead className="text-[11px] uppercase tracking-wider text-text-subtle"><tr className="border-b border-border"><th className="text-left font-medium py-2 px-3">名称</th></tr></thead>
  <tbody><tr className="border-b border-border hover:bg-surface-2 transition-colors duration-150" /></tbody>
</table>
// pagination: button `h-8 w-8 rounded-md hover:bg-surface-2` · 当前页用 `text-[12px] text-text-muted px-2`
```

### Command Palette

```tsx
<div className="w-full max-w-xl rounded-xl bg-surface border border-border shadow-pop p-2">
  <div className="flex items-center gap-2 px-3 h-11 border-b border-border"><Icon name="search" size={16} className="text-text-muted" /><input className="flex-1 bg-transparent outline-none text-[14px]" placeholder="搜索指令 · ⌘K" /></div>
  <ul className="py-2 max-h-80 overflow-auto"><li className="flex items-center gap-2 px-3 h-9 rounded-md aria-selected:bg-primary/10 aria-selected:text-primary text-[13px]" /></ul>
</div>
```

### Code Block

```tsx
<pre className="rounded-lg bg-surface-2 border border-border p-4 text-[12px] font-mono text-text overflow-x-auto"><code>...</code></pre>
```
inline:`<code className="px-1 py-0.5 rounded bg-surface-2 font-mono text-[12px] text-accent">`。

---

## 4. 常见模式

### 4.1 激活状态方言表(ADR 0016 D2)

| 组件 | 激活语言 |
|---|---|
| 侧边栏菜单 | `bg-primary/10` + 2px 左 primary 色条 + `text-primary` |
| pill tabs | `bg-surface` + `shadow-soft-sm` + `text-primary`(light);dark 下 `bg-surface shadow-glow-sm` |
| underline tabs | 下 2px `bg-primary` bar · dark 加 `shadow-glow-sm` |
| 主要 CTA | `bg-primary text-primary-fg` + `shadow-soft`(light) / `shadow-glow-sm`(dark) |
| 次要 active | `bg-surface-2` · 无色条 |
| 列表项 selected | `bg-primary/10 text-primary` · 带 check icon |

### 4.2 Hover elevate

```tsx
// light
className="hover:-translate-y-px hover:shadow-soft transition-all duration-[220ms]"
// dark 补充
className="dark:hover:border-primary/40 dark:hover:shadow-glow-sm"
```

### 4.3 Focus ring

```tsx
className="focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary dark:focus-visible:shadow-glow-sm"
```

### 4.4 Loading

```tsx
// spinner
<span className="inline-block w-4 h-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
// skeleton
<div className="h-4 rounded bg-surface-3 animate-pulse" />
```

### 4.5 Empty backdrop(mesh-hero + dotgrid)

```tsx
<section className="relative overflow-hidden rounded-2xl p-12">
  <div aria-hidden className="absolute inset-0 opacity-60" style={{ background:'radial-gradient(60% 50% at 50% 0%, var(--color-primary-glow) 0%, transparent 70%)' }} />
  <div aria-hidden className="absolute inset-0 opacity-30" style={{ backgroundImage:'radial-gradient(var(--color-border) 1px, transparent 1px)', backgroundSize:'20px 20px' }} />
  <div className="relative" />
</section>
```

---

## 5. Theme 切换速查

```tsx
'use client'
import { useTheme } from 'next-themes'

const { resolvedTheme, setTheme } = useTheme()
setTheme('light')   // or 'dark' | 'system'
```

HTML 属性(由 `ThemeProvider` 注入):

```html
<html data-theme-pack="brand-blue" data-theme="dark">
```

新 theme pack:

1. 新建 `web/styles/themes/<pack>/{light,dark,index}.css`,导出 `tokens.css` 里所有变量
2. 在 `app/providers.tsx` 的 `ThemeProvider` `value={{ pack: '<pack>', ... }}` 注册
3. 跑 e2e 视觉回归两主题基线

禁止并行写 `dark:bg-zinc-900` —— token 自动响应 `data-theme`,组件零感知。

---

## 6. 文件结构

```
web/
├── styles/themes/
│   ├── tokens.css              ← 变量接口(无值)· 组件唯一依赖
│   └── brand-blue/{light,dark,index}.css   ← :root[data-theme-pack][data-theme] 下赋值
├── app/
│   ├── globals.css             ← 只 @import themes + reset
│   ├── providers.tsx           ← ThemeProvider(next-themes)
│   └── design-lab/page.tsx     ← 活样本 + 回归基准
├── tailwind.config.ts          ← colors 全部指向 var(--color-*)
├── components/ui/              ← icon.tsx · brand-mark.tsx · button · input · ...
└── components/icons/           ← 自有特殊符号(logo / brand marks)
```

---

## 7. 常见错误(Do / Don't)

| 写法 | 正 / 误 | 说明 |
|---|---|---|
| `bg-[#0A5BFF]` | 误 | 硬编码 · 用 `bg-primary` |
| `bg-primary` | 正 | token · 双主题自动响应 |
| `import { Users } from 'lucide-react'` | 误 | 绕过 Icon 包装 · `<Icon name="users" />` |
| `<Icon name="users" />` | 正 | 统一入口 |
| `hover:scale-105` | 误 | 禁止 scale > 1.05 · 用 `hover:-translate-y-px hover:shadow-soft` |
| `hover:-translate-y-px hover:shadow-soft` | 正 | 规范 hover 语言 |
| `dark:bg-zinc-900` | 误 | 并行主题定义 · 用 token |
| `bg-surface` | 正 | token 自动切换 |
| `border-l-4 border-primary` 做装饰条 | 有条件允许 | 旧 BAN 1 已废除 · 优先 `bg-primary/10` + 2px 色条组合(sidebar active 仍用 2px) |
| `bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent` | 允许 | 旧 BAN 2 已废除 · 仅用于 hero h1,正文保持单色 |
| `import { motion } from 'framer-motion'` | 误 | 动画库禁用 · CSS keyframes + Tailwind 足够 |
| `animate-bounce` | 误 | 干扰阅读 · 用 `animate-[ah-fade-up_...]` |
| `<button>☀ Light</button>` | 误 | emoji 当 UI · 用 `<Icon name="sun" />` |
| `rounded-[13px]` | 误 | 非 token 圆角 · 选 `rounded-lg`(12) 或 `rounded-xl`(16) |

---

## 8. 变更流程

1. **改 token 值**:
   `web/styles/themes/brand-blue/<light|dark>.css` → `product/03-visual-design.md §1` → 本文件 §1 表格
2. **加 theme pack**:
   见 03-visual-design.md §5 · 复制 `brand-blue/` 到 `<new-pack>/`,替换全部值,在 `ThemeProvider` 注册
3. **改组件契约(prop / 变体 / 新组件)**:
   03-visual-design.md §3 规范 → `components/ui/<name>.tsx` 实现 → `design-lab` 加样本 → 本文件 §3 增条目
4. **加 Lucide 之外的 icon**(特殊符号):
   写 `web/components/icons/<name>.tsx` → export → design-lab Icon Gallery 光学一致性自检
5. **废弃视觉契约 / 换主线 pack**:
   必须走 ADR(参考 0016)· 先 PR 文档,再 code

---

参考:

- ADR 0016:[../product/adr/0016-brand-blue-dual-theme.md](../product/adr/0016-brand-blue-dual-theme.md)
- V1 Cobalt Precision(dark 基准):[./proposals/v1-cobalt-precision.html](./proposals/v1-cobalt-precision.html)
- V2 Azure Live(light 基准):[./proposals/v2-azure-live.html](./proposals/v2-azure-live.html)
- 视觉规范:[../product/03-visual-design.md](../product/03-visual-design.md)
