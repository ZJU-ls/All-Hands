# 02 · User Stories & Acceptance Criteria

> 范围:v0 MVP。每个 story 是可独立验收的功能切片,对应 `01-prd.md` 的 P0/P1。

**格式:**
- **作为** `<角色>`
- **我想** `<能力>`
- **以便** `<价值>`
- **Acceptance(验收)**:bullet 列出可测试的标准

---

## Epic A · Lead Agent 对话式操作

### A1 · 与 Lead Agent 自然对话

**作为** 自部署用户
**我想** 打开 web UI 立刻看到一个和 Lead Agent 的对话窗口
**以便** 不用学任何配置就能开始干活

**Acceptance:**
- 首次打开 `/` 自动进入 Lead Agent 对话(不是空状态)
- 发一条文本消息,在 ≤ 2s 内看到首个 token
- 流式输出,中途可"Stop generating"(至少 UI 显示按钮,v0 行为:立即中止 SSE)
- 对话历史持久化,刷新页面可见

### A2 · 让 Lead Agent 列出现有员工

**作为** 用户
**我想** 说"列出所有员工"
**以便** 快速了解我的团队当前状态

**Acceptance:**
- Lead Agent 调 `list_employees` tool
- 返回 render payload,前端内联渲染"员工列表"组件(卡片或表格)
- 组件显示:name、description、is_lead_agent 标识、tool 数量、创建时间
- 卡片可点击,展开 → 进入员工详情(仍以 render tool 形式)

### A3 · 让 Lead Agent 创建员工(带 Confirmation)

**作为** 用户
**我想** 说"给我建一个研究员,用来调研技术对比"
**以便** 让 Lead Agent 按需造员工

**Acceptance:**
- Lead Agent 调 `create_employee`,前端弹 Confirmation 对话框
- 对话框展示:name / description / system_prompt 预览 / 绑定的 tools+skills / max_iterations
- 用户点"Yes"后员工入库,Lead Agent 收到 tool result 并继续
- 用户点"No",Lead Agent 收到 `rejected` 结果,自行决定下一步(通常会问用户怎么调整)

### A4 · 让 Lead Agent 派遣员工完成任务

**作为** 用户
**我想** 说"让研究员调研 LangGraph 和 CrewAI"
**以便** 让 Lead Agent 决定调度策略,我不用自己编排

**Acceptance:**
- Lead Agent 调 `dispatch_employee(name, task)`
- 执行层开启子 conversation(parent_run_id 指向 Lead Agent 的当前 run)
- 子员工完整 React loop 执行,每步 tool call 在 UI 可见(嵌套式展开)
- 任务完成,子员工的最终输出作为 tool result 返回 Lead Agent
- LangFuse trace 呈树状结构,根是 Lead Agent,子节点是被派遣的员工

### A5 · Lead Agent 自举(改自己的 prompt)

**作为** 用户
**我想** 说"把自己的 system prompt 改成更简洁的版本"
**以便** 不离开对话就能调优 Lead Agent

**Acceptance:**
- Lead Agent 调 `propose_lead_agent_version(new_prompt, rationale)`
- 工具**不直接生效**,而是写入 `lead_agent_versions` 表作为候选
- 对话返回 render tool:"候选版本 #N 已就绪,[切换到此版本] [保留当前版本]"
- 用户点"切换"后,下次对话使用新版本;旧版本保留 30 天
- 候选版本列表(最多近 5 条)可通过"列出 Lead Agent 版本"看到

---

## Epic B · 员工执行与对话

### B1 · 直连某员工对话(debug)

**作为** 开发者
**我想** 跳过 Lead Agent,直接和某员工对话
**以便** 调试单员工的行为

**Acceptance:**
- 员工详情组件有"直接对话"按钮
- 点击后进入一个独立对话(conversation.employee_id = 该员工)
- UI 顶栏显示"正在与 <Researcher> 对话 · [返回 Lead Agent]"
- 对话语义和 Lead Agent 完全相同(只是工具集不同)

### B2 · 员工 React 执行可观测

**作为** 用户
**我想** 看到员工在干什么
**以便** 信任它,并能发现它卡住 / 走偏

**Acceptance:**
- 每条 assistant 消息如果含 tool_calls,默认折叠显示 tool 名称列表
- 点击展开看到每个 tool 的 args / result(JSON 格式化,长文本截断带展开)
- Tool 执行中状态:`pending → running → succeeded|failed`,UI 实时更新
- 失败的 tool 红色高亮,hover 看 error

### B3 · 员工循环上限保护

**作为** 用户
**我想** 看到员工循环耗尽时的提示
**以便** 知道发生了什么,可以调高上限或换方法

**Acceptance:**
- React loop 达到 `max_iterations`,立即停止
- 最后一条 assistant 消息带明显提示"已达循环上限 (10/10),停止执行"
- 消息下方有操作按钮:[提高上限重试] [丢弃]

---

## Epic C · Tool / Skill / MCP 管理

### C1 · 让 Lead Agent 挂载 MCP

**作为** 用户
**我想** 说"帮我接上 Tavily MCP"
**以便** 不用找配置页面

**Acceptance:**
- Lead Agent 调 `register_mcp(name, transport, config)`,带 confirmation
- 后台握手、列工具,成功后 `health=ok`
- 回复:"已注册 Tavily MCP,暴露了 X 个工具:[...]。要把它们绑到哪个员工?"
- 失败回复:原因 + "检查 API key 或 URL 后再试"

### C2 · 查看 Skill 库

**作为** 用户
**我想** 说"有哪些 skill 可用"
**以便** 知道能给员工装什么

**Acceptance:**
- Lead Agent 调 `list_skills`
- 渲染 skill 列表(name, description, tool 数量, version)
- 每个 skill 可点展开 → 看 prompt_fragment 和所属 tool 列表

### C3 · 给员工装 Skill

**作为** 用户
**我想** 说"把 web_research skill 装到 Researcher 身上"

**Acceptance:**
- Lead Agent 调 `update_employee(id, skill_ids=["web_research", ...])`
- Confirmation 展示差异(新增/移除的 skill 和随之变化的 tool 集)
- 用户同意后员工更新

---

## Epic D · 观测(LangFuse)

### D1 · 每条对话可跳 trace

**作为** 用户
**我想** 点消息旁的小图标直接去 LangFuse 看详情
**以便** 不在 UI 也能做深度分析

**Acceptance:**
- 每条 assistant 消息右下有"View in LangFuse"小图标(次要 UI 权重)
- 点击新 tab 打开 `<LANGFUSE_HOST>/trace/<trace_id>`
- 嵌套执行(子员工)的 trace 在 LangFuse 里以父子结构显示

### D2 · 成本显示(P1)

**作为** 付费自部署用户
**我想** 看到本次对话花了多少钱
**以便** 控制预算

**Acceptance:**
- 每条 assistant 消息底部显示 "~$0.0012 · 1520 tokens"(从 LangFuse API 聚合)
- 聚合失败时显示 "~ tokens"(不阻断 UX)

---

## Epic E · 持久化与可恢复

### E1 · 对话历史跨重启保留

**作为** 自部署用户
**我想** 停机重启后历史对话都还在
**以便** 不丢上下文

**Acceptance:**
- `docker compose down && docker compose up`,对话列表完整恢复
- 最近一次的对话内容和 tool call 嵌套正确回放

### E2 · 长任务中途刷新页面(checkpoint)

**作为** 用户
**我想** 员工正在执行时刷新浏览器,回来还能看到进度
**以便** 长任务不怕意外

**Acceptance:**
- LangGraph AsyncSqliteSaver 每步 checkpoint
- 刷新后从数据库重建会话状态
- 如执行仍在进行(未 break):UI 继续从 checkpoint 接 SSE
- 如执行因断连中断:UI 显示"上次执行到第 N 步被中断,[恢复]?"

---

## Epic F · 交付与开箱

### F1 · `docker compose up` 5 分钟跑起来

**作为** 新用户
**我想** 克隆仓库后照 README 操作能跑
**以便** 立刻评估是否适合

**Acceptance:**
- 干净 macOS / Linux 机器,`git clone && cp .env.example .env && docker compose up`
- 5 分钟内 backend、web、LangFuse 全部就绪
- 访问 `localhost:3000` 看到 Lead Agent 对话界面
- README 写清 API key 设置位置

---

## 优先级矩阵

| Epic | MVP v0 必须 | MVP v0 可选 | v1+ |
|---|---|---|---|
| A · Lead Agent 对话 | A1, A2, A3, A4 | A5(自举) | — |
| B · 员工执行 | B1, B2, B3 | — | — |
| C · Tool/Skill/MCP | C1, C2, C3 | — | Skill 市场 |
| D · 观测 | D1 | D2(成本) | 驾驶舱独立页 |
| E · 持久化 | E1, E2 | — | — |
| F · 交付 | F1 | — | — |

**v0 发布 = 所有"必须"列绿色。**
