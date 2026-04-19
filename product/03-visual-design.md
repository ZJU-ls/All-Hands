# 03 · Visual Design System — "Linear Precise"

> **视觉方向:简洁科技风 · 精度优先**
> 参考:Linear、Vercel Dashboard、Cursor、Raycast。
> 反面:Dify(彩虹 UI、信息密度混乱)、Notion AI(过度装饰)。
>
> **此文档是视觉契约。** 所有 `web/` 下的新增代码必须遵守;
> 违反打回。Token 值变更必须先改本文件,再改 `globals.css`。

---

## 0. 三条最高纪律

1. **不用第三方 icon 库 / icon 字体**(Lucide、Heroicons、Phosphor、Tabler、Font Awesome 等都禁用)。图形信息只能来自:
   - **排版 + 中性灰阶**(最优:文字本身就是信息)
   - **功能性几何元素**:激活色条、点阵 logo、状态点、键盘 chip、方括号
   - **Mono 字符**:`→` `←` `↑` `↓` `·` `…` `⌘` `↵` `Esc`,mono 字体下渲染整齐
   - **自有 icon 集**(Raycast-style,`web/components/icons/**`):2px stroke · round caps · currentColor · 24×24 viewBox · 仅允许本项目内相对导入
   - **1-line SVG legacy**(`web/components/ui/icons.tsx`):logo 点阵 + 主题切换 sun/moon + 5 类旧图元(check / arrow-right / external / copy / plus-minus),保留不扩展
2. **颜色密度 ≤ 3 种**(不含语义状态色)。整页只允许 `text / muted / primary`,其他一律用 opacity 叠加或 surface 变体。
3. **动效克制**。时长只用 token 里的 4 档;位移不超过 `2px`;禁用无限循环动画(spinner / pulse 状态点 / shimmer 骨架除外)。

违反以上三条 = review 打回,无协商空间。

---

## 1. 设计 Tokens(canonical source)

实现在 [`web/app/globals.css`](../web/app/globals.css),Tailwind 映射在 [`web/tailwind.config.ts`](../web/tailwind.config.ts)。**本节为事实来源**,代码必须跟随本文件。

### 1.1 颜色

品牌主色选 **Indigo #6366F1**(非 blue/violet):冷静、精度感、和 zinc 中性灰阶配合最好,深浅模式共用一套主色。

```css
/* Light (:root, .light) */
--color-bg:            #FFFFFF;
--color-surface:       #FAFAFA;
--color-surface-2:     #F4F4F5;
--color-surface-3:     #EDEDEF;   /* shimmer / 微差层 */
--color-border:        #E4E4E7;
--color-border-strong: #D4D4D8;
--color-text:          #18181B;
--color-text-muted:    #71717A;
--color-text-subtle:   #A1A1AA;

--color-primary:       #6366F1;   /* Indigo-500 */
--color-primary-hover: #7C7FF3;
--color-primary-fg:    #FFFFFF;

--color-success: #059669;
--color-warning: #D97706;
--color-danger:  #DC2626;

/* Dark (.dark) */
--color-bg:            #09090B;
--color-surface:       #111113;
--color-surface-2:     #18181B;
--color-surface-3:     #1F1F22;
--color-border:        #27272A;
--color-border-strong: #3F3F46;
--color-text:          #FAFAFA;
--color-text-muted:    #A1A1AA;
--color-text-subtle:   #71717A;

--color-primary:       #6366F1;
--color-primary-hover: #818CF8;   /* Indigo-400,暗色更亮 */
--color-primary-fg:    #FFFFFF;

--color-success: #10B981;
--color-warning: #F59E0B;
--color-danger:  #EF4444;
```

**Role 色(消息气泡左边栏):**

| 角色 | Light | Dark | 语义 |
|---|---|---|---|
| `role-user` | `#6366F1` | `#818CF8` | 用户 |
| `role-lead` | `#8B5CF6` | `#A78BFA` | Lead Agent(唯一紫色) |
| `role-worker` | `#0D9488` | `#2DD4BF` | 员工 |
| `role-tool` | `#D97706` | `#FBBF24` | Tool 调用 |

**使用规约:**
- 文本默认 `text`,次要 `text-muted`,提示 `text-subtle`
- 禁止在 JSX 里写十六进制、`bg-blue-500`、`text-zinc-400` 等 Tailwind 原色类;一律走 token(`text-text-muted`、`bg-surface-2`)
- Primary 只用于:**激活指示、焦点环、主 CTA、点阵 logo**;其他一律灰阶

### 1.2 字体

```css
--font-sans: var(--font-inter), system-ui, sans-serif;
--font-mono: var(--font-jetbrains-mono), ui-monospace, monospace;
```

**加载**:[`web/app/layout.tsx`](../web/app/layout.tsx) 用 `next/font/google` 挂载 CSS 变量。

**使用规约:**
- 普通 UI 文本 → `font-sans`(Inter)
- 以下场景**必须** `font-mono`(JetBrains Mono):
  - URL / endpoint / `trace_id` / id
  - 代码块、JSON、tool call args/result
  - 键盘提示(⌘K、↵)
  - Section label(SIDEBAR 分区标题,小号大写字母间距拉开)
  - 方向符 / 终端风格标签(`→`、`· /gateway/providers · 2`)

### 1.3 字号阶梯

Inter 的 `-0.01em` tracking 在 18px+ 时更精准。

| 用途 | Tailwind | Size | Weight | Tracking |
|---|---|---|---|---|
| H1(极少用) | `text-[26px]` | 26 | 600 | `-0.01em` |
| H2 / 页标题 | `text-lg` (18) | 18 | 600 | `-0.005em` |
| 卡片标题 / Label | `text-sm` (14) | 14 | 500 | default |
| Body(对话、说明) | `text-[13px]` | 13 | 400 | default |
| Caption / mono meta | `text-[11px]` | 11 | 500 | default |
| 辅助小字 | `text-[10px]` | 10 | 500 | `0.05em`(uppercase 时) |

行高:标题 `leading-tight`;正文 `leading-relaxed`;mono 元数据 `leading-normal`。

### 1.4 圆角

```
--radius-sm:  4px   /* badge, kbd chip, status dot container */
--radius:     6px   /* button, input, small card(default) */
--radius-md:  8px   /* card, modal内卡片 */
--radius-lg:  12px  /* 对话气泡 */
--radius-xl:  16px  /* modal, drawer, 大容器 */
```

对应 Tailwind:`rounded` = 6px,`rounded-md` = 8px(见 [tailwind.config.ts](../web/tailwind.config.ts))。

### 1.5 间距

基于 4px 网格。Tailwind 默认即可。常用节奏:
- 图标内边距:`px-2 py-1`(28px 高)
- 按钮:`px-3 py-1.5`(32px 高)/ `px-4 py-2`(36px 高,主要 CTA)
- 卡片内边距:`px-4 py-3`(紧凑)/ `px-5 py-4`(标准)
- 段落间隔:`space-y-2` 列表 / `space-y-4` 章节 / `space-y-6` 大块

### 1.6 阴影

Linear Precise **不靠阴影制造层级**,主要靠边框和 surface 色。只在 modal / dropdown 使用:

```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);   /* light, modal */
--shadow:    0 4px 12px rgba(0,0,0,0.08);  /* light, dropdown */
--shadow-dark-sm: 0 1px 2px rgba(0,0,0,0.4);
--shadow-dark:    0 4px 12px rgba(0,0,0,0.5);
```

### 1.7 动效

```css
--ease-out: cubic-bezier(0.4, 0, 0.2, 1);
--dur-fast: 120ms;   /* kbd chip, 小徽章 */
--dur-base: 150ms;   /* 按钮、边框色切换(默认)*/
--dur-mid:  220ms;   /* 卡片 hover、modal 入场 */
--dur-slow: 320ms;   /* progress 填充、页签切换 */
```

**规约:**
- 颜色类过渡用 `transition-colors` + `duration-150`(Tailwind 对齐 `--dur-base`)
- 位移最大 `2px`(如箭头 `translateX`);**禁止** scale/rotate 常规使用
- 入场动画只用 `fade-up`(translateY 4→0 + opacity 0→1,220ms)
- 允许的无限动画:Spinner 旋转、三点脉动、Shimmer 骨架、Status Dot 脉动、Caret 闪烁;**其他一律禁止**

Keyframes 已在 [`globals.css`](../web/app/globals.css) 提供:`ah-spin`、`ah-pulse`、`ah-shimmer`、`ah-bar-in`、`ah-caret`、`ah-dot`、`ah-fade-up`。

---

## 2. Icon 体系(强约束)

**禁第三方 icon 库**,自有图形来源按优先级:

### 2.1 激活色条(主导航激活状态)

左侧 2px 色条 + primary 色,入场 `ah-bar-in 180ms`:

```tsx
{active && (
  <span
    className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
    style={{ animation: "ah-bar-in 180ms var(--ease-out) both", transformOrigin: "center" }}
  />
)}
```

### 2.2 点阵 Logo(应用标识)

3×3 栅格,五点 X 形或对角呈 primary 色,其余透明:

```tsx
function LogoDotgrid() {
  return (
    <div className="grid grid-cols-3 gap-[2px] w-[14px] h-[14px]">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="rounded-[1px]"
          style={{ background: [0,2,4,6,8].includes(i) ? "var(--color-primary)" : "transparent" }}
        />
      ))}
    </div>
  );
}
```

### 2.3 状态点(语义状态)

`7px` 圆点,running/queued 时 `ah-pulse` 脉动:

```tsx
<span
  className="inline-block w-[7px] h-[7px] rounded-full mr-1.5"
  style={{
    background: "var(--color-success)",
    animation: "ah-pulse 1.6s ease-in-out infinite"
  }}
/>
```

### 2.4 键盘 Chip(快捷键提示)

Mono 字 + 细边框 + surface-2 背景,`text-[10px]`:

```tsx
<span className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface-2 text-text-muted">
  ⌘K
</span>
```

### 2.5 Mono 方向符(内联提示)

```
list → detail    ·    prev ← next    ·    ↑ up    ↓ down
```

### 2.6 1-line SVG legacy(仅 5 类,不再扩展)

历史产物,`1.5px stroke` + `round linecap/linejoin`。**仅允许这 5 个场景**,继续在 [`web/components/ui/icons.tsx`](../web/components/ui/icons.tsx):
- **check**:操作成功反馈(表单、测试通过)
- **arrow-right**:导航、跳转、"更多" 指示
- **external**:外部链接(LangFuse、文档)
- **copy**:复制按钮
- **minus / plus**:展开收起

新需求一律走 §2.7 自有 icon 集,不再往 1-line SVG legacy 里加。

### 2.7 自有 Icon 集(Raycast-style · ADR 0009)

统一规格 · 承担 nav / composer / viz / 资源类型 的图形识别:

- **路径**:[`web/components/icons/`](../web/components/icons/),每个 icon 一个 `.tsx` 文件,从 `./Base` import `IconBase`
- **viewBox**:`0 0 24 24`
- **stroke-width**:`2`(默认;props `strokeWidth` 可覆盖)
- **stroke-linecap / linejoin**:`round`
- **fill**:`none`(纯描边 · 不允许 duotone / 填充)
- **color**:只能 `stroke="currentColor"`,颜色由父 `text-*` 类决定;**禁止**在 icon 内写 hex / `stroke-blue-500`
- **default size**:`20px`(props `size` 可覆盖,常用 16 / 20 / 24 / 32)
- **命名**:PascalCase + `Icon` 后缀(`ChatIcon` / `UserIcon` / ...),`index.ts` 聚合导出
- **props contract**:`{ size?: number; strokeWidth?: number } & SVGProps`(见 `IconBase`)

**当前集合(22 个)**:
`ChatIcon` · `UserIcon` · `SkillIcon` · `ModelIcon` · `PluginIcon` · `ProviderIcon` · `TriggerIcon` · `TaskIcon` · `CockpitIcon` · `ObservatoryIcon` · `ChannelIcon` · `MarketIcon` · `StockIcon` · `SettingsIcon` · `SearchIcon` · `SendIcon` · `StopIcon` · `AttachIcon` · `ThinkIcon` · `ExternalIcon` · `CopyIcon` · `CheckIcon`

**新增 icon 流程**(不需 ADR,但需过光学自检):
1. 写 `web/components/icons/<Name>Icon.tsx`
2. `index.ts` 加一行 export
3. 在 [`/design-lab` Icon Gallery](../web/app/design-lab/page.tsx) 把它加入 `ICONS` 数组
4. 视觉自检:和相邻 icon 在 `size=20` 下光学一样大 + 描边粗细一致;不过就重画

**使用示例**:
```tsx
import { ChatIcon, UserIcon } from "@/components/icons";

<ChatIcon size={20} className="text-text-muted" />
<UserIcon size={16} className="text-primary" />
```

### 2.8 禁止清单

- ❌ emoji(`☀` `☾` `🔧` `📊` `⚙` `💬`)
- ❌ 任何第三方 icon 库(Lucide、Heroicons、Phosphor、Tabler、Font Awesome 等)
- ❌ icon 字体
- ❌ 彩色 icon / 多色 icon / duotone / 填充形
- ❌ icon 作为按钮的唯一内容且无 `aria-label`
- ❌ icon 内写 hex / Tailwind 原色类(必须走 `currentColor`)

---

## 3. 组件契约

### 3.1 Button

五种变体,每种固定 4 状态。实现见 [`web/components/ui/button.tsx`](../web/components/ui/button.tsx)(如不存在,新建时遵守本节):

| Variant | Default | Hover | Loading | Disabled |
|---|---|---|---|---|
| `primary` | `bg-primary text-primary-fg` | `bg-primary-hover` | `bg-primary` + spinner(primary-fg) | `opacity-40` |
| `secondary` | `bg-surface border-border text-text` | `bg-surface-2 border-border-strong` | spinner(muted) | `opacity-50` |
| `ghost` | `text-text-muted` | `bg-surface-2 text-text` | spinner(muted) | `opacity-50` |
| `danger` | `text-danger border-border` | `bg-danger/10 border-danger/50` | spinner(danger) | `opacity-40` |
| `glyph` | `bg-surface border-border text-muted` | `bg-surface-2 border-strong text-text` | spinner | `opacity-50` |

- `transition-colors duration-150`
- 尺寸:默认 `px-3 py-1.5 text-[12px]`;主要 CTA `px-4 py-2 text-sm`
- 不使用 `box-shadow` 作为交互反馈

### 3.2 Input

```tsx
<input
  className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text
             placeholder-text-subtle transition-colors duration-150
             focus:outline-none focus:border-primary"
/>
```

- 焦点状态只改 `border-color`,**不加 ring**、**不加 shadow**
- 错误态 `border-danger` + 下方 `text-[10px] text-danger` 错误提示
- URL / key 等技术字段必须 `font-mono`

### 3.3 Badge

```tsx
<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
  默认
</span>
```

色调:`primary`、`neutral(surface-2/muted)`、`success`、`warning`、`danger`、`mono(surface-2 + mono font,用于 model name/id)`。背景一律用 `/15` 或 `/10` 透明度叠加。

### 3.4 Card

```tsx
<div className="rounded-md border border-border bg-surface p-4 transition-colors duration-[180ms] hover:border-border-strong">
```

- Hover **只变边框亮度**,禁止位移 / 阴影 / 放大
- 选中态 = 左侧 2px `bg-primary` 色条(同激活色条规则)

### 3.5 Nav Item(侧边栏菜单项)

- 高度 `h-7` / 字号 `text-[12px]`
- 未激活 `text-text-muted`,hover `text-text + bg-surface-2`
- 激活 = `text-text` + 左侧 2px primary 色条

### 3.6 Section Label(侧边栏分区标题)

```tsx
<div className="px-3 mt-3 mb-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-text-subtle">
  工作区
</div>
```

### 3.7 Modal / Dialog

- 背景遮罩 `bg-black/60`
- 容器 `rounded-xl border border-border bg-surface shadow-lg`(暗色用 `shadow-dark`)
- 入场 `ah-fade-up 220ms`
- Footer 按钮靠右,取消在左(secondary),确认在右(primary 或 danger)

### 3.8 Loading 态

- **Spinner**:圆环旋转 700ms,`border-[1.5px]` + `border-t-current`
- **三点**:`ah-dot 1.2s` 逐 150ms 延迟
- **Shimmer**:用于列表骨架,`ah-shimmer 1.4s linear infinite`
- **Progress**:线性 4px 高条,`bg-surface-2` 底 + `bg-primary` 填充

---

## 4. 布局

### 4.1 AppShell 顶层骨架

```
┌──────────────────────────────────────────────────┐
│ Top bar  56px  ·  title + actions + ThemeToggle  │
├──────────┬───────────────────────────────────────┤
│ Sidebar  │                                       │
│  240px   │  主内容区(max-w-3xl | max-w-5xl)    │
│          │                                       │
│  两级菜单│  卡片流 / 对话流                      │
│          │                                       │
└──────────┴───────────────────────────────────────┘
```

- 侧栏 240px 固定(折叠 48px,v1 做)
- Top bar 高度 `44px`(`h-11`) - 比 v0 的 56px 更紧,跟 Linear 同
- 内容区默认 `max-w-3xl mx-auto px-8 py-8`;对话、表格用 `max-w-5xl`

### 4.2 侧边栏结构

两级:**分区(Section Label)** + **菜单项(Nav Item)**。分区之间 `mt-3`,菜单项之间无间隙。

- 顶部 44px logo 行:`LogoDotgrid` + `allhands` 品牌字(`text-[13px] font-semibold tracking-tight`)
- 底部固定 user chip(v1)

### 4.3 移动(< 768px,v1)

- 侧栏变 drawer,左上汉堡
- 输入框固底,消息区满屏
- v0 先 desktop-first,不做 mobile 适配

---

## 5. 深色 / 浅色切换

- FOUC 保护:`layout.tsx` inline script 在 React 水合前读 `localStorage.allhands_theme`,添加 `.light` / `.dark` class
- 切换组件 [`web/components/theme/ThemeToggle.tsx`](../web/components/theme/ThemeToggle.tsx):不用 emoji,用 **1-line SVG**(sun: 圆 + 8 条射线 / moon: crescent)或 **mono 字符** `LT / DK` 作为切换指示
- 主题 = 单一 class,CSS vars 自然切换;**不允许** 组件内部写 `dark:bg-zinc-900` 这种并行定义,一律走 token

---

## 6. 消息气泡 Role 着色

左侧 2px 色条 + 对应 `role-*` token;气泡本体 `bg-surface`。role 信息还必须通过 `aria-label` 提供。

```
user    #6366F1 (indigo)
lead    #8B5CF6 (violet) — 唯一性,整个项目只有 Lead 用紫色
worker  #0D9488 (teal)
tool    #D97706 (amber)
```

---

## 7. Component Registry(前端 Render Tool 扩展点)

保持 v0 机制:`web/lib/component-registry.ts` 映射。新组件必须:
- 遵守本文件 token / 组件契约
- 不引入新的 icon 库
- 文件独立在 `web/components/render/`

新增流程:
1. 后端 render tool 返回 `{ component: "MyThing", props: {...} }`
2. 实现 `web/components/render/MyThing.tsx`
3. `component-registry.ts` 加一行

---

## 8. 可访问性

- 交互元素必须 keyboard focus 可见。方案:在 `button` / `a` / `input` 的 focus-visible 态加 **1px primary 外描边**(不用 `ring`),这样在不加阴影的原则下仍然提供清晰焦点
- Confirmation 弹窗默认 focus "Reject"(避免误确认)
- role 颜色必须同时有 `aria-label`
- 对比度:`text` 对 `bg` ≥ 13:1;`text-muted` 对 `bg` ≥ 4.5:1(WCAG AA)

---

## 9. 不做(v0)

- ❌ 主题自定义 / 用户调色板
- ❌ 拖拽工作流编辑器
- ❌ 复杂图表驾驶舱
- ❌ 全屏命令面板(Raycast 式,v2)
- ❌ 任何动画库(Framer Motion、GSAP);CSS keyframes 足够
- ❌ 任何**第三方** icon 包(自有集 `web/components/icons/**` 允许,见 §2.7 + ADR 0009)

---

## 10. 变更流程

1. 修改本文件 token / 契约
2. 同步修改 [`web/app/globals.css`](../web/app/globals.css)、[`web/tailwind.config.ts`](../web/tailwind.config.ts)
3. 同步修改 [`design-system/MASTER.md`](../design-system/MASTER.md)(tactical 速查表)
4. 必要时:ADR(色系 / 字体 / 基础组件契约变更)
5. 现有页面按新 token 回归检查,尤其是 [`/design-lab`](../web/app/design-lab/page.tsx) 的深度展示部分
