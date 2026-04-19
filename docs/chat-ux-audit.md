# Chat UX Audit · Track D(I-0015 + I-0016)

> 扫描日期:2026-04-19 · 范围:`web/` 全部 App Router 页面 + 含 agent/LLM 文本输出的组件。
> 判定依据:`docs/issues/open/I-0015-*.md`(Composer 布局) + `docs/issues/open/I-0016-*.md`(流式输出普及)。

## 1. 消费点总表

| # | 位置 | 输入 | 流式消费 | Stop 按钮 | 深度思考 toggle | 光标/打字机 | 后端端点 | 需迁移? |
|---|---|---|---|---|---|---|---|---|
| 1 | `web/app/chat/[conversationId]/page.tsx` · 主对话 | `InputBar` textarea | ✅ `api.ts::sendMessage` · `getReader()` 手工 SSE | ❌ 无 abort UI(store 有 `abortRef` 但不可点) | ❌ 无 | ⚠️ `MessageBubble` 只在 content 为空时画光标 · 流式中段落不显示 ▍ | `POST /api/conversations/{id}/messages` | **是** — 换 Composer + 新 MessageBubble |
| 2 | `web/components/gateway/ModelTestDialog.tsx`(被 `/gateway/page.tsx` 调起) | 独立 textarea | ✅ 自带 `fetch + getReader + parseSseFrame` | ✅ 但**独立按钮**(违反 I-0015) | ⚠️ 有 `enable_thinking` checkbox 但被折叠进「高级参数」(违反 I-0015 "下沿 ControlBar") | ✅ answering phase 画 pulse | `POST /api/models/{id}/test/stream` | **是** — 换 Composer + stream-client |
| 3 | `web/app/tasks/[id]/page.tsx` · `NeedsInputPanel` / `NeedsApprovalPanel` | textarea / 按钮 | ❌ 非流式(一次性 JSON) | N/A(非 LLM 输出) | N/A | N/A | `POST /api/tasks/{id}/answer` / `/approve` | **否** — 不是 agent 输出 · 只是表单应答 |

## 2. 非消费点(只是 CRUD · 不算)

| 位置 | 原因 |
|---|---|
| `web/app/gateway/page.tsx` / `models/page.tsx` / `providers/page.tsx` | 列表 / 表单 · agent 交互走 `ModelTestDialog` 弹窗 |
| `web/app/skills/page.tsx`(含 PreviewModal) | Skill market 预览只读 + 安装表单 · 无 agent 输出 |
| `web/app/triggers/page.tsx` / `triggers/[id]/page.tsx` | CRUD + 手动 fire · fire 不返回 agent 文本 |
| `web/app/mcp-servers/page.tsx` | CRUD |
| `web/app/channels/*` | CRUD |
| `web/app/market/*` | CRUD · 无 agent 交互 |
| `web/app/employees/page.tsx` / `[employeeId]/page.tsx` | 员工列表 + 对话列表 · 点进去才进 `/chat/[id]`(= 消费点 #1) |
| `web/app/stock-assistant/setup/page.tsx` | 配置向导 · 只 `fetch` JSON · 无 agent 会话(setup 完成后跳去现有消费点) |
| `web/app/design-lab/page.tsx` | 视觉样本展示 · 非功能页 |
| `web/app/conversations/page.tsx` / `review/page.tsx` / `traces/page.tsx` / `confirmations/page.tsx` / `settings/page.tsx` / `about/page.tsx` | 列表 / 设置 · 无输入 |

## 3. 现状硬伤

- **I-0015 反例 · 主对话**:`InputBar` 下沿没有 ControlBar · 没有 thinking toggle · send 按钮不会切 stop(store 里 `stopStreaming()` 只清状态 · AbortController 绑在组件里没暴露到 UI)。
- **I-0015 反例 · 模型测试**:stop 是一个独立按钮("中止")贴在 send 右边 · 不符合 "send ↔ stop 同按钮" 原则;thinking 被隐藏到"▸ 高级参数"里(违反 "下沿 ControlBar 可见")。
- **I-0016 反例 · 主对话**:`MessageBubble.tsx:25-27` 只在 `!message.content` 时画光标 · 流式期间有内容时光标被藏;用的是 `bg-text-muted animate-pulse`(用了 Tailwind 原色类 `animate-pulse` 倒是 CSS keyframe · OK · 但颜色用 token 后要换成 `ah-caret`)。
- **backend**:`chat.py::send_message` 没有 `request.is_disconnected()` 检测 · 前端 `abort()` 后后端 agent task 仍会跑完(`chat_svc.send_message` 吐的 stream 无法 cancel 上游)。

## 4. 迁移计划(对齐 START-HERE.md 任务 1→6)

1. `web/lib/stream-client.ts` 新建 · 统一封装 `fetch + getReader + parseSseFrame + AbortController`(替换 `api.ts::sendMessage` 内部的手写逻辑 + ModelTestDialog 的重复代码)。
2. `web/components/chat/MessageBubble.tsx` 重构 · `streaming: boolean` 期间末尾永久挂 `▍`(`ah-caret` animation) · 非流式清光标 · 文本 incremental(props 受控追加 · 不整段 replace)。
3. `web/components/chat/Composer.tsx` 新建 · 规格:
   - textarea + send 按钮(右侧 · 纵向居中或下沿右端)· send/stop 同一按钮 · 视觉用 1-line SVG(`arrow-right` for send / 方块 for stop · 新增 1-line SVG 需登记)
   - 下沿 ControlBar · slot 接受 `thinking toggle` / `model picker` / `attach` / 自定义。
4. `backend/src/allhands/api/routers/chat.py` · 把 `event_stream()` 包在 `asyncio.Task` 里 + 轮询 `request.is_disconnected()` · 断开时 `task.cancel()`(`chat_svc` 的 async generator 里已有 `await` 点 · 会响应 cancel)。
5. 迁移 `InputBar.tsx` → 调用 Composer(薄 wrapper 保持现有 `conversationId` API 不变);迁移 `ModelTestDialog.tsx` footer textarea+按钮块 → 调用 Composer(传 thinking toggle 作为 control slot)。
6. 测试:
   - `web/lib/__tests__/stream-client.test.ts`:mock body · assert token/meta/done 事件解析顺序正确 · abort 能中断。
   - `web/components/chat/__tests__/MessageBubble.test.tsx`:streaming=true 末尾 `▍` 可见 · streaming=false 消失。
   - `web/components/chat/__tests__/Composer.test.tsx`:isStreaming=false 点击触发 onSend · isStreaming=true 点击触发 onAbort。
   - `web/tests/e2e/chat-ux.spec.ts`:`/gateway` → 打开 ModelTestDialog → 发一条 → assert 按钮文本/SVG 变 stop · 文本长度持续增长(typewriter) · 点 stop → 按钮回 send · 可重发。
   - `backend/tests/integration/api/test_chat_cancel.py`:mid-stream 关 client → agent task 记录 cancelled。

## 5. 视觉纪律红线(改 web 前复核)

- 禁 icon 库 · send/stop 用 1-line SVG(新增 `send` 和 `stop` 两类 · 登记到 `product/03-visual-design.md §2.6` 视觉契约的 5 类允许清单里)。
  - 方案:`send` = 复用 `arrow-right`(现有) · `stop` = 4×4 实心方块(mono 字符 `■` 也可)。两种方案任选一 · 优先 SVG(跟 `arrow-right` 风格一致)。
- send/stop 切换 · 不用 `scale` / `shadow` · 只换内部 SVG + `transition-colors duration-150`。
- 焦点环用 1px primary 外描边(不用 `ring`)· `InputBar.tsx:116` 的 `focus:ring-1 focus:ring-primary` 是既有违规 · 顺手改 `focus:border-primary`。
- Composer 外壳 · 圆角 `rounded-md`(8px · 对应"input 复合容器") · 边框 `border-border` · focus 态 `border-primary`。
