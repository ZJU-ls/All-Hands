# 员工独立对话 + 渲染管道复用 Spec

**日期** 2026-04-18
**状态** Draft
**父 spec** [2026-04-18-agent-design.md](./2026-04-18-agent-design.md)
**并列 spec** [2026-04-18-viz-skill.md](./2026-04-18-viz-skill.md) · [2026-04-18-artifacts-skill.md](./2026-04-18-artifacts-skill.md)
**动手前必读** [`docs/claude/reference-sources.md`](../../claude/reference-sources.md) · 按本 spec § 10.5 对照 `ref-src-claude`(Claude Code 的 REPL / 消息流 / Task 嵌套 / Tool 渲染)

---

## 0 · TL;DR

- 和 Lead Agent 对话,和任一员工对话:**同一套 UI 管道、同一套 MessageList / ToolCallCard / RenderRegistry,只是 `conversation.employee_id` 不同**
- 后端零改动(L7.1 `POST /api/conversations` 已收 `employee_id`)
- 前端把当前 Lead-中心的 chat 路由重构成 employee-中立的通用容器

---

## 1 · 问题陈述

今天前端的 `web/app/chat/[conversationId]/page.tsx` 把 Lead Agent 当默认且隐式假设,没有"与某员工直聊"的入口。但:

- 用户可能想 **直接找 writer** 改一段文案,不想让 Lead 转手(快,也更明确)
- 员工的调试 / 训练调优 需要直接对话通道
- Lead 做 `dispatch_employee` 时,内部 sub-run 也是一次员工对话 —— 如果 UI 管道不统一,会在两个地方重复写

**目标**:无论是谁主导对话(Lead / 任意员工 / sub-run),**同一组** UI 组件就能渲染完整。

---

## 2 · 原则

### 2.1 Employee Is Not Special

**对话"主体"只是一个 employee_id**。Lead Agent(`is_lead_agent=True`)只是 employee_id 为 lead 的那条;其他员工一视同仁。

### 2.2 单渲染管道

任何消息流,无论来自哪个员工,走完全一致的渲染路径:

```
SSE stream → useChatStream (hook)
           → Message[]
           → <MessageList>
                ├─ <UserMessage>
                ├─ <AssistantMessage>    ← 渲染 text + tool_calls + render_payloads
                │    ├─ <ToolCallCard>  ← 每个 tool 调用的展现
                │    └─ <RenderRegistry> ← 查表 component-registry 渲染
                └─ <NestedRunBlock>       ← dispatch 产生的嵌套子对话块
```

**不允许** Lead 专用 component 或员工专用 component(除 Header 展示性差异外)。

### 2.3 Nested Run = Same Pipeline, Indented Block

Lead Agent `dispatch_employee` 产生的 sub-run,用同一个 `<MessageList>` 递归渲染,只是外层包一个 `<NestedRunBlock>` 带缩进 + 子员工头像 + 折叠。

---

## 3 · URL / 路由设计

| URL | 含义 | 行为 |
|---|---|---|
| `/` | 首页 | 跳 Lead Agent 最近一次对话;无则创建新的 |
| `/chat/{conversationId}` | 任一对话 | 展示该会话,读 `conversation.employee_id` 决定 Header 显示哪个员工 |
| `/employees/{employeeId}` | 员工主页 | 展示员工详情 + 与该员工的对话列表 + "新对话"按钮 |
| `/employees/{employeeId}/new` | 新对话入口 | `POST /api/conversations {employee_id}` → redirect `/chat/{newId}` |
| `/conversations` | 全部对话 | 按员工分组的列表 |

**注意**:**不要**建 `/employees/{id}/chat/...` 这种 nested 路由。对话对象是 `conversation`,不是 `employee`。员工主页只是进入点,实际对话落在统一的 `/chat/{conversationId}`。

---

## 4 · 前端结构

### 4.1 Page 层(App Router)

```
web/app/
├── page.tsx                             ← 跳转到默认/最近的 conversation
├── chat/[conversationId]/page.tsx       ← 已存在 · 改造:employee-agnostic
├── employees/
│   ├── page.tsx                         ← 执行端在建 · 员工列表
│   └── [employeeId]/
│       ├── page.tsx                     ← 员工主页(含对话列表 + 详情)
│       └── new/route.ts                 ← POST 创建对话,302 到 /chat/{id}
└── conversations/
    └── page.tsx                         ← 执行端在建 · 全部对话(按员工分组)
```

### 4.2 组件层(L10 展示)

```
web/components/chat/
├── ChatShell.tsx                ← 3 面板布局:sidebar / message / artifacts
├── ConversationHeader.tsx       ← 显示 employee 名/头像/profile badge
├── MessageList.tsx              ← 循环渲染 messages
├── UserMessage.tsx
├── AssistantMessage.tsx         ← 包含 text/tool_calls/render_payloads
├── ToolCallCard.tsx             ← 执行端在改 · 通用 tool 调用卡
├── NestedRunBlock.tsx           ← 新 · 嵌套 sub-run 的包装(dispatch 产出)
└── ConfirmationBanner.tsx       ← 现有 · 确认条
```

### 4.3 Registry(可插拔渲染)

```ts
// web/lib/component-registry.ts(已有,本 spec 只是扩展)
export const componentRegistry: Record<string, FC<any>> = {
  // 现有
  Markdown: Markdown,
  EmployeeList: EmployeeList,
  EmployeeCard: EmployeeCard,
  ConfirmationSummary: ConfirmationSummary,
  TraceLink: TraceLink,

  // viz-skill 扩展(见 viz-skill spec)
  "Viz.Table": VizTable,
  "Viz.KV": VizKV,
  // ... 其它

  // artifacts-skill 扩展
  "Artifact.Preview": ArtifactPreview,
  "Artifact.List": ArtifactList,
}
```

---

## 5 · 后端契约(几乎零改动)

### 5.1 L7.1 已支持(复核)

- `POST /api/conversations` 参数包含 `employee_id`(默认 Lead Agent)
- `GET /api/conversations` 支持 filter `?employee_id=...`
- `GET /api/conversations/{id}` 返回 `employee_id + messages[]`

**若执行端尚未实现 filter 参数,autopilot 要补上。**

### 5.2 SSE 输出不区分员工

`ChatService.send_message` 产生的 SSE 流格式**严格与现有一致**。员工身份信息放在 conversation 级别(header 取),不要塞进 every SSE event。

### 5.3 嵌套执行的 SSE

已在 L8.1 定义 `nested_run_start` / `nested_run_end`。前端用这俩包装 `<NestedRunBlock>`,sub-run 的 message event 用 `parent_run_id` 区分嵌套层级。

---

## 6 · Lead Agent 对话 = 员工对话的超集

两处差异(仅此,不要再更多):

| 维度 | 普通员工对话 | Lead Agent 对话 |
|---|---|---|
| Header 徽章 | 员工名 + profile badges(如"会做计划") | Lead · 带 "全能" 徽章 |
| System prompt | 员工自己的 | [lead_agent.md](../../../backend/src/allhands/execution/prompts/lead_agent.md) |
| dispatch_employee 工具 | 没有(除非显式挂) | 自动注入 |

**所有其他体验(消息流 / tool 调用 / render / confirmation / artifacts)完全一致。**

---

## 7 · 交付清单

### 新增 / 修改文件

| 文件 | 操作 | 与执行端关系 |
|---|---|---|
| `web/app/chat/[conversationId]/page.tsx` | patch · 读 conversation.employee_id 驱动 Header | **执行端在改** — 先 pull |
| `web/app/employees/[employeeId]/page.tsx` | 新(或 patch 执行端的版本) | **执行端在建** — 先 pull |
| `web/app/employees/[employeeId]/new/route.ts` | 新 · 创建对话入口 | 无重叠 |
| `web/app/conversations/page.tsx` | 新(或 patch 执行端的版本) | **执行端在建** — 先 pull |
| `web/components/chat/ChatShell.tsx` | 新 · 3 面板布局 | 无重叠 |
| `web/components/chat/ConversationHeader.tsx` | 新 | 无重叠 |
| `web/components/chat/NestedRunBlock.tsx` | 新 | 无重叠 |
| `web/lib/use-chat-stream.ts` | patch · 确保处理 nested_run_* events | 可能重叠,先看 |
| `backend/src/allhands/api/routers/chat.py` | patch · 如果 conversations filter 没实现,补 | **执行端在改** — 先 pull |

---

## 8 · Scope

### In(v0)
- [x] 路由重构:conversation 级 URL
- [x] Header 展示员工身份
- [x] 员工主页(简单:详情 + 对话列表 + 新对话按钮)
- [x] 按员工分组的 conversation 列表
- [x] 3 面板布局容器(但 artifacts 面板的内容交给 artifacts spec)
- [x] NestedRunBlock 嵌套显示

### Out(v1+)
- ~~对话搜索 / 高级筛选~~
- ~~对话分享链接~~
- ~~多个用户 / 权限~~
- ~~员工 @mention 直接指派~~(v0 通过 dispatch 间接)
- ~~消息编辑 / 重发~~

---

## 9 · 测试清单

| 测试 | 内容 |
|---|---|
| `web/tests/unit/chat-routing.test.ts` | conversationId URL 驱动渲染正确 |
| `web/tests/unit/conversation-header.test.tsx` | 根据 employee_id 显示正确 header |
| `web/tests/e2e/employee-chat.spec.ts` | 走一遍:从 `/employees/writer` → 新对话 → 发消息 → 收回复 |
| `web/tests/e2e/nested-run-display.spec.ts` | Lead dispatch 场景:UI 能展开子 run,样式正确 |
| `backend/tests/integration/test_conversations_filter.py` | `GET /api/conversations?employee_id=...` 过滤正确 |

---

## 10 · DoD

- [ ] 3 个 URL(`/chat/{id}` / `/employees/{id}` / `/conversations`)都能用
- [ ] Lead Agent 对话和员工对话视觉上只有 Header 不同,其他组件复用
- [ ] dispatch_employee 产生的 sub-run 有嵌套折叠显示
- [ ] 所有测试绿
- [ ] 视觉验收:符合 `product/03-visual-design.md` + `product/06-ux-principles.md` P01-P10
- [ ] 手测:新建对话 → 发消息 → 看到 header/员工名 → 收回复

---

## 10.5 · 参考源码(动手前必读)

> 规则见 [`docs/claude/reference-sources.md`](../../claude/reference-sources.md)。**Claude Code 的 REPL / 消息流 / Task 嵌套展示是本 spec 的主要参考。** UI 层只抽"状态机 + 事件模型",不抄渲染(Ink 是终端,我们是浏览器)。

| 本 spec 涉及 | 对标 ref-src-claude 入口 | 抽什么 |
|---|---|---|
| **§ 2.2 单渲染管道 · SSE → Message[] → MessageList** | `ref-src-claude/volumes/V01-repl-and-state.md`(REPL + Ink 状态流末段) | 事件流如何被状态机消化成一个统一的"消息列表"。**尤其看:如何把 tool_call_start / tool_call_end / render / text token 多种事件归并成消息视图** |
| **§ 2.3 NestedRunBlock · sub-run 递归渲染** | Claude Code 的 **Task 工具** 嵌套展示(V04 · Task 子章) | Task 的子对话块在终端里是缩进展开的;我们做成可折叠卡。**抽:如何标识 parent-child、如何默认折叠、如何展示子 run 状态** |
| **§ 4.3 component-registry · 可插拔渲染** | Claude Code 的 tool call rendering(V04) | Tool call 的三态渲染(pending / running / done)对应到我们的 `<ToolCallCard>`。**抽:默认折叠 vs 关键路径展开的启发式** |
| **§ 5.3 SSE nested_run_start / _end 包装** | `ref-src-claude/src/query.ts` AsyncGenerator(V02) | 事件冒泡的模式。我们 SSE 的 `nested_run_*` 语义要和 Claude Code 的子 run 边界事件对齐 |

---

## 11 · 和执行端 Claude 的协同

执行端正在建 `web/app/employees/` 和 `web/app/conversations/`。本 spec 提供了目标路由结构 + 组件划分。**autopilot 开工前**:

1. `git status` 看这两个目录的最新文件清单
2. 读执行端最近的 commits 看它走什么方向
3. 如果执行端已经搭好基础(router / 列表 / detail),本 spec 只做**差异化补全**:Header / NestedRunBlock / 3 面板 ChatShell
4. 避免推翻重写。发现方向冲突 → 在 spec 里追加 **"Decision-log"** 说明协调方式
