# ADR 0016 · Brand-Blue Dual Theme · 视觉契约重置 + 主题可扩展

## Status

Accepted(2026-04-23)

**Supersedes / Modifies:**
- **Supersedes** `product/03-visual-design.md` 的 "Linear Precise" 整套规范(§0 三条硬纪律 · §2 icon 禁令 · BAN 1/2 反装饰条款 · 动效 2px 位移上限)
- **Modifies ADR 0009**(自有 icon 集):从"唯一来源"降级为"特殊符号来源(brand marks / logo)";业务 icon 改用 Lucide
- **Retains ADR 0012**(viz palette):viz-1…viz-6 六色环保留,作为独立于主题的第四类调色板
- **Retains ADR 0013**(字号阶梯)核心表,但废弃其中的 BAN 1(border-accent 禁令)· BAN 2(gradient text 禁令)

## Context

### 为什么要重置

当前 Linear Precise 规范(2026-03 落地)有三个问题:

1. **表达力受限**:禁止 gradient text / 禁 scale / 禁 box-shadow / 禁 colored border-accent / 颜色密度 ≤ 3 —— 合起来使得产品**无法建立"品牌识别"**。Linear Precise 本质是一套"工具感"契约,适合内部工具,不适合要面向用户讲故事的 SaaS 产品
2. **icon 自造负担重**:自有 icon 集(`web/components/icons/**`,Raycast-style)随着页面数扩展,每引入一个新动作都要手画 SVG;而业务功能迭代速度 >> icon 库迭代速度,长期瓶颈
3. **主题是死的**:现有 tokens 只有一份,主题色 `--color-primary: #6366F1` 硬编码。用户想换"森林绿 / 金融深蓝 / 品牌橙"都做不到,也没预留扩展点

### 用户需求(2026-04-23 设计会话)

- 完全重新设计前端,方向:**Arc / Raycast 活力蓝**(饱和、明快、略带玩味)
- 产出 V1 Cobalt Precision(暗)+ V2 Azure Live(浅)两个 HTML 原型(见 `design-system/proposals/`)
- 确认作为 **dark / light 双主题**沉淀为正式契约
- **架构上要可扩展**:以后低成本加第二套主题(同结构、只改 token 值)
- 保留 dark / light 双模式基础一致性

## Decision

### D0 · 核心决策

**废除 Linear Precise,建立 Brand Blue Dual Theme 作为 v1 视觉契约 · 以 theme pack 架构支持未来扩展。**

### D1 · Icon 来源

- **主来源:Lucide**(`lucide-react` npm 包),业务所有 icon 统一走 `<Icon name="..." />` 封装,不直接 import lucide-react 具体 icon
- **次来源:`web/components/icons/`**(自有 Raycast-style 集)保留,但**只服务特殊符号**:app logo / provider brand marks / 装饰字符
- **包装契约**:所有 icon 消费点 `import { Icon } from '@/components/ui/icon'` · `<Icon name="users" size={16} />`。日后切换底层库(比如替换成 Phosphor)只改 Icon 内部实现

### D2 · 激活状态语言(混合)

取代旧契约的"仅 2px 色条"。按组件类型分类:

| 组件 | 激活语言 |
|---|---|
| 侧边栏菜单项 | `bg-primary/10` 背景 + 2px 左 primary 色条 + primary 文字 |
| pill tabs | 白底(light)/ surface(dark) + shadow-soft · primary 文字 |
| underline tabs | 下 2px primary bar(可带微 glow) |
| 主要 CTA | 纯 primary 背景 + primary-fg 文字 + shadow-soft(light) / shadow-glow-sm(dark) |
| 次要 active | surface-2 背景 · 无色条 |

### D3 · 动效白名单(松绑)

**允许**:
- `hover:-translate-y-px` · `hover:translate-y-0:active`
- `animate-float`(6s 上下 6px 无限循环,仅装饰性 orb / empty state illustration)
- `pulse-ring` / `animate-ping`(状态点)
- `shadow-glow-sm` / `shadow-glow`(暗主题 primary 发光)
- gradient `background-clip: text` 用于大标题(彻底废除 ADR 0013 BAN 2)
- colored `border-left` / `border-top` accent(彻底废除 BAN 1)

**保持禁止**:
- Framer Motion / GSAP 等 JS 动画库(CSS + Tailwind keyframes 足够)
- `scale > 1.05` 大幅缩放
- 超过 500ms 的长过渡(除 skeleton shimmer 外)
- 干扰阅读的持续闪烁(flicker 仅限 cyber 风 theme pack · 本期不用)

### D4 · 主题切换(dark / light / system)

- 用户可在 settings / topbar 手动切换三档
- 实装库:`next-themes`(SSR 友好 · 零 FOUC · 已有 tailwind `darkMode: 'class'` 基础)
- 切换通过 `<html data-theme="dark|light">` 属性控制;tailwind `darkMode: ['class', '[data-theme="dark"]']`

### D5 · 自有 icon 去留

- `web/components/icons/` 保留,降级为"special glyphs" · 5-15 个文件(logo marks / brand marks / 装饰字符)
- 业务 icon 一律 Lucide
- 旧 `web/components/ui/icons.tsx` 的 5 个 legacy 图元(check / arrow-right / external / copy / plus-minus)迁移到 Lucide 对应 icon · 文件删除

### D6 · Token 命名策略

**保留既有 token 名**(`bg` · `surface` · `surface-2` · `surface-3` · `border` · `border-strong` · `text` · `text-muted` · `text-subtle` · `primary` · `primary-hover` · `primary-fg` · `success` · `warning` · `danger` + `*-soft`)· 仅替换数值。**新增** token:

```
--color-surface-4      (V2 paper-400 等第四层微差)
--color-primary-muted  (primary/10 常用透明叠加预设)
--color-primary-glow   (暗色模式 highlight)
--color-accent         (V2 的 azure-sky 副强调色)
--shadow-soft
--shadow-soft-lg
--shadow-glow-sm
--shadow-glow
--shadow-inset-highlight
--dur-fast      (150ms)
--dur-base      (220ms)
--dur-slow      (320ms)
--dur-float     (6000ms, 仅 animate-float 用)
--ease-out-soft (cubic-bezier(.16,1,.3,1))
```

组件无需改代码就能从旧主题过渡到新主题。

### D7 · Theme Pack 架构(扩展性核心)

**目录结构:**

```
web/styles/themes/
├── tokens.css                    ← 仅声明变量"接口名"(无值)· 所有组件只依赖这个契约
├── brand-blue/
│   ├── light.css                 ← :root[data-theme-pack="brand-blue"][data-theme="light"] { ...all tokens }
│   ├── dark.css                  ← :root[data-theme-pack="brand-blue"][data-theme="dark"]  { ...all tokens }
│   └── index.css                 ← import light.css + dark.css
└── _next-pack/                   ← 未来扩展点 · 每个新主题包一个目录
```

- `<html data-theme-pack="brand-blue" data-theme="dark">` 两维度独立
- 默认 `data-theme-pack="brand-blue"`;后续加包时在 `ThemeProvider` 里加选项即可
- **组件只消费 token,不关心 pack**:`bg-surface` 在 brand-blue dark 下 = `#0A0D14`,在 `forest-green` dark 下自动等于森林主题的 `#0F1A14`,组件零改动
- 每个 pack 必须导出一份**完整** token 集(`tokens.css` 的所有变量);缺项在 ThemeProvider 启动时 assert 报错
- 语义色 success / warning / danger 每个 pack 可以有微调,但色相不变(绿 / 橙 / 红)· 避免"绿变红"这类语义翻转

### D8 · 双主题一致性契约

- 每个组件在 light 和 dark 下必须**传递同一份信息**:激活 / 层级关系 / 状态区分方式一致(只是色值变)
- 不允许某组件只在 dark 有发光、在 light 就丢失语义 —— 必须有 light 对应语言(阴影 / border / 色块)
- e2e 视觉回归在两个主题各跑一遍

## Rationale

- **表达力优先**:v1 MVP 阶段品牌资产为零,需要快速建立产品个性,工具感契约反而是负资产
- **迁移成本低**:token 名保留,atom 组件只做"视觉 rework",不改 prop / behavior / 调用点
- **未来可收紧**:如果 v2 后产品走成熟期要重回"克制",theme pack 机制允许做一套 "linear-precise-2" 包,用户可选
- **icon 外部化**:Lucide 维护 1400+ icon,社区活跃,比自造维护成本低一个数量级;通过 `<Icon>` 包装保留未来切换空间
- **双 pack 契约验证 extensibility**:本期只有一个包,但架构已按"多包"设计,加第二个包只改 css/ts 配置,不改组件

## Consequences

### 即生效(文档层)

- `product/03-visual-design.md` 整体重写 · 原 "Linear Precise" 章节作废
- `design-system/MASTER.md` 整体重写
- `CLAUDE.md §3.8` 从 "Linear Precise" 改为 "Brand Blue Dual Theme"
- ADR 0013 的 BAN 1 / BAN 2 两条条款作废(其余表格保留)
- ADR 0009 的"唯一 icon 来源"条款作废(降级为 brand marks source)

### 需要实施(code 层 · 分 3 阶段)

- **P2 · token + 主题基础设施(不动业务组件)**:
  - 新建 `web/styles/themes/tokens.css` + `brand-blue/light.css` + `brand-blue/dark.css`
  - `globals.css` 重组:只留 `@import` + 全局 reset
  - `tailwind.config.ts` 所有 `colors` 指向 CSS 变量(`var(--color-bg)` 等)· 新增 shadow / duration / keyframes token
  - 装 `next-themes` · `ThemeProvider` 包 root layout · 暴露 `useTheme()`
  - `design-lab` 页面重建为新契约的"活样本"(类似 `proposals/v1` + `proposals/v2`,在站内)
  - 新建 `web/components/ui/icon.tsx` `<Icon>` 包装 · 允许 name 传 lucide name
- **P3 · Atom 组件 rework**:`components/ui/*` 按 V1/V2 设计重写 · 不改 prop API
- **P4 · 页面迁移**:shell / topbar / sidebar → chat → employees → skills → ... 逐个换新视觉

### 回归

- `test_learnings.py::TestL01ToolFirstBoundary` 不受影响(本 ADR 不动 tool/meta 契约)
- web 的静态契约扫描(`pnpm test`):旧的"禁 Lucide import"规则删除 · 新增"禁直接 lucide-react import(必须经 `<Icon>`)"规则
- e2e 视觉回归基线:P2 完成后重拍 light + dark 两套基线

### 不变

- 原则 3.1-3.7(架构六原则)· Layer isolation · Checkpointer · Skill 渐进加载 · Tool First 等
- `AgentRunner` / L4 gate / 后端全部不动

## Alternatives Considered

1. **仅替换主色(primary = azure)保留其他 Linear Precise 规则** — 太表面,不解决表达力问题
2. **完全砍掉 theme pack 架构,直接硬编码 brand-blue** — 短期省事,长期每次换皮都要 massive rewrite
3. **引入第三方 design-system(shadcn / radix)重头来** — 耦合风险大;我们已有组件层 + Tailwind + tokens 契约,演进更稳

## References

- V1 Cobalt Precision 原型:`design-system/proposals/v1-cobalt-precision.html`
- V2 Azure Live 原型:`design-system/proposals/v2-azure-live.html`
- 对照入口 + 决策上下文:`design-system/proposals/index.html`
- 影响 ADR:0009(自有 icon)· 0012(viz palette)· 0013(typography + BAN)
