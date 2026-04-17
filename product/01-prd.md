# 01 · Product Requirements Document (PRD)

> 范围:**allhands v0 MVP**。v1+ 在 `05-roadmap.md`。

---

## 1. 产品定位

见 `00-north-star.md`。简化复述:对话式的数字员工组织平台。用户只跟 Lead Agent 对话,其他全部可以通过 Lead Agent 完成。

---

## 2. 核心概念词表

| 术语 | 定义 |
|---|---|
| **Employee(员工)** | 一个配置好的 React Agent:`{system_prompt, tools, skills, max_iterations, model_ref}` |
| **Lead Agent** | 全局 singleton 员工,装有**全套 Meta Tools**,是用户的唯一入口 |
| **Tool** | 三类能力单元(Backend / Render / Meta),共享统一 schema 和注册机制 |
| **Skill** | `tools[] + prompt_fragment` 打包,方便员工复用一组能力 |
| **MCP Server** | 外部工具提供方,握手后其工具进入 ToolRegistry |
| **Conversation** | 用户与某个员工的一场对话,含消息历史和嵌套执行 |
| **Confirmation Gate** | 敏感/不可逆操作执行前的用户显式确认 |
| **Render Payload** | `{component, props, interactions}`,由 Render Tool 返回,前端映射组件渲染 |
| **Trace Ref** | LangFuse trace 的引用,用于从消息跳转到完整观测视图 |

---

## 3. MVP v0 功能地图

### P0(必做,缺一不可)

1. **Lead Agent 对话入口**
   - 单进程 singleton
   - 装有 Meta Tools 全集
   - 对话式流式响应(SSE)

2. **员工 CRUD(Meta Tool 形式)**
   - `create_employee`(需 confirmation)
   - `list_employees`
   - `get_employee_detail`
   - `update_employee`(需 confirmation)
   - `delete_employee`(强 confirmation + diff)

3. **员工对话与派遣(Meta Tool 形式)**
   - `dispatch_employee(name, task)` — Lead Agent 派任务给员工
   - `chat_with_employee_direct(employee_id, message)` — 用户 UI 直连员工(debug / 独立使用)

4. **Tool 注册表**
   - 三类 Tool(Backend/Render/Meta)同构注册
   - JSON Schema 描述 input/output
   - Confirmation Policy 按 scope 分级

5. **Skill 系统**
   - `skills/` 目录自动扫描
   - 初始 Skill 集合(最小):`web_research`、`file_writing`
   - Skill 绑到员工后展开为 Tool 集合

6. **MCP 挂载**
   - 支持 stdio + SSE + HTTP 三种 transport
   - 运行时握手、健康检查
   - MCP 工具自动进入 ToolRegistry

7. **模型接入(v0 最小)**
   - OpenAI-compatible 协议(`base_url` + `api_key`)
   - 单一 ModelGateway 实现,配置写死在 env
   - 模型参数(temperature, max_tokens)可在员工级别覆盖

8. **Confirmation Gate**
   - 分 scope:READ / WRITE / IRREVERSIBLE / BOOTSTRAP
   - WRITE 以上需用户确认
   - IRREVERSIBLE 要求展示 diff
   - BOOTSTRAP 要求"写候选版本 + 显式切换"

9. **对话 UI**
   - 主界面:跟 Lead Agent 对话
   - 可切换:直连某个员工对话
   - 气泡 + 流式 token + Tool Call 展开 + Render 内联组件
   - Confirmation 弹窗

10. **观测(LangFuse)**
    - 每条对话、每次 tool 调用、每次 LLM 调用产生 trace
    - 嵌套 trace(Lead Agent → 子员工 → 工具)保留父子关系
    - 每条消息带 trace link,点击跳到 LangFuse

11. **SQLite 持久化**
    - 员工、对话、消息、ToolCall、Confirmation、MCP、Skill 全部持久
    - WAL 模式,`AsyncSqliteSaver` 做 LangGraph checkpoint

12. **Docker Compose 交付**
    - `docker compose up` 一键起 `backend + web + langfuse 全家桶`
    - 无外部依赖(除 LLM API)

### P1(MVP 内可选,时间紧可推到 v0.1)

- **MCP 健康监控显示**(UI 可见 MCP 状态)
- **员工导入/导出** JSON,方便分享
- **会话历史检索**(按员工、按时间)
- **Trace 内联预览**(不跳转也能看嵌套 trace)

### P2+(推到 v1+)

- 触发器引擎、驾驶舱独立页、模型网关 UI、Skill 市场、多用户账号、多租户

---

## 4. 权限与安全(L4 护栏详细化)

### 4.1 工具 scope 与 confirmation 对应关系

| Tool Scope | 默认 `requires_confirmation` | UI 表现 |
|---|---|---|
| `READ` | `false` | 无弹窗 |
| `WRITE` | `true` | 弹窗:操作摘要 + yes/no |
| `IRREVERSIBLE` | `true` | 弹窗:摘要 + **必填 diff**(before/after)+ 双重确认(输入员工名或关键字) |
| `BOOTSTRAP` | `true` | 弹窗:**写候选版本 + 显式切换**流程。旧版本保留 30 天可回滚 |

**运营者策略覆盖(`config.yaml` / 环境变量):**
- 允许把 `WRITE` 全局提升到"逐次确认" or 降级为"session 内首次确认"(v1)
- 不允许把 `IRREVERSIBLE` / `BOOTSTRAP` 降级

### 4.2 审计

**所有 confirmation 决议 + 敏感操作**写入 `audit_events` 表:
- `timestamp, tool_id, employee_id, conversation_id, args, result, user_decision, trace_id`

### 4.3 Secret 管理

- API key、LangFuse key 从 `.env` 读取,**不入库、不回传 UI、不出现在 trace**
- Render Payload 过滤 pipeline 统一剥离 `*_key`、`*_token`、`authorization` 字段

### 4.4 自举防护

- Lead Agent 改自己的 `system_prompt` / `tools` → 写入 `lead_agent_versions` 表,当前生效版本通过 `lead_agent_active_version` 指针
- 用户必须显式走 "switch to version N" 才切换
- 旧版本保留 ≥ 30 天
- "创建新的 Lead Agent" 不允许(v0 只有一个 Lead,`is_lead_agent=True` 唯一性在 DB 约束)

---

## 5. 关键用户旅程:MVP 验收 demo

**北极星任务:**

```
用户在对话框:
  "帮我调研 LangGraph 和 CrewAI 的对比,产出一份 markdown 报告。"

Lead Agent:
  1. (tool) list_employees() → 返回 [] (新系统无员工)
  2. (tool) create_employee(name="Researcher", system_prompt="...",
         skill_ids=["web_research"], max_iterations=10)
       → [Confirmation Gate] 弹窗,用户点"Yes"
  3. (tool) create_employee(name="Writer", system_prompt="...",
         tool_ids=[], max_iterations=5)
       → [Confirmation Gate] 用户点"Yes"
  4. (tool) dispatch_employee(name="Researcher",
         task="调研 LangGraph 的定位、优势、局限,给 5-10 条要点")
       → 嵌套执行:Researcher(React) 调 web_search 3 次
       → 返回 notes_A
  5. (tool) dispatch_employee(name="Researcher",
         task="同样调研 CrewAI")
       → notes_B
  6. (tool) dispatch_employee(name="Writer",
         task="把 notes_A 和 notes_B 写成对比报告",
         context={notes_A, notes_B})
       → report.md
  7. (tool) render_markdown(content=report.md)
       → 对话里内联展示,带复制按钮
  8. 文字回复:"我已经产出对比报告,你可以直接复制或让 Writer 继续改。"

UI 全程可见:
  - Lead Agent 的每一步 tool call(折叠式展开)
  - 每个 Confirmation 弹窗
  - 嵌套子员工的 React loop
  - LangFuse 链接可点,跳到完整嵌套 trace

验收标准:
  - 端到端耗时 ≤ 5 min
  - 累计 LLM 成本 ≤ $0.50(GPT-4o-mini 或同级)
  - 无错误、无 loop 爆(max_iterations 未耗尽)
  - LangFuse 中 trace 完整、嵌套关系正确
```

---

## 6. 错误处理与边界条件

| 场景 | 行为 |
|---|---|
| 员工 `max_iterations` 耗尽 | 停止,返回"循环上限已到,当前进度:..." |
| Tool 调用失败(网络/超时/异常) | 标记 `ToolCall.status=failed`,把 error 回给 Agent,Agent 决定是否重试(v0 不做自动重试策略,交给 LLM 自判) |
| MCP Server 握手失败 | `health=unreachable`,该 server 的工具从 Registry 暂时摘除,Lead Agent 看到时提示 |
| Confirmation 超时 | 默认 `confirmation_timeout=10min`,过期后 `status=expired`,ToolCall 标记失败 |
| 用户 reject confirmation | `ToolCall.status=rejected`,Agent 收到"用户拒绝了这次操作"作为 tool 结果,自行决定下一步 |
| 循环引用(员工 A 派员工 B 派员工 A) | 执行层维护"call stack",超过深度 5 层直接拒绝 |
| LLM 返回无效 JSON / schema 不符 | 自动重试 1 次(放回 LLM 并附带 error),仍失败则失败 |
| 模型返回 context length 错误 | 失败,返回给 Agent,不做自动截断 |

---

## 7. 性能要求(MVP)

| 指标 | 目标 | 备注 |
|---|---|---|
| 首 token 延迟(P95) | ≤ 2s | OpenAI-compat gpt-4o-mini 级 |
| 端到端 demo 完成 | ≤ 5 min | 见 §5 |
| 并发对话 | ≥ 5 | SQLite WAL + async 够 |
| SQLite 数据库大小 | ≤ 100 MB (1000 对话量级) | v0 不做压缩 |

---

## 8. 依赖与假设

**假设用户:**
- 已有 OpenAI-compatible 模型服务和 API key
- 有 Docker + Docker Compose
- 跑在 Linux / macOS / WSL2

**外部依赖:**
- LLM API(用户提供 URL + key)
- LangFuse(内嵌在 docker compose,开箱即用)

**不依赖:**
- 任何云服务、向量数据库、Redis

---

## 9. 验收标准总览

MVP v0 发布判断:

- [ ] §5 北极星任务完整跑通 3 次,成功率 ≥ 2/3
- [ ] 所有 P0 功能点实现且有至少 1 个测试
- [ ] `docker compose up` 在干净机器上 ≤ 5 min 启动完成
- [ ] README 有 quick start,外部用户照做能跑通
- [ ] 所有文档(`product/*.md`)与实现一致
- [ ] Lint / mypy / tests 全绿
- [ ] 至少 1 个外部 MCP 成功挂载(web_search via Brave / Tavily MCP)
