# 05 · Roadmap

> 版本演进路径。每个版本独立一个 spec → plan → implementation 循环。

---

## v0 · MVP(当前目标)

**主轴:** 对话式 Lead Agent + 员工 CRUD + Supervisor 派遣 + 观测。

**Success metric:** 北极星任务 "调研 LangGraph vs CrewAI 产出报告" 在 5min / $0.50 内完成,LangFuse trace 完整。

**范围:** 见 `01-prd.md §3 MVP v0 功能地图`

**不在范围:** 触发器、驾驶舱独立页、模型网关 UI、Skill 市场、多用户、多租户

**预估:** 单人 4-6 周(含文档、测试、docker compose 打磨)

---

## v1 · 体验化

**主轴:** 让"数字员工常驻运营"成为现实。

### v1.1 · 触发器引擎

- **Cron 触发器** — `triggers` 表 + APScheduler 独立进程(通过 HTTP 调 backend API)
- **事件触发器** — webhook endpoint + 内部 event bus
- **触发器管理 Meta Tool** — Lead Agent 可 create/list/pause/delete 触发器
- **执行历史** — 每次触发的 conversation 记录,可回溯
- **Acceptance:** "每天 9 点让 Researcher 汇总昨天的 GitHub 活动发 Slack" 可通过对话配置完成

### v1.2 · 驾驶舱(独立页)

- 沿用 `render_system_status()` render tool,升级为顶层路由 `/dashboard`
- 视图:
  - 员工活动热力图(近 24h 每员工 dispatch 次数)
  - Tool 调用 TOP 10(成本、耗时、错误率)
  - LangFuse 快速跳转
  - 当前运行中的执行(可 kill)

### v1.3 · 模型网关抽象

> **状态:已合并于 ADR 0008**(2026-04-18)—— Gateway 的 Provider / Model Meta Tools + UI 与 Skill / MCP 三块一起在 `plans/2026-04-18-gateway-skill-mcp.md` 落地。

- 把 v0 写死的 OpenAI-compatible 升级为可配置多网关
- 数据模型:`ModelGateway` 表
- 支持协议:OpenAI、Anthropic、本地 Ollama(MVP 三协议足够)
- Meta Tool: `add_model_gateway`, `test_gateway_connection`
- 员工可选不同 gateway

### v1.4 · UX 打磨

- 长任务进度条(基于 `max_iterations` 剩余)
- 对话消息搜索
- 员工复制 / 模板化

---

## v2 · 自举与深度

**主轴:** Lead Agent 真正成为平台的"数字运营者"。

### v2.1 · 完整自举能力

- Lead Agent 可以:
  - `propose_tool(name, description, implementation_hint)` — 提案新 Tool(代码由维护者 review 后合并,不是真正让 LLM 写代码入库)
  - `propose_skill(bundle)` — 组合已有 Tool 生成新 Skill
  - `create_lead_agent_version` → `switch_lead_agent_version`(v0 已有雏形)
- 旧版本归档、diff 查看、回滚

### v2.2 · 深度观测

- **成本预算** — 员工 / 对话 / trigger 可设每日预算,超额报警
- **异常检测** — tool 错误率突增、loop max_iter 频繁触发
- **用户反馈循环** — "这条回答好/坏",反馈进 LangFuse score,驱动 prompt 迭代

### v2.3 · Audit / 合规

- 审计日志导出(CSV / JSONL)
- 敏感操作审批流(额外审批人)
- GDPR:按用户导出 / 删除数据(如果已有多用户)

---

## v3 · 生态

**主轴:** Skill / MCP 有社区,用户能贡献。

### v3.1 · Skill 市场

> **状态:已合并于 ADR 0008**(2026-04-18)—— Skill 全栈(GitHub / 官方市场 / 本地 .zip)已在 `plans/2026-04-18-gateway-skill-mcp.md` Task 2 落地;签名验证留给 v3 后续迭代。

- 公开 Skill 注册表(GitHub 仓库列表即可)
- UI 浏览 / 一键安装(Lead Agent 调 Meta Tool 完成)
- 版本管理、签名验证(避免恶意 Skill)

### v3.2 · MCP 市场

> **状态:已合并于 ADR 0008**(2026-04-18)—— MCP 服务器管理 + 对话式 invoke 已在 `plans/2026-04-18-gateway-skill-mcp.md` Task 3 落地;社区 curated list 留给 v3 后续。

- 同上,但聚焦 MCP 服务发现
- Awesome-MCP 风格的 curated list + 一键注册

### v3.3 · 多用户账号(可选)

- 本地账号 / OAuth(GitHub / Google)
- Per-user 的员工 scope(或保持全局共享)
- 审计带用户身份

---

## v4+ · SaaS(如果走)

- 多租户隔离
- 计费 / Usage 限流
- 企业 SSO
- 私有 MCP 市场

**本阶段不承诺,看 v0-v3 反响再决策。**

---

## 版本间依赖

```
v0 ──┬── v1.1 Trigger
     ├── v1.2 Dashboard (用 v0 Render Tool 基础)
     ├── v1.3 Model Gateway
     └── v1.4 UX
         ↓
     v2.1 Bootstrap (需 v1 稳)
     v2.2 Observability (需 v1.3 多 gateway 成本数据)
     v2.3 Audit
         ↓
     v3.1/3.2 Market
     v3.3 Multi-user
         ↓
     v4 SaaS
```

---

## 变更管理

- 每个小版本跟一份 `plans/XXXX-<topic>.md`
- 跨版本的架构性决策走 `product/adr/`
- 本文件的版本节奏由产品决策,不靠承诺日期驱动
