# allhands · Design System MASTER (Tactical Reference)

> **快速速查 · 给 Claude 代码会话用。规范细节看 [product/03-visual-design.md](../product/03-visual-design.md)。**
>
> 原则优先级:`product/03-visual-design.md` > 本文件 > 现有代码。
> 本文件与 `03-visual-design.md` 冲突时,以后者为准并立即更新本文件。

---

## 0. 每次开发前的自检

写任何 `web/` 组件之前,必须回答 yes:

- [ ] 我没打算装**第三方** icon 库(Lucide / Heroicons / Phosphor / Tabler / Font Awesome) — 自有 icon 集 `@/components/icons` 允许,见 §3
- [ ] 我没在 JSX 里写十六进制或 Tailwind 原色类(`bg-blue-500`、`text-zinc-400`)
- [ ] 我用的颜色都来自 `bg-*`、`text-*`、`border-*`、`primary`、`success`、`warning`、`danger` token
- [ ] 要显示 provider / model 品牌,用 `<BrandMark />`(§3.5 豁免,走厂商彩色 SVG),不要自己拼 `<img>`
- [ ] 我没加 `box-shadow` 做交互反馈(hover 只改边框)
- [ ] 我的过渡时长来自 `--dur-*` 或 Tailwind `duration-150 / 220 / 320`
- [ ] 激活 / 选中状态用 **2px 左色条**,不用背景色高亮
- [ ] emoji 出现的地方,我确认过是"用户内容"而不是"UI 装饰"

---

## 1. Token 速查(Tailwind 类)

### 颜色

| 想要 | 用这个类 | 避免 |
|---|---|---|
| 页面背景 | `bg-bg` | `bg-white`、`bg-zinc-950` |
| 卡片 / 侧栏 | `bg-surface` | `bg-neutral-900` |
| 输入底 / hover | `bg-surface-2` | `bg-zinc-800` |
| 骨架 / 微差 | `bg-surface-3` | — |
| 正文 | `text-text` | `text-white`、`text-black` |
| 次要 | `text-text-muted` | `text-zinc-400` |
| 提示 | `text-text-subtle` | `text-zinc-500` |
| 边框 | `border-border` | `border-zinc-800` |
| 强边框 (hover) | `border-border-strong` | — |
| 主操作 | `bg-primary text-primary-fg` | `bg-blue-500`、`bg-indigo-500` |
| hover | `hover:bg-primary-hover` | — |
| 成功 | `text-success` / `bg-success/10` | `text-green-500` |
| 警告 | `text-warning` / `bg-warning/10` | — |
| 危险 | `text-danger` / `bg-danger/10` | `text-red-500` |

### 字体

| 场景 | 类 |
|---|---|
| 默认 UI | 继承 `font-sans`(Inter) |
| URL / id / trace / JSON / kbd / 方向符 | `font-mono`(JetBrains Mono) |

### 字号

| 场景 | 类 |
|---|---|
| H1 | `text-[26px] font-semibold tracking-tight` |
| H2 / 页标题 | `text-lg font-semibold tracking-tight` |
| 卡片标题 / Label | `text-sm font-medium` |
| Body | `text-[13px]` |
| Caption / meta | `text-[11px]` |
| 小字 / Section Label | `text-[10px] uppercase tracking-wider` |

### 圆角

| 类 | 尺寸 | 用途 |
|---|---|---|
| `rounded-sm` | 4px | badge, kbd chip |
| `rounded` | 6px | button, input |
| `rounded-md` | 8px | card |
| `rounded-lg` | 12px | 消息气泡 |
| `rounded-xl` | 16px | modal |

### 过渡

| 类 | 用于 |
|---|---|
| `transition-colors duration-150` | 默认(按钮、边框、输入聚焦) |
| `transition-colors duration-[180ms]` | 卡片 hover |
| `transition-opacity duration-150` | opacity 变化 |
| 禁止 | `transition-transform`(除 arrow ≤ 2px 位移) |

---

## 2. 组件模板(直接复制)

### 2.1 主按钮

```tsx
<button className="rounded bg-primary hover:bg-primary-hover disabled:opacity-40 text-primary-fg text-[12px] font-medium px-3 py-1.5 transition-colors duration-150">
  新建供应商
</button>
```

主要 CTA(稍大):`px-4 py-2 text-sm`。

### 2.2 次按钮

```tsx
<button className="rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text text-[12px] px-3 py-1.5 transition-colors duration-150">
  取消
</button>
```

### 2.3 Ghost 按钮(列表行内操作)

```tsx
<button className="rounded border border-border hover:bg-surface-2 text-text-muted hover:text-text text-xs px-2 py-1 transition-colors duration-150">
  测试
</button>
```

### 2.4 危险按钮

```tsx
<button className="rounded border border-border text-danger hover:bg-danger/10 hover:border-danger/50 text-xs px-2 py-1 transition-colors duration-150">
  删除
</button>
```

### 2.5 输入框

```tsx
<input className="w-full rounded-md bg-bg border border-border focus:border-primary outline-none px-3 py-2 text-sm text-text placeholder-text-subtle transition-colors duration-150" />
```

URL / key 字段加 `font-mono`。

### 2.6 卡片(hover 态)

```tsx
<div className="rounded-md border border-border hover:border-border-strong bg-surface px-4 py-3 transition-colors duration-[180ms]">
  ...
</div>
```

### 2.7 激活色条(侧栏 / 选中卡片)

```tsx
<div className="relative h-7 px-3 flex items-center text-[12px] text-text cursor-pointer">
  <span
    className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
    style={{ animation: "ah-bar-in 180ms var(--ease-out) both" }}
  />
  对话
</div>
```

### 2.8 Section Label(侧栏分区)

```tsx
<div className="px-3 mt-3 mb-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-text-subtle">
  工作区
</div>
```

### 2.9 Badge

```tsx
{/* primary */}
<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">默认</span>
{/* neutral */}
<span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">已禁用</span>
{/* success */}
<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-success/10 text-success">connected</span>
{/* danger */}
<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-danger/10 text-danger">IRREVERSIBLE</span>
{/* mono */}
<span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text">gpt-4o-mini</span>
```

### 2.10 Kbd Chip

```tsx
<span className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface-2 text-text-muted">⌘K</span>
```

### 2.11 Status Dot(脉动)

```tsx
<span
  className="inline-block w-[7px] h-[7px] rounded-full mr-1.5 bg-success"
  style={{ animation: "ah-pulse 1.6s ease-in-out infinite" }}
/>
```

### 2.12 Spinner

```tsx
<span
  className="inline-block w-3.5 h-3.5 rounded-full border-[1.5px]"
  style={{
    borderColor: "color-mix(in srgb, currentColor 25%, transparent)",
    borderTopColor: "currentColor",
    animation: "ah-spin 700ms linear infinite",
  }}
/>
```

### 2.13 Shimmer(骨架)

```tsx
<div
  className="rounded-full h-2"
  style={{
    width: 180,
    background: "linear-gradient(90deg, var(--color-surface-2) 0%, var(--color-surface-3) 50%, var(--color-surface-2) 100%)",
    backgroundSize: "200% 100%",
    animation: "ah-shimmer 1.4s linear infinite",
  }}
/>
```

### 2.14 Empty State

```tsx
<div className="rounded-md border border-dashed border-border bg-surface p-5 text-center">
  <p className="text-[12px] text-text">尚未配置任何供应商</p>
  <p className="text-[11px] text-text-muted mt-1">添加 OpenAI / DeepSeek / Ollama 等兼容端点即可开始</p>
</div>
```

### 2.15 Modal

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
  <div
    className="w-full max-w-md rounded-xl border border-border bg-surface p-5"
    style={{ animation: "ah-fade-up 220ms var(--ease-out) both" }}
  >
    <h2 className="text-sm font-semibold text-text mb-2">标题</h2>
    <p className="text-[12px] text-text-muted mb-4">内容</p>
    <div className="flex gap-2 justify-end">
      {/* secondary 在左 */}
      <button className="...">取消</button>
      {/* primary / danger 在右 */}
      <button className="...">确认</button>
    </div>
  </div>
</div>
```

---

## 3. Icon 体系(禁止第三方 icon 库 · 自有集允许)

### 3.1 三类来源

| 类别 | 路径 | 用途 |
|---|---|---|
| **功能性几何元素** | 组件内 inline | logo / 激活色条 / 状态点 / Kbd chip / 光标 |
| **自有 icon 集(Raycast-style)** | [`web/components/icons/`](../web/components/icons/) | nav / composer / viz / 资源类型 |
| **Legacy 1-line SVG(5 类 · 不扩展)** | [`web/components/ui/icons.tsx`](../web/components/ui/icons.tsx) | check / arrow-right / external / copy / plus-minus |

### 3.2 自有 icon 集(22 个 · ADR 0009)

**规格**:viewBox `0 0 24 24` · stroke-width 2 · round caps · fill none · `stroke="currentColor"` · default `size=20`。

**导入**:
```tsx
import { ChatIcon, UserIcon, SendIcon } from "@/components/icons";
<ChatIcon size={20} className="text-text-muted" />
```

**当前集合**:`ChatIcon` · `UserIcon` · `SkillIcon` · `ModelIcon` · `PluginIcon` · `ProviderIcon` · `TriggerIcon` · `TaskIcon` · `CockpitIcon` · `ObservatoryIcon` · `ChannelIcon` · `MarketIcon` · `StockIcon` · `SettingsIcon` · `SearchIcon` · `SendIcon` · `StopIcon` · `AttachIcon` · `ThinkIcon` · `ExternalIcon` · `CopyIcon` · `CheckIcon`

**新增流程**:写 `.tsx` → `index.ts` export → 加到 [`/design-lab` Icon Gallery](../web/app/design-lab/page.tsx) → 光学一致性自检(和相邻 icon 在 `size=20` 下要看起来一样大)。不需要 ADR,但光学不过 review 直接打回。

### 3.3 非 icon 图形速查

| 场景 | 用法 |
|---|---|
| 应用 logo | `LogoDotgrid`(3×3 点阵,primary 五点 X 形) |
| 侧栏激活 | 2px primary 左色条 |
| 快捷键提示 | Kbd Chip,mono 字符 |
| 状态指示 | 7px 脉动色点 |
| 方向 / 流向 | mono 字符 `→ ← ↑ ↓ ·` |
| 键入光标 | 7×12px 矩形 `ah-caret 1s step-end infinite` |

---

## 4. 主题切换

读 `localStorage.allhands_theme` = `"light"` | `"dark"`;`layout.tsx` 内置 FOUC 保护。

切换按钮 **不用 emoji** `☀/☾`,用:
- **方案 A**:1-line SVG sun / moon(对称,1.5px stroke)
- **方案 B**:mono 字符 `LT` / `DK`(terminal 风格)

禁止使用 `dark:bg-zinc-900` 这类并行定义 —— 一律走 CSS var。

---

## 5. Keyframes(已挂在 globals.css)

```
ah-spin      spinner
ah-pulse     status dot
ah-shimmer   skeleton
ah-bar-in    activation bar(scaleY 0→1)
ah-caret     typing cursor(blink)
ah-dot       三点省略(1.2s, 按 150ms 错开延迟)
ah-fade-up   modal / message 入场(4px translateY + opacity)
```

---

## 6. 违规示例(review 会打回)

```tsx
// ❌ icon 库
import { ChevronRight, Sun, Moon } from "lucide-react";

// ❌ 硬编码颜色
<div className="bg-zinc-950 text-white">

// ❌ 并行深色定义
<div className="bg-white dark:bg-black">

// ❌ 位移 hover
<button className="hover:scale-105">

// ❌ 阴影做层级
<div className="shadow-md hover:shadow-lg">

// ❌ emoji 当 UI
<button>☀ Light</button>

// ❌ 过度动画
<div className="animate-bounce">
```

合规写法:

```tsx
// ✅ 颜色
<div className="bg-bg text-text">
<div className="bg-surface border border-border">

// ✅ hover 用边框
<div className="border border-border hover:border-border-strong transition-colors duration-[180ms]">

// ✅ 激活用色条 + 不用背景
<div className="relative">
  <span className="absolute left-0 w-[2px] bg-primary ..." />
</div>

// ✅ icon 用字符 + 轻量 SVG
<span className="font-mono">→</span>
<SunIcon className="w-4 h-4" />  {/* 本地 1-line SVG 组件 */}
```

---

## 6.5 Voice & Tone 速查(详见 03-visual-design.md §9.1)

| 规则 | 做 | 不做 |
|---|---|---|
| emoji / `!` | 事实陈述,句号结尾 | `搞定!` / `太棒了 🎉` |
| 代词 | `我` / `你` | `咱们` / `我们` |
| 按钮 | 动宾(`发布` / `删除员工` / `测试发送`) | `确定` / `OK` / `提交` |
| 空状态 | `还没有 X · [动作建议]` | `暂无数据` |
| 错误 | 指向修复(`可以试试改成 X`) | 指向失败(`调用失败!`) |
| Lead 欢迎语 | 首轮空对话给 3 条示例 prompt | 留空 / 单句寒暄 |

检查钩子:

- `web/tests/voice-tone.test.ts` — 静态扫 emoji / `!` / `咱们` / `我们`
- `backend/tests/unit/test_lead_welcome.py` — 断言 Lead prompt 含 Welcome + 3 条示例

Voice & Tone 变更要同步三处:[`product/03-visual-design.md §9.1`](../product/03-visual-design.md#91-voice--tone文案纪律--i-0013) · [`backend/src/allhands/execution/prompts/lead_agent.md`](../backend/src/allhands/execution/prompts/lead_agent.md) Style 节 · 本节速查表。

---

## 7. 参考

- 视觉契约(规范):[`product/03-visual-design.md`](../product/03-visual-design.md)
- 设计 lab(活样本 & 回归基准):[`web/app/design-lab/page.tsx`](../web/app/design-lab/page.tsx)
- Token 实现:[`web/app/globals.css`](../web/app/globals.css)、[`web/tailwind.config.ts`](../web/tailwind.config.ts)
- Icon 组件:[`web/components/icons/` 自有集](../web/components/icons/) + [`web/components/ui/icons.tsx` legacy](../web/components/ui/icons.tsx)
- ADR 0009 · 自有 Icon 系统决策:[`product/adr/0009-custom-icon-system.md`](../product/adr/0009-custom-icon-system.md)
