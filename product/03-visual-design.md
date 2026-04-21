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
2. **颜色密度 ≤ 3 种**(不含语义状态色 + 不含品牌识别色)。整页只允许 `text / muted / primary`,其他一律用 opacity 叠加或 surface 变体。
   - **品牌识别色豁免**:provider / model 的官方品牌标(`<BrandMark />`)渲染厂商自有色彩(Anthropic 铁锈橙 / DeepSeek 蓝 / Qwen 紫 / Kimi / MiniMax / Zhipu / Bailian)。这是产品识别信息,不是装饰;和语义状态色一样不计入三色预算。**豁免仅限 BrandMark 组件**,其他地方仍禁止引入品牌色 literal。无官方彩色标的品牌(OpenAI / OpenRouter)继续走 mono + `currentColor`。
3. **动效克制**。时长只用 token 里的 4 档;位移不超过 `2px`;禁用无限循环动画(spinner / pulse 状态点 / shimmer 骨架除外)。

违反以上三条 = review 打回,无协商空间。

**允许的装饰原语(composition primitives)** · 详见 [§11 Composition Primitives](#11-composition-primitives装饰原语):sparkline(micro-viz)· dotgrid backdrop · hairline accent · `ah-fade-up` 入场 · 数值 ≤ 2px 过渡。这些**都走既有 token**,不松绑上面三条硬纪律,只是把既有语汇列明,避免每次都重新争。

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

### 3.9 Popover / Dropdown 位置策略(必读)

任何"触发器 + 可展开面板"(下拉、历史菜单、overlay picker)都必须遵守:

1. **默认方向 = 向下**(`top-full mt-1`)。往上展(`bottom-full mb-1`)是 header-chip 级别的例外,且**不许**硬编码 —— 必须走 flip 逻辑。
2. **垂直必须 flip**:使用 [`web/lib/popover-placement.ts`](../web/lib/popover-placement.ts) 的 `computePopoverSide(rect, estimatedHeight, window.innerHeight, preferredSide)`。规则:
   - 优先边能装下 → 用优先边
   - 装不下但对面空间更多 → 翻到对面
   - 两边都挤 → 仍然守优先边(抖动比拥挤更让人恼火)
3. **水平也必须 flip(面板宽于触发器时)**:使用同一份 `popover-placement.ts` 的 `computePopoverAlign(rect, panelWidth, window.innerWidth, preferredAlign)`。`start` = 面板左对齐触发器左缘(向右延展) · `end` = 面板右对齐触发器右缘(向左延展)。典型反例:chip-style 面板(240–320px)在 composer **左半区**按 `end` 对齐 → 面板往左延 240px → 撞 AppShell 侧栏。必须 flip。
4. **必须 clamp maxHeight 到可用空间**:`Select` 示范做法 ——
   ```ts
   const avail = picked === "bottom" ? vh - rect.bottom - 8 : rect.top - 8;
   setPanelMaxHeight(Math.max(120, Math.min(maxHeight, avail)));
   ```
   8px 是对齐 4/8/12 间距阶梯的视口边距。最小 120px 是"至少一屏选项"的保底。
5. **不许硬编码方向**。以下模式看到就打回:
   ```tsx
   // ❌ 硬上展 · 撞头部
   className="absolute bottom-full mb-1 ..."
   // ❌ 硬下展 · 出视口
   className="absolute top-full mt-1 max-h-96 ..."
   // ❌ 硬右对齐 · 触发器偏左时撞侧栏
   className="absolute right-0 w-60 ..."
   // ✅ 两个轴都由 state 驱动
   className={cn(
     side === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
     align === "end" ? "right-0" : "left-0",
   )}
   ```
6. **z-index**:面板 `z-20` 起步,命令面板 / 全局抽屉 `z-30+`。嵌在 `role="dialog"` 里的面板用比 dialog 低 10 的值(`z-40` vs `z-50`),保证点击区分层但不打架。
7. **DOM 位置**:面板渲染在触发器同 DOM 子树(非 portal),这样外层"click-outside"判断仍把面板里的点击看成"内部",嵌套 popover 不会互相关(见 `Select` 的 `mousedown` 选项 handler 避开外层关闭的设计)。
8. **关闭时不抖动**:`open=true` 期间不许动态切 side/align(`useLayoutEffect` 仅依赖 `[open]` / `[open, maxHeight]`,不依赖滚动),滚动视口时面板随触发器走位是可接受的,但方向不可反转。

**什么时候该用 flip、什么时候不需要**

- 面板宽度 > 触发器宽度 → **两轴都要 flip**(Select · ModelOverrideChip)
- 面板宽度 ≤ 触发器宽度 + 触发器位置稳定在视口一侧 → 只需垂直 flip(ConversationSwitcher · 在 chat header 右侧)
- 面板永远铺满一侧(drawer)→ 不是 popover,不适用

**当前实现的守门:**
- `Select.tsx`(通用原语 · 6 个下拉已迁移 · side + align 都 flip + maxHeight clamp)
- `ModelOverrideChip.tsx`(chat header + composer chip · side + align 都 flip)
- `ConversationSwitcher.tsx`(历史 popover · 只 side flip · 详见"什么时候不需要")
- `web/lib/__tests__/popover-placement.test.ts`(flip 决策矩阵 11 用例:6 vertical + 5 horizontal)
- `web/tests/popover-placement-contract.test.ts`(静态扫描:`top-full`/`bottom-full` 出现就必须有 flip 三元)

**不要**用 Floating UI / Popper.js / Radix —— 这条规则的整个价值就是让我们**拥有**位置策略,不是再加一层库。

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

## 9.1 Voice & Tone(文案纪律 · I-0013)

视觉是骨架,文案是骨架的气息。allhands 的 UI 文案和 Lead Agent 的回应必须听起来像同一个产品 —— 冷静、以事实为准、指向下一步,而不是讨好或演绎。

**硬规则(违反打回,无协商):**

1. **禁 emoji**(UI 文本、Agent 回应、日志皆禁)。图形语义只能来自 §2 的 icon 体系。
2. **禁感叹号 `!`**(包括"太好了!""搞定!""失败!")。句号结尾即可。
3. **代词**用 `我` / `你`,**禁止** `咱们` / `我们` —— 它稀释责任主体,让"谁在做、谁拿结果"模糊掉。
4. **按钮文案用动宾短语**(动词开头)。`发布` / `删除` / `测试发送` / `切换默认` / `保存草稿`。**禁止** `确定` / `OK` / `提交`(无语义)。Danger 按钮写清后果:`删除员工` 而不是 `删除`。
5. **空状态 ≠ "暂无数据"**,必须给出"下一步可以做什么"。范式:`还没有 X · [动作建议]`。
6. **错误文案指向修复**,不指向失败本身。写 `可以试试改成 X` / `填入 base_url 后重试`,不写 `调用失败!` / `Error: 500`。
7. **Lead Agent 欢迎语**(首轮空对话)必须给出 **3 条具体可点的示例 prompt**,不许只留空气。模板见 [`backend/src/allhands/execution/prompts/lead_agent.md` §Welcome message](../backend/src/allhands/execution/prompts/lead_agent.md)。

**语气梯度(按语境选一档,不跨档混用):**

| 场景 | 语气 | 示例 | 反例 |
|---|---|---|---|
| 数据密集(cockpit / traces) | 事实,无修饰 | `12 runs running · 3 queued · $0.42 今日` | `运行中啦~ 看起来一切正常!` |
| 表单 / 设置 | 平实,指向生效范围 | `保存后立刻对所有新对话生效,已在跑的 run 不受影响` | `点击保存让我们搞定它!` |
| 空状态 / 引导 | 主动给下一步 | `还没有员工 · "帮我建一个每天写日报的员工"` | `暂无数据` |
| 错误 | 指向修复 | `base_url 格式不对,试试 https://api.example.com/v1` | `调用失败! 请检查!` |

**Lead Agent 专属:**

- 选员工要说 `选 X,因为 Y`,不要只说 `我来安排`。
- 并行派发要预告:`我并行派 A/B,完成后合并回你`。
- 模糊需求问 **一个** 关键问题,不要一次甩五个。
- `list_*` 没确认前,禁止造名字或工具。

**检查钩子:**

- `web/tests/voice-tone.test.ts` — 扫 `web/app/**` + `product/**` 里的 emoji / `!` / `咱们` / `我们` 泄漏。
- `backend/tests/unit/test_lead_welcome.py` — 断言 Lead prompt 含 "Welcome message" 节 + `欢迎` + 至少 3 条 `- "..."` 示例。

Token / 组件契约变更要同步改 §1 ~ §3;**Voice & Tone 变更要同步改 `backend/src/allhands/execution/prompts/lead_agent.md` 的 Style 节和 `design-system/MASTER.md` 的 Voice 速查表**。

---

## 10. Composition Primitives(装饰原语)

> 本节是 §0.3 的延展 —— 把"允许的装饰原语"写清楚,让 Linear Precise 在"**信息密度 + 视觉呼吸**"两端都能展开,而不只是"什么都不准加"。每条都有强约束,违规仍然打回。

### 10.1 Sparkline / Micro-viz

纯 SVG,用于 KPI 趋势、活动密度、延迟分布。

- **描边**:`stroke="currentColor"` 或 `stroke="var(--color-primary)"`,`stroke-width="1.5"`,`fill="none"`
- **尺寸**:高度 ≤ 32px,宽度自适应容器
- **端点强调**:最末点可额外渲染 `r=2` 圆(`fill="currentColor"`),无阴影无光晕
- **禁止**:渐变填充、多色描边、库(chart.js / recharts / d3 / visx 等)

```tsx
<svg viewBox="0 0 100 32" className="w-full h-8 text-primary">
  <polyline
    points={points.map((y, x) => `${(x / (points.length - 1)) * 100},${32 - y * 32}`).join(" ")}
    stroke="currentColor"
    strokeWidth="1.5"
    fill="none"
  />
</svg>
```

### 10.2 Dotgrid Backdrop

hero 区、空状态卡片、首次使用屏做视觉锚,不抢信息焦点。

- **实现**:CSS `radial-gradient` + `var(--color-border)` 圆点,间距 ≥ 16px,**整体不透明度 ≤ 40%**
- **不混用**:同一容器内不叠加 dotgrid 与 gradient accent(选其一)
- **不动**:dotgrid 本身静态,不做 pan / rotate 动画(会打破 §0.3 "无限动画白名单")

```css
background-image: radial-gradient(
  var(--color-border) 1px,
  transparent 1px
);
background-size: 16px 16px;
opacity: 0.4;
```

### 10.3 Hairline Accent(1px 高光条)

标记"推荐/默认/最新"项,**不替代** §2.1 的 2px 激活色条(激活是交互状态,hairline 是装饰强调)。

- **位置**:卡片顶部或左侧 1px 高
- **色**:`linear-gradient(to right|bottom, var(--color-primary), transparent)`,不透明度 ≤ 25%
- **禁止**:同一卡片同时出现"激活色条 + hairline"(视觉混淆)

### 10.4 入场动效

`ah-fade-up`(4px translateY + opacity 0→1,220ms)用于:

- 路由切换时 main 内容入场
- 列表初次渲染
- Modal / Drawer 入场

`scaleY(0→1)` **仅限** §2.1 激活色条 (`ah-bar-in`)。`hover:scale-*` / `active:scale-*` 一律禁。

### 10.5 数值变动过渡

KPI 数字 / 计数从一个值变到另一个值时:

- **方式 A**:直接替换文本 + `transition: color 150ms var(--ease-out)`,色从 `var(--color-primary)` 回落到 `var(--color-text)`(闪烁提示新值)
- **方式 B**:数字容器做一次 `translateY(2px → 0)` 入场(不超过 2px)

**禁止**:Framer Motion / react-spring / CountUp.js 等任何 tween 库。allhands 的"数字跳动"只做"颜色高亮 150ms",不做 0→N 滚动动画(噪声大 · 不 Linear)。

### 10.6 KeyFrames 白名单(追加)

现有 whitelist:`ah-spin` / `ah-pulse` / `ah-shimmer` / `ah-bar-in` / `ah-caret` / `ah-dot` / `ah-fade-up`。本节允许新增:

- `ah-sheen` — 一次性高光扫过(用于"测试通过 / 任务完成"庆祝瞬间,不循环)。实现:background-position 或 translateX 单向动画 600ms,完成即停。

除上述白名单外,新增 keyframe 必须先改本文件再改 `globals.css`。

---

## 11. 变更流程

1. 修改本文件 token / 契约
2. 同步修改 [`web/app/globals.css`](../web/app/globals.css)、[`web/tailwind.config.ts`](../web/tailwind.config.ts)
3. 同步修改 [`design-system/MASTER.md`](../design-system/MASTER.md)(tactical 速查表)
4. 必要时:ADR(色系 / 字体 / 基础组件契约变更)
5. 现有页面按新 token 回归检查,尤其是 [`/design-lab`](../web/app/design-lab/page.tsx) 的深度展示部分
