# 视觉升级 Spec · Linear Precise v2 · 简洁 + 温度 + 一致

**日期** 2026-04-18
**状态** Draft
**父 spec** [2026-04-18-agent-design.md](./2026-04-18-agent-design.md)
**并列** [animation-upgrade](./2026-04-18-animation-upgrade.md) · [self-review](./2026-04-18-self-review.md) · [viz-skill](./2026-04-18-viz-skill.md)
**动手前必读** [`product/03-visual-design.md`](../../../product/03-visual-design.md) · [`product/06-ux-principles.md`](../../../product/06-ux-principles.md) · [`design-system/MASTER.md`](../../../design-system/MASTER.md) · CLAUDE.md § 3.5 三条最高纪律

---

## 0 · TL;DR

- 在 **CLAUDE.md § 3.5 三条纪律完整保留** 的前提下,升级 Linear Precise 到 **v2** —— 简洁仍是第一 · 但更"温暖 / 友好 / 连贯"
- 三个升级轴:**人格化空态 / 错态 / loading** · **统一使用指引(onboarding + tooltip + empty-CTA)** · **跨页一致性硬约束**
- 所有升级**不引入** icon 库 · 不破色阶 ≤ 3 · 不用 scale/shadow hover · 不装 Framer/GSAP
- 交付:新 token(排版 + 呼吸节奏)· 3 组统一状态组件 · Onboarding / Coach-mark 系统 · Consistency 回归脚本

---

## 1 · 问题陈述

当前 `design-system/MASTER.md` 已经把视觉骨架落得稳 · 但我作为"第一次来的用户",会感到:

- **空态太冷**:`No data.` `暂无` —— 对 · 但无 call-to-action · 让人手足无措
- **错误太机械**:`500 Internal Server Error` 直接糊脸 · 不知道我做错了什么或要去哪
- **Loading 无表情**:一个 spinner 跑半天 · 不知道卡在哪
- **新手无引导**:十几个 tab · 没人告诉我从哪开始 · 第一次体验像被扔进后台
- **跨页不一致**:`/tasks` 用圆角 `rounded-md`,`/triggers` 用 `rounded` · 同站点两种风 · 用户看不出但**感**到

本 spec 不碰纪律 · 只加"温度" —— 让简洁的东西也能被喜欢。

---

## 2 · 原则

### 2.1 简洁仍然第一 · 温度是第二

顺序不能反。先保证能看清(§ 3.5)· 再用**文字 / 留白 / 节奏**给温度 —— 不是用颜色 / 图标 / 动画。

### 2.2 温度来自三处 · 不来自装饰

- **文字人格**:从"No data." → "✦ 还没制品 · 让员工做点什么 · Lead 正等着听你 →"
- **留白节奏**:`padding` 阶梯让视线喘气 · 按"呼吸/停顿/呼吸"排布内容块
- **时机引导**:对的时候说对的话(首次空 workspace · 首次失败 · 首次成功)

### 2.3 一致性是纪律

跨页必须用同一个 empty / error / loading 组件 · 不允许各页各写。

---

## 3 · Token 扩展(design-system)

### 3.1 排版层级 · 更清晰

```css
/* globals.css 新增 */
--type-display: 32px;        /* 页 hero · 欢迎页 · onboarding */
--type-title:   20px;        /* 页标题 */
--type-heading: 15px;        /* 区块标题 */
--type-body:    13px;        /* 正文 · 当前值 */
--type-caption: 11px;        /* 辅助 · label · fg-muted 配 */
--type-mono:    12px;        /* 代码 / cmd / kbd */

/* 行高 */
--lh-tight:  1.25;
--lh-normal: 1.5;
--lh-relax:  1.7;            /* 长文 / 空态说明 */
```

### 3.2 呼吸节奏 · 间距系统

```css
--space-hairline: 2px;       /* border 宽 */
--space-1:  4px;             /* chip 间 */
--space-2:  8px;             /* 紧靠 */
--space-3:  12px;            /* 常用 · 卡片内部 */
--space-4:  16px;            /* 卡片外 */
--space-5:  24px;            /* 区块间 */
--space-6:  40px;            /* 页顶 / hero */
--space-7:  64px;            /* 大空态 · 欢迎页 */
```

### 3.3 状态语义色(保留 + 小修)

沿用已有 `accent` / `#d97706`(warn) / `#dc2626`(error) · 新增:
```css
--success: var(--fg);        /* 不引入绿 · 用文字符号 ✓ 配 fg · 保持色阶 ≤ 3 */
```

### 3.4 tailwind.config.ts 同步加入

按 03-visual-design.md 约定更新 · DoD 里 reviewer 必须对齐。

---

## 4 · 统一状态组件(强制复用)

新建 `web/components/state/`:

### 4.1 `<EmptyState>`

```tsx
<EmptyState
  headline="✦ 还没制品"
  body="让员工做点什么 · Lead 正等着听你"
  primaryAction={{ label: "+ 发起任务", href: "/tasks/new" }}
  secondaryAction={{ label: "和 Lead 聊聊 →", href: "/chat" }}
  tone="neutral"        // neutral | warm | hint
/>
```

行为:
- `tone=warm`:字体用 display 字号 · 留白 `--space-7` · 两个 CTA
- `tone=neutral`:`--space-5` · 单 CTA
- `tone=hint`:inline 小提示 · `--space-3` · 无 CTA · 用于中小卡片内
- **禁**自己加图 / 插画 · 如有 logo · 只能是设计系统已有的**点阵 logo**

### 4.2 `<ErrorState>`

```tsx
<ErrorState
  headline="抱歉,我这头出问题了"
  body={{
    primary: "可以稍等几秒再试,也可以看看下面的细节帮我们排查。",
    detail: error.message,
    ref: error.traceId,      // 点击复制,发给 issue
  }}
  actions={[
    { label: "重试", onClick: retry },
    { label: "复制错误 ref", onClick: copy },
  ]}
/>
```

**文案硬约束**(在 MASTER.md 落一条):
- `headline` 从用户视角写 · 不暴露 stack / http status
- `body.detail` 技术细节 · 默认折叠("细节"展开)
- 必带 `ref`(trace_id / error_id)· 能给 bug report 用

### 4.3 `<LoadingState>`

```tsx
<LoadingState variant="skeleton" estimate={seconds} />
```

- `variant=skeleton` · 骨架占位(见 § 5.3)
- `variant=progress` · 有 `estimate` 时展示进度条 · 否则 indeterminate
- 超过 `estimate × 1.5` 时自动切"还在努力 · 你可以先做别的"文案
- **禁** spinner 单独存在 · 必配 skeleton 或文案

### 4.4 组件使用强制

`tests/unit/consistency/test_state_components_used.ts`:grep `Loading\.\.\.` `No data` `暂无` `Error` 直出文本 —— 触发即 fail。必须走 `<EmptyState>` / `<ErrorState>` / `<LoadingState>`。

---

## 5 · 使用指引系统

### 5.1 首次引导 · `<FirstRun>`

workspace 开局判定:`employees.count == 0 && tasks.count == 0 && triggers.count == 0` → 首次。

`/` 主区替换成 `<FirstRun>`:
- Display 大标题:`欢迎来到 allhands`
- Body:`这里是你的 AI Team 的驾驶舱。先给自己开个头?`
- 3 卡片 CTA(横排):
  1. `和 Lead 聊聊 →` · 开 `/chat` · Lead 首次出欢迎 message(见 § 5.2)
  2. `造一个员工 →` · 打开 Lead chat 预填 "帮我造一个 coder 员工"
  3. `看看示例触发器 →` · 打开 `/triggers` 并预 seed 3 个 disabled 示例

用户从任一路径完成一次动作 · `<FirstRun>` 永久消失 · 回归正常 cockpit。

### 5.2 Lead 首次对话 · 欢迎 message

```
你好 · 我是 allhands 的 Lead · 你的 AI 团队头儿。

我现在能帮你做的:
  • 造 / 改 / 派员工(研究员 / 作者 / 工程师 / ...)
  • 派任务 · 你不用盯着 · 我会在完成时告诉你
  • 管触发器(每天跑 / 事件触发)

没用过?试试对我说:
  "帮我造一个能查 GitHub 的研究员"
  "每天早上整理昨天的 PR 动态给我"
```

仅首次登录 workspace 时出 · 之后消失(但存在 chat 历史可查)。

### 5.3 Coach-mark · `<Coachmark>`

- 每个页面可注册 `coachmarks: Coachmark[]`(最多 3 条)
- 首次访问该页 · 按注册序一条条出(点击"懂了"下一条)
- 存 `localStorage.coachmarksSeen[page]` · 不重复
- 视觉:小尖角 tooltip · fg-subtle 背景 · 文字人格化("点这里展开 · 我会记住你的选择")

例:
- `/triggers` 首次 → mark 1 贴"新触发器"按钮:`从这里开始 · 你可以让 AI 自己定期干活`
- `/chat` 首次 → mark 1 贴输入框:`试试让我给员工派个活 · 我懂"安排"、"整理"、"跟进"`

### 5.4 Inline Tooltip · `<Tooltip>`

保留现有实现 · 只统一文案风:
- ≤ 8 字的提示(`复制` / `重跑`)不上 tooltip(button 文字已够)
- tooltip 一律句号收尾不加 · mono 字段单独用 `<Kbd>`

---

## 6 · 一致性硬约束

### 6.1 Lint 规则(加到 `eslint.config.js`)

- 禁 `className="rounded"` · 必须 `rounded-md` 或 token
- 禁 hardcoded `text-sm` / `text-xs` · 必须 `text-[var(--type-*)]` 或 token class
- 禁 `shadow`(保留例外:drawer / modal 顶层)
- 禁在 JSX 直出的中英文裸串 "Loading..." "Error" "No data" "暂无"

### 6.2 Playwright 视觉回归 · `tests/e2e/visual/consistency.spec.ts`

每页 snapshot · fail 时 diff 报告 · 上 CI。snapshot 变动要显式批准(`pnpm test:e2e -u`)。

### 6.3 `design-lab` 扩展

`web/app/design-lab/page.tsx` 加:
- "状态组件 live demo" · Empty / Error / Loading 各 3 种 tone 并列
- Coach-mark demo
- 文字人格字典(headline / body / CTA 样本)

成为 **单一事实来源**。其他页复制 design-lab 的样本。

---

## 7 · 文案人格字典(新增文档)

`product/03-visual-design.md` 新增 § Voice & Tone:

| 场景 | 糟 | 好 |
|---|---|---|
| 空状态 | `No data.` | `✦ 还没制品 · 让员工做点什么 · Lead 正等着听你 →` |
| 500 | `Internal Server Error` | `抱歉 · 我这头出问题了 · 稍等几秒再试 · 详情 ↓ · ref: abc123` |
| 成功 | `Saved successfully` | `好了` / `已派出 T-abc · Lead 会看着` |
| 加载 | `Loading...` | `整理中 · 大约 3 秒` |
| 未完 | `Pending` | `在做 · 3/8 步` |
| 需要用户 | `User input required` | `我卡在这一步 · 能说说你的想法吗?` |
| 允许 | `Allow?` | `可以吗?(这会修改 X)` |
| 确认 | `Confirm` | `好` / `确定这么干` |
| 取消 | `Cancel` | `不了` / `再想想` |

**规则**:
- 多用"我 / 你" · 少用"系统 / 用户"
- 避叹号 · 避大写 · 避 emoji 大量(可点缀 · 每页 ≤ 3 处)
- 中英文**不要混**:一句之内只一种语言;跨句可混
- 不用口号("更快 · 更好 · 更强")

---

## 8 · 与已有 / 并列 spec 的关系

| 已有 / 并列 | 关系 | 协调 |
|---|---|---|
| `03-visual-design.md` | **本 spec 是 v2 补丁** · 完成后要把升级项回写该文档 | 本 spec 交付同时更新 03-visual-design + MASTER + design-lab |
| CLAUDE.md § 3.5 | **保留不改**,纪律不动 | 若有冲突一律 § 3.5 胜出 |
| [animation-upgrade](./2026-04-18-animation-upgrade.md) | 动画属于姊妹 spec · 本 spec 不管 motion | 状态组件进/出走 animation spec 定义的 motion token |
| [viz-skill](./2026-04-18-viz-skill.md) | viz 组件要消费本 spec 的 token + 状态组件 | 按本 spec 统一重排版 |
| [cockpit](./2026-04-18-cockpit.md) § 6 | KPI / 活动流 / 健康面板都要用新 token 重排 | cockpit 落地时**同时**用本 spec 约定 |
| [tasks](./2026-04-18-tasks.md) § 7 | drawer / 详情页用新 token | - |

---

## 9 · In-scope / Out-of-scope

### In-scope(v0)

- [ ] 新增 typography + spacing token · 落到 `globals.css` + `tailwind.config.ts`
- [ ] `<EmptyState>` / `<ErrorState>` / `<LoadingState>` · 3 变体各自齐
- [ ] `<FirstRun>` 首次引导 · cockpit 空状态替换
- [ ] `<Coachmark>` 系统 · 注册表 · localStorage 追踪
- [ ] Lead 首次欢迎 message · employee_service 或 Lead prompt 触发
- [ ] `design-lab` live-demo 所有新组件
- [ ] ESLint 规则 + consistency spec
- [ ] 回写 03-visual-design.md + MASTER.md + 加 Voice & Tone 章节
- [ ] 全部现有页面**扫一遍**把散写的 Loading / Error / No data 换成统一组件

### Out-of-scope(v1+)

- 插画 / 吉祥物(刻意不加)
- 深色 / 浅色 切换按钮(v0 单 dark · v1 视情)
- 多语言 i18n(v0 中文为主)
- Mobile 响应

---

## 9.5 · 参考源码(动手前必读)

| 本节 | 外部参考 / ref-src-claude | 抽什么 · 适配方向 |
|---|---|---|
| **§ 4 状态组件文案 / ref** | Claude Code 的 error-handling / trace-id 输出(V04 末段 errors) | 错误信息带 ref 让用户能把具体问题抛给开发者。抽 ref 生成 + 复制交互 |
| **§ 5.1 FirstRun 欢迎页** | Claude Code 首次启动交互(V01 REPL) · 欢迎文本 + 示例提示 | 首次启动给**具体可点的 example**,不是空文本。3 卡片 CTA 照此 |
| **§ 5.2 Lead 欢迎 message** | Claude Code 的 system prompt 欢迎段(V02) | 欢迎 ≠ 自我介绍冗长 · 欢迎 = 告诉用户"能说什么"。3-6 条例子 + 邀请 |
| **§ 7 文案人格(Voice & Tone)** | Claude Code / Anthropic 官方文案(`claude.ai` 回复风格) | Anthropic 文案克制 · 善用 "maybe" / "let me" 等协作语气 · 抽语气 · 不抄逐字 |
| **§ 6.3 design-lab 单一事实源** | Claude Code 的 `/help` · 示例 catalog(V01 REPL help) | 单入口 demo + 可复制样板 · 消除"这该怎么写"的迷路感 |

---

## 10 · 测试

- unit · `<EmptyState>` / `<ErrorState>` / `<LoadingState>` 各 variant 渲染快照
- unit · coachmarks localStorage 行为
- consistency lint · ESLint 新规则触发故意违反 → 报错
- e2e · 清空 workspace → 看到 `<FirstRun>` + 3 卡 · 点其一 → Lead 欢迎 + 提示 example
- e2e · 故意制造一个 500 → 看到 `<ErrorState>` 文案符合字典 · ref 可复制
- visual regression · `tests/e2e/visual/consistency.spec.ts` 每页 snapshot

---

## 11 · DoD checklist

- [ ] `pnpm build` 无警告
- [ ] 所有现有页面没有裸 "Loading" / "Error" / "No data"(grep 0)
- [ ] `/`(cockpit 空)进入首次用户路径顺畅 · < 3 次点击能到第一个"真的干活"节点
- [ ] `design-lab` 列出所有新组件 · 新同事复制即用
- [ ] 03-visual-design.md + MASTER.md + Voice&Tone 全部更新
- [ ] `./scripts/check.sh` 全绿 + visual snapshot baseline 通过
- [ ] 自审:执行端跑一遍 self-review Round 1 检查新组件是否破纪律

---

## 12 · 交给 autopilot 前的最后一步

- **优先序**:token 落地 → 状态组件 → design-lab demo → 全站替换 → 引导系统 → 回写文档。**不反序**。
- **克制**:温度不等于浮夸。新增的任何东西如果自己读起来"有点肉麻" / "像营销" · 砍掉一半再看。
- **跨页审视**:全站替换完后,**随机点 10 个页**,记"有没有哪一页看起来像另一个产品" —— 有就回去对齐。

---

## Decision-log

- **2026-04-18 创建**:Linear Precise v2 · 不动纪律 · 温度来自文字 + 留白 + 引导 · 建立强制复用的状态组件
