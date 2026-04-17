# 03 · Visual Design System

> 视觉基调:**简洁科技风格**。参考光谱:Linear、Cursor、Vercel、Raycast、v0。反面案例:Dify(色彩偏亮、信息密度混乱)。

---

## 1. 设计 Tokens

### 1.1 颜色(暗色为 default,浅色为副选)

```css
/* backend-rendered CSS vars, exposed via Tailwind theme extension */

/* Dark (default) */
--bg-0:  #0A0A0A;   /* page background */
--bg-1:  #111114;   /* card / panel */
--bg-2:  #1A1A1E;   /* elevated */
--bg-3:  #24242A;   /* input / hover */

--fg-0:  #FAFAFA;   /* primary text */
--fg-1:  #A1A1AA;   /* secondary text */
--fg-2:  #71717A;   /* muted */
--fg-3:  #52525B;   /* placeholder */

--border: #27272A;
--border-strong: #3F3F46;

--primary:       #3B82F6;  /* cold blue, 主操作 */
--primary-hover: #60A5FA;
--primary-fg:    #FFFFFF;

/* status */
--success: #10B981;
--warning: #F59E0B;
--danger:  #F43F5E;
--info:    #3B82F6;

/* agent 专用语义色(区分不同角色的消息气泡) */
--role-user:    #3B82F6;   /* blue */
--role-lead:    #8B5CF6;   /* violet — Lead Agent 唯一性 */
--role-worker:  #14B8A6;   /* teal — 被派遣的员工 */
--role-tool:    #F59E0B;   /* amber — tool call 结果 */
```

**使用规约:**
- 文本默认 `fg-0`,次要 `fg-1`,禁忌直接写十六进制
- 只有状态色和 primary 带 hover 变体,其余用 opacity 叠加
- **避免"彩虹 UI"**:整页色彩密度 ≤ 3 种(不含状态)

### 1.2 字体

```css
--font-sans: 'Geist', 'Inter', -apple-system, system-ui, sans-serif;
--font-mono: 'Geist Mono', 'JetBrains Mono', 'SF Mono', monospace;
```

**使用规约:**
- 普通 UI → sans
- 所有 `tool_call.args`、`tool_call.result`、`trace_id`、代码块、JSON → mono
- 对话消息内容默认 sans,除非用户写的是代码块

### 1.3 字号 / 行高(Tailwind text-* 映射)

| 用途 | 字号 | 行高 |
|---|---|---|
| 标题 H1(几乎不用) | `text-2xl` (24) | `leading-tight` |
| 卡片标题 / 员工 name | `text-base` (16) | `leading-snug` |
| 对话文本 | `text-[15px]` | `leading-relaxed` |
| 次要说明 / 时间戳 | `text-xs` (12) | `leading-normal` |
| 代码 / trace | `text-[13px]` | `leading-normal` |

### 1.4 圆角 / 间距 / Shadow

```
--radius-sm:  4px   /* badge, chip */
--radius:     8px   /* default,button/input/card */
--radius-md:  12px  /* 对话气泡 */
--radius-lg:  16px  /* modal, drawer */

--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-6: 24px
--space-8: 32px

--shadow-sm: 0 1px 2px rgba(0,0,0,.5);
--shadow:    0 4px 12px rgba(0,0,0,.6);
--shadow-lg: 0 16px 32px rgba(0,0,0,.7);
```

### 1.5 动效

```
--ease-out: cubic-bezier(.22, 1, .36, 1);
--dur-fast: 120ms;
--dur-mid:  200ms;
--dur-slow: 360ms;
```

**使用规约(克制原则):**
- 对话气泡出现:fade + translateY(-4px→0) · `dur-mid`
- Tool call 折叠展开:height transition · `dur-fast`
- Confirmation 弹窗:fade + scale(0.98→1) · `dur-mid`
- **禁用**:spinner 外的无限循环动画、rainbow glow、emoji 弹射

---

## 2. 组件库基础

使用 **Shadcn/ui**(New York style + CSS vars)+ Tailwind v4。

**初始化命令(放 README 和 harness):**

```bash
cd web
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button input textarea dialog sheet card badge separator dropdown-menu scroll-area tooltip skeleton sonner
```

**自定义组件(项目特有):**

- `ChatWindow` — 对话容器,管理消息列表 + 输入框
- `MessageBubble` — 消息气泡,按 role 着色,内含 `<MessageRenderer>`
- `MessageRenderer` — 解析消息 `content + tool_calls + render_payloads`,渲染为 markdown + tool 展开 + 内联组件
- `ToolCallCard` — tool call 折叠卡片,展示 name / args preview / status / result
- `ConfirmationDialog` — 敏感操作确认,显示 summary / rationale / diff / yes-no
- `EmployeeCard` — 员工卡片(Render Tool 的典型返回消费者)
- `EmployeeList` — 员工列表网格
- `ComponentRegistry` — 把 render payload 的 `component` 键映射到 React 组件

---

## 3. 关键界面(ASCII mockup)

### 3.1 主界面(Lead Agent 对话)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ≡  allhands · Lead Agent                              [↻] [📊] [⚙]     │ ← 顶栏
├─────────────┬────────────────────────────────────────────────────────────┤
│             │                                                            │
│  Sidebar    │   ┌─ Lead Agent ───────────────────────────────┐          │
│  (会话列表) │   │ 帮我调研 LangGraph 和 CrewAI,产出报告。   │          │ ← 用户消息
│             │   └────────────────────────────────────────────┘          │
│  + New chat │                                                            │
│             │   ┌─ Lead Agent ───────────────────────────────┐          │
│  · 调研 LG  │   │ 好的,我来组织这个任务。                   │          │
│  · 日常运营 │   │                                            │          │
│  · ...      │   │ ▼ 🔧 list_employees                  ✓    │          │ ← tool call 折叠
│             │   │ ▼ 🔧 create_employee (Researcher)    ✓    │          │
│             │   │ ▼ 🔧 create_employee (Writer)        ✓    │          │
│             │   │ ▶ 🔧 dispatch_employee (Researcher)  ⏳   │          │ ← 运行中
│             │   │                                            │          │
│             │   │ ┌────────────────────────────────────────┐ │          │
│             │   │ │  🧑 Researcher · 调研中...             │ │          │ ← 嵌套执行
│             │   │ │  ▼ 🔧 web_search("LangGraph")    ✓    │ │          │
│             │   │ │  ▼ 🔧 web_search("CrewAI")       ✓    │ │          │
│             │   │ └────────────────────────────────────────┘ │          │
│             │   │                                            │          │
│             │   │ [复制] [View in LangFuse ↗]  ~$0.12       │          │
│             │   └────────────────────────────────────────────┘          │
│             │                                                            │
│             │   ┌─────────────────────────────────────────────────────┐ │
│             │   │ Message Lead Agent...                          [↑] │ │ ← 输入框
│             │   └─────────────────────────────────────────────────────┘ │
└─────────────┴────────────────────────────────────────────────────────────┘
```

### 3.2 Confirmation 弹窗

```
┌─────────────────────────────────────────────────────┐
│  Confirm: create_employee                        ×  │
├─────────────────────────────────────────────────────┤
│  Lead Agent wants to create a new employee:         │
│                                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │ Name:        Researcher                        │ │
│  │ Description: 调研技术对比                      │ │
│  │ Skills:      web_research                      │ │
│  │ Tools:       3 (from web_research)             │ │
│  │ Model:       gpt-4o-mini                       │ │
│  │ Max iter:    10                                │ │
│  │                                                │ │
│  │ System prompt:                                 │ │
│  │ ┌─────────────────────────────────────────────┐│ │
│  │ │ 你是一个严谨的技术调研员,擅长通过搜索汇总  ││ │
│  │ │ 对比多个技术方案的优劣...                  ││ │
│  │ └─────────────────────────────────────────────┘│ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  Rationale:                                         │
│  用户要调研 LG 和 CrewAI,需要一个负责搜索的员工。 │
│                                                     │
│  [Reject]                              [Approve]    │
└─────────────────────────────────────────────────────┘
```

### 3.3 消息气泡 Role 着色

```
[ U ]  用户消息     → border-l-primary (蓝)
[ L ]  Lead Agent  → border-l-role-lead (紫)
[ W ]  Worker 员工 → border-l-role-worker (青)
[ T ]  Tool result → border-l-role-tool (琥珀)
```

### 3.4 Render Tool 返回的内联组件

当 render tool 返回 `{component: "EmployeeList", props: {employees: [...]}}`,聊天消息里内联渲染:

```
┌─ Lead Agent ──────────────────────────────────────┐
│ 当前员工列表:                                     │
│                                                   │
│  ┌─ Researcher ────────┐  ┌─ Writer ────────────┐│
│  │ 🧑 调研技术对比     │  │ 🧑 Markdown 写手    ││
│  │ web_research + 3 t  │  │ 0 tools             ││
│  │ [Chat] [Details]    │  │ [Chat] [Details]    ││
│  └─────────────────────┘  └─────────────────────┘│
│                                                   │
│  有 2 位员工。需要再建一个吗?                    │
└───────────────────────────────────────────────────┘
```

---

## 4. 布局

### 4.1 默认桌面布局(≥ 1024px)

```
┌────────────────────────────────────────────────────┐
│ 顶栏 56px                                          │
├──────────┬─────────────────────────────────────────┤
│ Sidebar  │                                         │
│ 260px    │  Chat area (flex)                       │
│          │                                         │
│          │                                         │
│          │                                         │
├──────────┴─────────────────────────────────────────┤
│ 输入框 固定底部,max-w-4xl 居中                    │
└────────────────────────────────────────────────────┘
```

### 4.2 移动(< 768px)

- Sidebar 变成 drawer,汉堡按钮呼出
- 输入框固定底部,消息区满屏

### 4.3 Chat area 内部

- `max-width: 48rem`(768px),居中,避免消息单行过长
- Tool call / Render 组件可突破这个限制到 `max-width: 56rem`(便于展示表格)

---

## 5. Component Registry(前端扩展点)

**约定:**

```tsx
// web/lib/component-registry.ts
export const componentRegistry = {
  EmployeeList: EmployeeListComponent,
  EmployeeCard: EmployeeCardComponent,
  Markdown: MarkdownComponent,
  CodeDiff: CodeDiffComponent,
  // ... 开放式扩展
} as const;

export type RegisteredComponent = keyof typeof componentRegistry;
```

**MessageRenderer 消费:**

```tsx
function MessageRenderer({ message }) {
  return (
    <>
      <Markdown>{message.content}</Markdown>
      {message.tool_calls.map(tc => <ToolCallCard key={tc.id} {...tc} />)}
      {message.render_payloads.map((rp, i) => {
        const Component = componentRegistry[rp.component];
        if (!Component) return <UnknownComponent key={i} {...rp} />;
        return <Component key={i} {...rp.props} />;
      })}
    </>
  );
}
```

**新增 UI 类型的流程(不改核心代码):**

1. 后端实现 render tool,返回 `{component: "MyWidget", props: {...}}`
2. 前端实现 `MyWidgetComponent`
3. 前端 `component-registry.ts` 里加 `MyWidget: MyWidgetComponent` 一行

---

## 6. 可访问性

- 所有 interactive 元素有 keyboard focus ring(`focus-visible:ring-2 ring-primary`)
- Confirmation 弹窗默认 focus 在"Reject"(避免误确认)
- 对话消息 role 信息通过 `aria-label` 提供给屏幕阅读器,不仅靠颜色
- 暗色主题对比度满足 WCAG AA(fg-0 对 bg-0 ≥ 13:1)

---

## 7. 不做(v0)

- ❌ 独立的员工管理页面(通过 Lead Agent render tool 展示)
- ❌ Drag-and-drop 工作流编辑器(违反 Tool First)
- ❌ 复杂图表 / 多视图驾驶舱(v1)
- ❌ 全屏命令面板 / Raycast 模式(v2,可作为体验升级)
- ❌ 主题切换器(暗色先固定,浅色 v1 再加)
