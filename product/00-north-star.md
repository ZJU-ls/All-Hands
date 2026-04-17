# 00 · North Star

> **本文件是整个项目的最高仲裁文档。** 任何技术决策、设计取舍、功能取舍,如果与本文件冲突,要么改本文件(走 ADR 流程),要么改决策。

---

## 产品一句话

**One for All(代号 `allhands`)—— 一个 Lead Agent 搞定一切。**

用户只通过与 Lead Agent 对话,即可设计、调度、组织、观测一支完整的数字员工团队。平台的所有操作都以 Tool 形式开放给 Lead Agent,UI 是透明的观测和确认面板,不是配置面板。

---

## 目标用户

| 用户画像 | 场景 | 典型诉求 |
|---|---|---|
| **独立开发者 / 小团队技术负责人** | 自部署,给自己或团队用 | 替代"打开 5 个工具手工拼流程",让 agent 团队常驻 |
| **AI 产品团队 PM / 工程师** | 调研场景、内部运营自动化、客服前置 | 快速试出一套可用的"员工编排",不想陷入 LangGraph 底层 |
| **开源社区用户** | 自部署玩,贡献 Skill/MCP | 想要 Dify 级可用性 + LangChain 级可扩展性 |

---

## 差异化(vs 现有玩家)

| 产品 | 主叙事 | 我们的差别 |
|---|---|---|
| **Dify** | 可视化工作流编排 | 我们是对话式操作,UI 是观测而非配置 |
| **n8n / Make** | 节点式自动化 | 我们的"节点"是 Agent,不是函数;Agent 能被 Agent 派遣 |
| **CrewAI / AutoGen** | 多 agent 协作库 | 我们有可观测、可持久、可交付(docker compose up)的完整平台 |
| **LangFlow / Flowise** | LangChain 的可视化拼图 | 我们坚持"Tool First",所有能力同构,不搞节点种类膨胀 |
| **OpenHands / All Hands AI** | 通用软件工程 Agent | 我们聚焦"员工团队组织",不是单 Agent 无限 scope |

**记忆点:** 别人叫"agent 工作流平台",我们叫"**数字员工组织**"。员工有身份、有工具、有上下级、被 Lead 调度、被驾驶舱观测。

---

## 核心设计原则(4 条,排序即优先级)

### 1. Tool First

**一切能力皆 Tool。** 三类同构:

- **Backend Tool** — 有副作用(改 DB / 调外部 API / 读文件 / MCP 调用)
- **Render Tool** — 指令前端渲染组件(`{component, props}`)
- **Meta Tool** — 操作平台自身(`create_employee`、`list_employees`、`dispatch_employee` 等)

三类共享统一 schema、统一注册表、统一 confirmation/audit 策略。

**推论:**
- 前端没有"配置页面",只有"对话窗口 + 内联渲染组件"。驾驶舱、员工列表、员工详情 —— 都是 Lead Agent 调 render tool 的返回。
- 新增功能 = 注册新 Tool(+ 可能注册新前端组件)。**零页面代码**。

### 2. 统一 React Agent

**所有员工同一代码路径。** 数据模型里**没有 `mode` 字段**,只有:

- `tools[]`(显式工具绑定)
- `skill_ids[]`(工具包)
- `max_iterations`(循环上限)
- `system_prompt`
- `model_ref`

所谓"计划模式"、"主管模式" = 预置的工具包模板。`plan(goal) → steps` 装上就是计划模式,`dispatch_employee` 装上就是主管模式。Lead Agent = 装了全套 Meta Tools 的 React Agent。

### 3. L4 对话式操作 + 护栏

**用户通过与 Lead Agent 对话完成全部平台操作。** 对应 4 级能力边界:

- L1 只读 + 派遣(不够)
- L2 + 即时创建员工(不够)
- L3 + 修改/删除(不够)
- **L4 + 自举(改自己 prompt / 工具 / 造新 Lead Agent)** ← **采用这条**

但配套护栏必须同时存在:

- **不可逆操作** (`delete`, `drop`) → 强制 Confirmation Gate
- **敏感写入** (API key / Gateway / LangFuse token) → Gate + 审计
- **自举操作** → 写入"候选版本",用户在 UI 显式切换才生效,旧版本可回滚
- 所有工具调用经 LangFuse,事后可溯源

### 4. 低耦合 / 高扩展

**每层对外只暴露接口或注册点,不泄漏内部类型。**

- `core/` 是 Pydantic + stdlib 纯领域层,**禁止** import `sqlalchemy`、`fastapi`、`langgraph`、`langchain`、`openai`、`anthropic`
- 新能力走"注册"(ToolRegistry / ComponentRegistry / MCPClient / ModelGateway),不走"改核心代码"
- 依赖方向严格自上而下(L10 → L9 → L8 → L7 → L6 → L5 → L4 / L3 / L2 / L1),禁循环依赖
- harness 在 pre-commit 用 import-linter 静态检查分层

---

## 非目标(v0/v1 明确不做)

- ❌ 可视化工作流编辑器(违反 Tool First + 对话式操作)
- ❌ 内置 RAG 引擎(Skill / MCP 外接即可)
- ❌ 向量数据库(v2+ 再议)
- ❌ 多租户(v0 单实例;SaaS 是 v4+ 的故事)
- ❌ 计费 / Usage 限流(同上)
- ❌ 内置 UI 配置面板(除 v1 的驾驶舱;核心配置通过与 Lead Agent 对话)
- ❌ 非 OpenAI-compatible 的模型协议(v0 写死单协议,v1 再抽象 ModelGateway)

---

## 衡量标准(North Star Metric 候选)

**v0 发布时的 North Star:**

> 用户能通过与 Lead Agent 一句话对话,完成"调研 LangGraph vs CrewAI 并产出 markdown 报告"的完整任务,且全过程在 LangFuse 中有完整嵌套 trace,耗时 < 5 分钟、成本 < $0.50。

这条任务覆盖:Lead Agent 对话、create_employee(需 confirmation)、dispatch_employee(Supervisor 语义)、MCP web_search、React Agent 执行、Render Tool、LangFuse。

---

## 品牌说明

- **项目代号 / 仓库名:** `allhands`
- **品牌冲突提示:** `allhands.dev` 已被 All Hands AI(OpenHands 的商业实体)占用。**代号仅内部使用**。对外发布前需确定正式品牌,届时做全量 rename(走 ADR)。
- **License:** MIT(可改)

---

## 本文件的边界

- ✅ 产品哲学、差异化、核心原则、非目标
- ❌ 具体功能清单 → 看 `01-prd.md`
- ❌ 用户故事 → 看 `02-user-stories.md`
- ❌ 视觉规范 → 看 `03-visual-design.md`
- ❌ 技术架构 → 看 `04-architecture.md`
- ❌ 版本计划 → 看 `05-roadmap.md`

**任何改动本文件必须走 ADR 流程(在 `adr/` 下创建一条)。**
