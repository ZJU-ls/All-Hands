# 04 · Architecture

> 本文件是所有开发会话的技术根。实现决策与本文件冲突,要么改本文件(走 ADR),要么改实现。

---

## 0. 总览

### 0.1 架构方案:SSE 流式 + in-process asyncio(**方案 C**)

- FastAPI + `asyncio.TaskGroup` 承载对话请求
- 对话响应通过 **SSE**(Server-Sent Events)流式推送
- LangGraph 所有 API 原生 async,`AsyncSqliteSaver` 提供 checkpoint
- v0 不引入 Redis / 独立 worker;v1 加触发器时,APScheduler 独立进程通过 HTTP 调 backend API

### 0.2 10 层骨架

```
┌────────────────────────────────────────────────────────────────┐
│  L10  前端展示层  Chat UI + Component Registry + Render 映射    │  Next.js 15
├────────────────────────────────────────────────────────────────┤
│  L9   前端应用层  路由 / 状态 / SSE 消费 / Confirmation 弹窗    │  Zustand + TanStack Query
├────────────────────────────────────────────────────────────────┤
│  L8   传输协议层  SSE envelope / Render 协议 / 确认消息协议     │  共享 schema(zod + pydantic)
├────────────────────────────────────────────────────────────────┤
│  L7   API 层      FastAPI Routers: /chat, /confirm, /trace      │  FastAPI
├────────────────────────────────────────────────────────────────┤
│  L6   应用服务层  ChatService / EmployeeService / ConfirmSvc    │  业务编排
├────────────────────────────────────────────────────────────────┤
│  L5   执行层      AgentRunner / ToolRegistry / Gate / MCPClient │  LangGraph 集成点
├────────────────────────────────────────────────────────────────┤
│  L4   Core 领域层 Employee / Tool / Skill / MCP / Message ...   │  Pydantic
├────────────────────────────────────────────────────────────────┤
│  L3   数据层      SQLAlchemy 2 + Alembic (SQLite WAL)           │  持久化
├────────────────────────────────────────────────────────────────┤
│  L2   观测层      LangFuse SDK + Callback / 成本埋点            │  横切
├────────────────────────────────────────────────────────────────┤
│  L1   基础设施层  Docker Compose / env / LangFuse stack         │  交付形态
└────────────────────────────────────────────────────────────────┘
```

### 0.3 依赖方向

**严格自上而下**。`core/` 不 import 任何其他层;其他层可 import `core/`。跨层依赖通过接口(abstract class)而非具体实现。

由 `import-linter` 在 pre-commit 强制检查。

---

## L4 · Core 领域模型

**位置:** `backend/src/allhands/core/`
**依赖:** `pydantic`、stdlib
**禁止 import:** `sqlalchemy`、`fastapi`、`langgraph`、`langchain`、`openai`、`anthropic`

### L4.1 Tool

```python
from enum import StrEnum
from pydantic import BaseModel
from typing import Literal, Optional

class ToolKind(StrEnum):
    BACKEND = "backend"
    RENDER  = "render"
    META    = "meta"

class ToolScope(StrEnum):
    READ          = "read"
    WRITE         = "write"
    IRREVERSIBLE  = "irreversible"
    BOOTSTRAP     = "bootstrap"

class CostHint(BaseModel):
    relative: Literal["low", "medium", "high"] = "low"
    note: Optional[str] = None

class Tool(BaseModel):
    id: str            # "allhands.core.create_employee"
    kind: ToolKind
    name: str
    description: str
    input_schema: dict          # JSON Schema
    output_schema: dict
    scope: ToolScope
    requires_confirmation: bool = False
    cost_hint: Optional[CostHint] = None
```

### L4.2 Skill / MCPServer

```python
class Skill(BaseModel):
    id: str                         # "allhands.skills.web_research"
    name: str
    description: str
    tool_ids: list[str]
    prompt_fragment: Optional[str] = None
    version: str                    # semver

class MCPTransport(StrEnum):
    STDIO = "stdio"
    SSE   = "sse"
    HTTP  = "http"

class MCPHealth(StrEnum):
    UNKNOWN      = "unknown"
    OK           = "ok"
    UNREACHABLE  = "unreachable"
    AUTH_FAILED  = "auth_failed"

class MCPServer(BaseModel):
    id: str
    name: str
    transport: MCPTransport
    config: dict                    # {command, args, env} or {url, headers}
    enabled: bool = True
    exposed_tool_ids: list[str] = []
    last_handshake_at: Optional[datetime] = None
    health: MCPHealth = MCPHealth.UNKNOWN
```

### L4.3 Employee

```python
class Employee(BaseModel):
    id: str                         # uuid4
    name: str                       # 全局唯一
    description: str
    system_prompt: str
    model_ref: str                  # "openai_compat:default"
    tool_ids: list[str] = []
    skill_ids: list[str] = []
    max_iterations: int = 10
    is_lead_agent: bool = False
    created_by: str                 # "user" | "lead_agent:<run_id>"
    created_at: datetime
    metadata: dict = {}

    # Invariants(工厂方法/validator):
    # 1. (tool_ids ∪ skill_ids展开) 非空
    # 2. 1 <= max_iterations <= 100
    # 3. is_lead_agent=True 全局唯一(L3 DB 层 unique constraint)
    # 4. is_lead_agent=True 必须包含核心 Meta Tools(L5 validator)
    # 5. system_prompt 长度 [1, 20000]
    # 6. name 匹配 /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
```

### L4.4 Conversation / Message / ToolCall / RenderPayload

```python
class Conversation(BaseModel):
    id: str                      # uuid4
    title: Optional[str] = None
    employee_id: str
    created_at: datetime
    metadata: dict = {}

class Message(BaseModel):
    id: str
    conversation_id: str
    role: Literal["user", "assistant", "tool", "system"]
    content: str
    tool_calls: list["ToolCall"] = []
    tool_call_id: Optional[str] = None
    render_payloads: list["RenderPayload"] = []
    trace_ref: Optional[str] = None
    parent_run_id: Optional[str] = None  # 嵌套执行
    created_at: datetime

class ToolCallStatus(StrEnum):
    PENDING              = "pending"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    RUNNING              = "running"
    SUCCEEDED            = "succeeded"
    FAILED               = "failed"
    REJECTED             = "rejected"

class ToolCall(BaseModel):
    id: str
    tool_id: str
    args: dict
    status: ToolCallStatus
    result: Optional[object] = None
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

class InteractionSpec(BaseModel):
    kind: Literal["button", "form_submit", "link"]
    label: str
    action: str                  # "invoke_tool" | "send_message" | "navigate"
    payload: dict = {}

class RenderPayload(BaseModel):
    component: str               # "EmployeeList" etc.
    props: dict
    interactions: list[InteractionSpec] = []
```

### L4.5 Confirmation

```python
class Confirmation(BaseModel):
    id: str
    tool_call_id: str
    rationale: str
    summary: str
    diff: Optional[dict] = None
    status: Literal["pending", "approved", "rejected", "expired"]
    created_at: datetime
    resolved_at: Optional[datetime] = None
    expires_at: datetime         # default: created_at + 10min
```

### L4.6 ModelGateway 接口(v0 仅 OpenAI-compat 实现)

```python
from abc import ABC, abstractmethod

class ModelGateway(ABC):
    @abstractmethod
    async def chat_stream(
        self, messages: list[dict], tools: list[Tool], **kwargs
    ) -> AsyncIterator[ChatDelta]: ...

    @abstractmethod
    async def test_connection(self) -> ConnectionTestResult: ...
```

具体实现在 L5 `execution/gateways/`。

### L4.7 错误类型

```python
class DomainError(Exception): ...
class InvariantViolation(DomainError): ...
class ToolNotFound(DomainError): ...
class EmployeeNotFound(DomainError): ...
class ConfirmationRejected(DomainError): ...
class ConfirmationExpired(DomainError): ...
class MaxIterationsReached(DomainError): ...
class MCPHandshakeFailed(DomainError): ...
```

---

## L5 · 执行层

**位置:** `backend/src/allhands/execution/`
**职责:** 把领域模型装配成可运行的 LangGraph agent,管理 Tool 注册、MCP 连接、Confirmation 拦截、Skill 展开、Render 指令生成。

### L5.1 ToolRegistry

```python
from typing import Callable, Awaitable
from allhands.core.tool import Tool

ToolExecutor = Callable[..., Awaitable[object]]

class ToolRegistry:
    """
    统一注册 Backend / Render / Meta 三类工具。
    所有 Agent 从这里拉工具列表。
    """
    def register(self, tool: Tool, executor: ToolExecutor) -> None: ...
    def get(self, tool_id: str) -> tuple[Tool, ToolExecutor]: ...
    def list_by_ids(self, tool_ids: list[str]) -> list[Tool]: ...
    def list_all(self) -> list[Tool]: ...
```

**注册时机:**
- 内置工具:应用启动时,通过 `discover_builtin_tools()` 扫描 `execution/tools/`
- Skill 工具:同上,`discover_skills()` 扫描 `skills/` 目录下的 Skill 包
- MCP 工具:运行时 `MCPClient.handshake()` 后动态注册

### L5.2 AgentRunner(LangGraph 封装)

```python
from langgraph.prebuilt import create_react_agent

class AgentRunner:
    """
    封装 LangGraph create_react_agent。
    对外只暴露 run() / stream()。
    """
    def __init__(
        self,
        employee: Employee,
        tool_registry: ToolRegistry,
        model_gateway: ModelGateway,
        confirmation_gate: ConfirmationGate,
        checkpointer: AsyncSqliteSaver,
        langfuse_handler: CallbackHandler,
    ): ...

    async def stream(
        self, messages: list[Message], thread_id: str,
    ) -> AsyncIterator[AgentEvent]:
        """
        yield AgentEvent,由 L6 消费并转成 L8 SSE event。
        """
        ...
```

**关键约束:**
- LangGraph 的 `StateGraph` / message type 不泄漏到其他层
- 外界看到的永远是 `AgentEvent`(在 L8 定义的 event envelope 的后端源)

### L5.3 ConfirmationGate

```python
class ConfirmationGate:
    """
    拦截所有需要确认的 tool 调用,写入 Confirmation,
    通过事件总线通知前端,异步等待用户决议。
    """
    async def gate(
        self, tool: Tool, args: dict,
        tool_call_id: str, rationale: str,
    ) -> GateOutcome:  # Approved | Rejected | Expired
        ...
```

**工作流程:**

1. Tool 被调用前,Runner 查 `tool.requires_confirmation` 或 ConfirmationPolicy
2. 需确认 → 写 Confirmation 表 → 发 SSE `confirm_required` 事件
3. 在 asyncio.Event / DB 轮询 / pub-sub(v0 用 DB 轮询简化)等待状态变化
4. `approved` → 执行 tool; `rejected`/`expired` → 返回失败结果给 Agent

**Timeout:** `confirmation_timeout_seconds=600`(10min),可 env 覆盖

### L5.4 ConfirmationPolicy(插件化)

```python
class ConfirmationPolicy(ABC):
    @abstractmethod
    def should_confirm(
        self, tool: Tool, args: dict, context: PolicyContext,
    ) -> bool: ...

class DefaultPolicy(ConfirmationPolicy):
    """按 tool.scope: READ 跳过;其余要确认。"""

class PermissivePolicy(ConfirmationPolicy):
    """Session 内同 tool+args hash 首次确认后记住(v1)。"""
```

v0 只 DefaultPolicy。

### L5.5 MCPClient

```python
class MCPClient:
    async def handshake(self, server: MCPServer) -> HandshakeResult: ...
    async def invoke(self, tool_id: str, args: dict) -> object: ...
    async def health_check(self, server: MCPServer) -> MCPHealth: ...

    def _register_mcp_tools(
        self, server: MCPServer, tool_registry: ToolRegistry,
    ) -> list[str]: ...
```

使用官方 `mcp` Python SDK。每个 MCPServer 对应一个长连接(stdio / SSE),失败自动重连 3 次后标记 `unreachable`。

### L5.6 Skill 展开

```python
def expand_skills_to_tools(
    employee: Employee, skill_registry: SkillRegistry, tool_registry: ToolRegistry,
) -> list[Tool]:
    """
    把 employee.skill_ids + employee.tool_ids 展开成最终的 tool 集合,
    拼接 prompt_fragments 到 system_prompt 末尾(去重、按 skill 顺序)。
    """
    ...
```

### L5.7 内置 Meta Tools(Lead Agent 专属)

| Tool ID | Scope | Confirmation |
|---|---|---|
| `allhands.meta.list_employees` | READ | no |
| `allhands.meta.get_employee_detail` | READ | no |
| `allhands.meta.create_employee` | WRITE | yes |
| `allhands.meta.update_employee` | WRITE | yes |
| `allhands.meta.delete_employee` | IRREVERSIBLE | yes + diff |
| `allhands.meta.dispatch_employee` | WRITE | no(轻量;但嵌套执行中可能触发子工具确认) |
| `allhands.meta.list_skills` | READ | no |
| `allhands.meta.list_mcps` | READ | no |
| `allhands.meta.register_mcp` | WRITE | yes |
| `allhands.meta.remove_mcp` | IRREVERSIBLE | yes |
| `allhands.meta.list_conversations` | READ | no |
| `allhands.meta.plan_create` | WRITE | no(agent 工作备忘,无外部副作用) |
| `allhands.meta.plan_update_step` | WRITE | no |
| `allhands.meta.plan_complete_step` | WRITE | no |
| `allhands.meta.plan_view` | READ | no |
| `allhands.meta.propose_lead_agent_version` | BOOTSTRAP | yes + 写候选 |
| `allhands.meta.switch_lead_agent_version` | BOOTSTRAP | yes + 写候选 |
| `allhands.meta.cockpit.get_workspace_summary` | READ | no |
| `allhands.meta.cockpit.pause_all_runs` | IRREVERSIBLE | yes + reason |

### L5.8 内置 Render Tools

内置 skill `allhands.render` 打包 10 个 render tool,所有员工默认挂(见 § 4.1 DEFAULT_SKILL_IDS)。

| Tool ID | 返回 component | 典型场景 |
|---|---|---|
| `allhands.render.markdown_card` | `MarkdownCard` | 长文 / 富文本 |
| `allhands.render.table` | `Viz.Table` | 多条记录 × 多属性对比 |
| `allhands.render.kv` | `Viz.KV` | 单实体详情 |
| `allhands.render.cards` | `Viz.Cards` | 2-6 个并列方案 |
| `allhands.render.timeline` | `Viz.Timeline` | 过程 / 历史 |
| `allhands.render.steps` | `Viz.Steps` | wizard / 顺序步骤 |
| `allhands.render.code` | `Viz.Code` | 代码片段(含 Copy) |
| `allhands.render.diff` | `Viz.Diff` | 前后对比(unified / split) |
| `allhands.render.callout` | `Viz.Callout` | info / warn / success / error |
| `allhands.render.link_card` | `Viz.LinkCard` | 富外链 |

skill manifest 在 `backend/skills/builtin/render/SKILL.yaml`,guidance 在 `backend/skills/builtin/render/prompts/guidance.md`。

**注意:** 大多数情况下,Meta Tool 返回数据,Lead Agent 决定**是否**调 render tool 把数据展示出来。也可以设计为:部分 Meta Tool 自动附带 render payload(通过 "auto-render" 标志)。v0 保持简单:**Meta Tool 纯数据,Lead Agent 显式调 render tool**。

---

## L8 · 传输协议层(SSE Envelope)

**位置:** `backend/src/allhands/api/protocol.py` + `web/lib/protocol.ts`

**原则:** 前后端共享同一份 schema,不手写两份。后端 Pydantic → `zod` TypeScript 用 `datamodel-code-generator` 或手工同步(v0 手工,确保一致性测试覆盖)。

### L8.1 SSE Event 类型

```
event: token
data: {"content": "你好"}

event: tool_call_start
data: {"tool_call_id": "...", "tool_id": "...", "args_preview": {...}}

event: tool_call_progress
data: {"tool_call_id": "...", "chunk": {...}}   # 运行中的中间输出(可选)

event: tool_call_end
data: {"tool_call_id": "...", "status": "succeeded", "result": {...}}

event: confirm_required
data: {"confirmation_id": "...", "tool_call_id": "...",
       "summary": "...", "rationale": "...", "diff": {...}?}

event: confirm_resolved
data: {"confirmation_id": "...", "status": "approved"|"rejected"|"expired"}

event: render
data: {"component": "EmployeeList", "props": {...}, "interactions": [...]}

event: nested_run_start
data: {"run_id": "...", "parent_run_id": "...", "employee_name": "..."}

event: nested_run_end
data: {"run_id": "...", "status": "..."}

event: trace
data: {"trace_id": "...", "url": "https://langfuse..."}

event: error
data: {"code": "...", "message": "..."}

event: done
data: {"message_id": "..."}
```

### L8.2 Confirmation 回传

前端点击 Approve/Reject 后:

```
POST /api/confirmations/{confirmation_id}/resolve
Content-Type: application/json

{ "decision": "approve" | "reject" }
```

响应 `204 No Content`,SSE 会收到 `confirm_resolved` 事件。

### L8.3 错误码

统一枚举,前端据此决定 UX:

| code | 含义 | UX |
|---|---|---|
| `TOOL_NOT_FOUND` | 调用了未注册 tool | 错误消息,不重试 |
| `CONFIRMATION_EXPIRED` | 超时 | 错误,可由 Agent 重试 |
| `MAX_ITERATIONS_REACHED` | 耗尽循环 | 提示"提高上限"按钮 |
| `MODEL_CALL_FAILED` | LLM 错误 | 显示原始 error |
| `MCP_UNREACHABLE` | MCP 断连 | 提示检查 MCP 状态 |
| `INTERNAL` | 未分类 | 显示 "Something went wrong" + log |

---

## L7 · API 层(FastAPI Routers)

**位置:** `backend/src/allhands/api/`

### L7.1 Router 清单(v0)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health` | 健康检查 |
| POST | `/api/conversations` | 创建对话(指定 employee_id,默认 Lead Agent) |
| GET  | `/api/conversations` | 列对话 |
| GET  | `/api/conversations/{id}` | 获取对话 + 消息 |
| POST | `/api/conversations/{id}/messages` | 发消息,响应 SSE 流 |
| POST | `/api/confirmations/{id}/resolve` | 确认决议 |
| GET  | `/api/confirmations/pending` | 拉取未决确认(兜底/轮询) |
| GET  | `/api/traces/{trace_id}` | 返回 LangFuse URL(避免前端知 LangFuse host) |
| GET  | `/api/cockpit/summary` | Workspace 快照(KPI + 健康 + recent events) |
| GET  | `/api/cockpit/stream` | Workspace-level SSE(snapshot + 增量) · 见 cockpit spec § 4.2 |
| POST | `/api/cockpit/pause-all` | 急停(要 `X-Confirmation-Token`;幂等) |
| POST | `/api/cockpit/resume-all` | 恢复 · 对称 |

**注意:**
- v0 **无鉴权**。依赖 docker compose 内网,不暴露公网。
- API 表面故意极小 —— 员工 / MCP / Skill 的 CRUD 走**对话里的 Meta Tool**,不开 REST endpoint。

### L7.2 FastAPI 约定

- 每个 router 独立文件:`api/routers/{chat,confirmations,traces,health}.py`
- 依赖注入:`Depends(get_session)` 提供 AsyncSession,`Depends(get_service)` 提供 Service
- 响应用 Pydantic models,**不回传 SQLAlchemy ORM 对象**
- 流式响应使用 `fastapi.responses.StreamingResponse` + `text/event-stream`

---

## L6 · 应用服务层

**位置:** `backend/src/allhands/services/`

### L6.1 Service 清单

| Service | 职责 |
|---|---|
| `ChatService` | 承载"用户发消息 → 执行 → 流式返回"的完整 use case |
| `EmployeeService` | Employee CRUD(供 Meta Tool 调用)+ invariant 执行 |
| `ConversationService` | 对话、消息、checkpoint 管理 |
| `ConfirmationService` | 确认创建 / 决议 / 超时清理 |
| `MCPService` | MCP 注册、握手、健康检查、工具同步 |
| `SkillService` | Skill 发现、展开、版本 |
| `ToolService` | Tool 查询、ToolRegistry 的业务门面 |
| `TraceService` | LangFuse URL 构造 / trace 查询 |

### L6.2 ChatService(核心)

```python
class ChatService:
    async def send_message(
        self, conversation_id: str, user_content: str,
    ) -> AsyncIterator[SSEEvent]:
        """
        1. 持久化 user message
        2. 查 conversation + employee
        3. 从 ToolRegistry 拉工具
        4. 构造 AgentRunner
        5. runner.stream() 产出 AgentEvent
        6. 转换 AgentEvent → SSEEvent,同步写 DB
        7. 结束时发 `done`
        """
        ...
```

**关键点:**
- 事务边界:每次 tool call 结束后 commit(避免长事务 + 前端立即可见)
- 异常捕获:任何错误 → 发 `error` 事件 + `done`,不断流
- Cancellation:客户端断开 → SSE 迭代器抛 `CancelledError` → Runner 接收,优雅终止

---

## L3 · 数据层

**位置:** `backend/src/allhands/persistence/`

### L3.1 选型

- **SQLite 3.40+** with WAL 模式
- **SQLAlchemy 2.0+** async,`aiosqlite` driver
- **Alembic** 做 migration
- **LangGraph checkpointer:** `AsyncSqliteSaver`,**独立表**前缀(LangGraph 自管)

### L3.2 Schema 清单

```
employees              (id, name, description, system_prompt, model_ref,
                        tool_ids_json, skill_ids_json, max_iterations,
                        is_lead_agent, created_by, created_at, metadata_json)
  UNIQUE(name)
  UNIQUE(is_lead_agent) WHERE is_lead_agent = 1  -- singleton

conversations          (id, title, employee_id, created_at, metadata_json)
  FK employee_id → employees.id

messages               (id, conversation_id, role, content,
                        tool_calls_json, tool_call_id, render_payloads_json,
                        trace_ref, parent_run_id, created_at)
  FK conversation_id → conversations.id
  INDEX (conversation_id, created_at)
  INDEX (parent_run_id)

confirmations          (id, tool_call_id, rationale, summary, diff_json,
                        status, created_at, resolved_at, expires_at)
  INDEX (status, expires_at)

mcp_servers            (id, name, transport, config_json, enabled,
                        exposed_tool_ids_json, last_handshake_at, health)
  UNIQUE(name)

audit_events           (id, timestamp, tool_id, employee_id, conversation_id,
                        args_json, result_json, user_decision, trace_id)
  INDEX (timestamp)
  INDEX (tool_id)

lead_agent_versions    (id, version_n, system_prompt, tool_ids_json,
                        rationale, created_at, created_by, retired_at)
  INDEX (version_n)

lead_agent_active      (id SINGLETON, version_id, switched_at)
  FK version_id → lead_agent_versions.id
  CHECK (id = 1)

-- LangGraph 自管:
checkpoints / checkpoint_writes / checkpoint_blobs(schema 由 AsyncSqliteSaver 创建)
```

### L3.3 Repository 模式

```python
class EmployeeRepository:
    async def get(self, id: str) -> Optional[Employee]: ...
    async def get_by_name(self, name: str) -> Optional[Employee]: ...
    async def list(self) -> list[Employee]: ...
    async def save(self, employee: Employee) -> None: ...
    async def delete(self, id: str) -> None: ...
```

- Repository 负责 ORM ↔ 领域模型转换(**领域层看不到 ORM**)
- ORM 模型在 `persistence/orm/*.py`,领域模型在 `core/*.py`,独立

### L3.4 Alembic 初始 migration

`alembic/versions/0001_initial_schema.py` 一次性创建上述所有表(不含 LangGraph)。

---

## L2 · 观测层

**位置:** `backend/src/allhands/observability/`

### L2.1 LangFuse 集成

- 使用 `langfuse.callback.CallbackHandler`(LangGraph 一等支持)
- 每次 `AgentRunner.stream()` 创建一个 LangFuse trace
- 嵌套执行(Dispatch):子 trace 通过 `parent_observation_id` 挂到父 trace
- Tool 调用、LLM 调用自动上报

### L2.2 成本埋点

- LangFuse 自动计算(`generations` 带 usage)
- 本地不重复计算,只存 `trace_ref`,需要时从 LangFuse API 拉

### L2.3 审计事件

- 所有经过 ConfirmationGate 的 tool 调用,无论 approved/rejected/expired,写 `audit_events`
- 所有 BOOTSTRAP scope 的 tool 调用,额外记录

### L2.4 结构化日志

- 后端用 `structlog` JSON 输出
- 字段:`timestamp, level, trace_id, conversation_id, employee_id, event, ...`
- Docker 部署时 stdout/stderr 交给宿主机 log driver

---

## L1 · 基础设施

**位置:** 仓库根 `docker-compose.yml` + `backend/Dockerfile` + `web/Dockerfile`

### L1.1 Compose 服务

```yaml
services:
  backend:   # FastAPI, depends_on: langfuse-web
  web:       # Next.js
  langfuse-web:
  langfuse-worker:
  langfuse-postgres:
  langfuse-clickhouse:
  langfuse-redis:
  langfuse-minio:  # trace 附件
```

**注意:**
- `backend` 只依赖 `langfuse-web`(LangFuse API),不直接访问 LangFuse 的 postgres / clickhouse / redis
- `backend` 自己的数据库是 **SQLite 文件**(`/app/data/app.db`,挂 volume)
- `web` 和 `backend` 通过 `backend:8000` 内网通信

### L1.2 环境变量(`.env`)

```
# LLM
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1   # 可替换为 OpenAI-compat 服务

# LangFuse
LANGFUSE_HOST=http://langfuse-web:3000      # 容器内
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...

# App
DATABASE_URL=sqlite+aiosqlite:///./data/app.db
LEAD_AGENT_SYSTEM_PROMPT_PATH=./prompts/lead_agent_v1.md
CONFIRMATION_TIMEOUT_SECONDS=600
LOG_LEVEL=info
```

### L1.3 启动顺序

1. `langfuse-postgres / clickhouse / redis / minio` 启动
2. `langfuse-web` / `langfuse-worker` 启动,执行 migration
3. `backend` 启动,运行 Alembic migration,扫描 skills 和内置 tools,初始化 Lead Agent(若不存在)
4. `web` 启动,Next.js 监听 3000

---

## L9 · 前端应用层

**位置:** `web/app/` + `web/lib/`

### L9.1 路由

```
app/
├── layout.tsx          # 全局 shell: 顶栏 + sidebar
├── page.tsx            # 重定向到 /chat (Lead Agent)
├── chat/
│   ├── layout.tsx      # sidebar = 会话列表
│   ├── page.tsx        # 新开 Lead Agent 对话
│   └── [conversationId]/page.tsx
```

### L9.2 状态管理

- **Zustand** 做全局状态(当前对话、confirmation queue、主题)
- **TanStack Query** 做服务端数据(对话列表、消息历史)
- SSE 流通过 `EventSource` 消费,写入 Zustand 的当前对话 state

### L9.3 Confirmation 队列

- Zustand 维护一个 `pendingConfirmations: Confirmation[]`
- `confirm_required` SSE event 入队
- Dialog 组件消费队头(一次一条,避免堆叠)
- 用户点击决议 → `POST /confirmations/{id}/resolve` → 等 `confirm_resolved`

---

## L10 · 前端展示层

**位置:** `web/components/`

### L10.1 组件树

```
<ChatWindow>
  <MessageList>
    {messages.map(m => <MessageBubble role={m.role}>
      <MessageRenderer message={m}>
        <Markdown>{m.content}</Markdown>
        <ToolCallCards calls={m.tool_calls} />
        <RenderPayloads payloads={m.render_payloads} />
      </MessageRenderer>
    </MessageBubble>)}
  </MessageList>
  <InputBar />
</ChatWindow>

<ConfirmationDialog /> (portal)
```

### L10.2 ComponentRegistry(前端扩展核心)

见 `03-visual-design.md §5`。

### L10.3 MessageRenderer 规则

1. `content`(string)→ 渲染 markdown
2. `tool_calls[]` → 每个渲染 `<ToolCallCard>`,展开可见 args/result
3. `render_payloads[]` → 按 `component` 从 ComponentRegistry 映射;未注册 → `<UnknownComponent>` 降级展示
4. 嵌套执行(子员工)→ `ToolCallCard` 如果 tool_id = `dispatch_employee`,特殊渲染成"子对话气泡容器"(展开时递归渲染子 run 的 messages)

---

## 跨层扩展点总表

| 扩展点 | 位置 | 新增方式 |
|---|---|---|
| 新 Backend Tool | `execution/tools/` | 写 `Tool` 实例 + executor,注册表扫描 |
| 新 Render Tool | `execution/tools/render/` | 同上 + 在前端 `ComponentRegistry` 注册组件 |
| 新 Meta Tool | `execution/tools/meta/` | 同 Backend Tool,但 kind=META |
| 新 Skill 包 | `skills/<name>/` | 目录含 `skill.yaml` + `prompt.md`,启动扫描 |
| 新 MCP | 运行时 | 对话中 Lead Agent 调 `register_mcp` |
| 新 Render 组件 | `web/components/render/` | 实现 + 在 `lib/component-registry.ts` 注册 |
| 新 ConfirmationPolicy | `execution/policy/` | 实现接口 + DI 切换 |
| 新 ModelGateway | `execution/gateways/` | 实现接口 + 工厂注册 |

---

## 模块边界(import-linter 强制)

```ini
# .import-linter (项目根)
[importlinter]
root_package = allhands

[importlinter:contract:layered]
name = Layered architecture
type = layers
layers =
    allhands.api
    allhands.services
    allhands.execution
    allhands.observability
    allhands.persistence
    allhands.core

[importlinter:contract:core-clean]
name = Core has no framework deps
type = forbidden
source_modules = allhands.core
forbidden_modules =
    sqlalchemy
    fastapi
    langgraph
    langchain
    langchain_core
    openai
    anthropic
```

---

## 并发模型摘要

- 单 uvicorn worker + asyncio(SQLite 写不支持多进程)
- 每个 SSE 请求 = 一个 `asyncio.Task`
- LangGraph 的 `AsyncSqliteSaver` 自带锁,并发安全
- 业务跨表写 = SQLAlchemy async session 显式事务
- LangFuse `flush` 在请求结束后 fire-and-forget

---

## 不做(在架构层面确认)

- ❌ 多进程 worker(SQLite 写限制)
- ❌ Redis(v0 不需要,checkpoint 用 SQLite)
- ❌ Celery / RQ(v0 不做后台任务;v1 触发器用 APScheduler 独立进程)
- ❌ gRPC(SSE 足够)
- ❌ GraphQL(REST 足够,API 表面故意小)
