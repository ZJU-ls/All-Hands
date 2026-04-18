# ADR 0008 · Gateway / Skill / MCP 统一交付

**日期:** 2026-04-18  **状态:** Accepted

## Context

Roadmap 原计划把三块独立能力分别放进不同版本:

- **v1.3** · Gateway 打磨(LLM Provider / Model 管理)
- **v3.1** · Skill 市场与本地安装
- **v3.2** · MCP 服务器管理 + 对话式调用

2026-04-18 把 L01 · Tool First **扩展**为「Lead Agent 全知全能 = 平台能力都要有对应 Meta Tool」(见 `docs/claude/learnings.md` L01 扩展版 · CLAUDE.md §3.1)。扩展后,Agent-managed 资源的 REST 写入 **必须** 有语义等价的 Meta Tool——这不是 v3.1/v3.2 专属约束,Gateway 里刚上的 Provider / Model CRUD 也适用。

如果分三个版本串行推,每次都要:① 设计路由;② 写 Service;③ 单独补 Meta Tool;④ 前端页面;⑤ 回归 L01。三份脚手架几乎相同,串行做会反复改口径和重构 `tests/unit/test_learnings.py::TestL01ToolFirstBoundary`。

## Decision

把 Gateway 打磨 + Skill 全栈 + MCP 全栈合并为单一 plan `plans/2026-04-18-gateway-skill-mcp.md`,按四个 Task 串行交付,**每个 Task 都遵循同一个模板**:

1. `core/<resource>.py` 领域模型(如需)
2. `persistence/` ORM + `SqlXxxRepo`(如需) + migration
3. `services/<resource>_service.py` 业务逻辑(单一事实源)
4. `api/routers/<resources>.py` REST 入口(UI 直调)
5. `execution/tools/meta/<resource>_tools.py` Meta Tool 入口(Lead Agent 对话)
6. `web/app/<resource>/page.tsx` 三态 + ConfirmDialog + token-only Tailwind
7. `tests/unit/test_<resource>_meta_tools.py` + `test_<resource>_service.py` + `tests/integration/test_<resource>_router.py` + `tests/e2e/<resource>.spec.ts`

### 已落地的成对关系(L01 回归)

| 资源 | Router | Meta Tools | 状态 |
|---|---|---|---|
| LLM Provider | `routers/providers.py` | `meta/provider_tools.py` | ✅ |
| LLM Model | `routers/models.py` | `meta/model_tools.py` | ✅ |
| Skill | `routers/skills.py` | `meta/skill_tools.py` | ✅ |
| MCP Server | `routers/mcp_servers.py` | `meta/mcp_server_tools.py` | ✅ |

`tests/unit/test_learnings.py::TestL01ToolFirstBoundary` 对 Agent-managed 路由扫描,自动拉出 `resource_stem` 并要求 `execution/tools/meta/<stem>_tools.py` 存在(或 `<router_stem>_tools.py`)。`KNOWN_GAP_ROUTERS` 集合已清空。

## Rationale

- **一次对齐成本低于三次返工**。L01 扩展版明确 "两个入口必须成对",单 plan 四 Task 保证脚手架一次画对,后续 Agent-managed 资源(比如 v4 的 "员工模板市场")按此模板复用
- **Meta Tool naming 统一**。`allhands.meta.<verb>_<resource>`,WRITE/IRREVERSIBLE → `requires_confirmation=True`;外部副作用(MCP `invoke_tool` / Skill 安装)一律 WRITE + confirm
- **上线节奏可控**。三块能力独立,任一 Task 踩坑不影响其他;commit 按 Task 粒度分 4 次,回滚友好
- **UX 三态 + ConfirmDialog 契约同步落地**。每个页面 loading / error / empty + `ConfirmDialog`(非 `window.confirm`)+ Escape 键盘可达;`tests/routes-smoke.test.ts` + e2e 双层守护

## Consequences

- **后续 Agent-managed 资源必须按此模板** — 在 plan 里显式列 "7 步 + 配对测试",reviewer 按此清单打回
- **Meta Tool 文件名由 L01 回归决定**(不是人拍脑袋)。命名要让 `router_stem.rstrip("s") + "_tools.py"` 或 `router_stem + "_tools.py"` 能直接匹配;违反就上不了 CI
- **Router 增多时 `api/app.py` 线性膨胀** — 接受;v1 再考虑 auto-discovery,暂时 YAGNI
- **`test_learnings.py::KNOWN_GAP_ROUTERS` 从此只应为空集**。任何情况下往它加 router = 宣告 L01 被破坏,必须在同一 PR 里带修复计划

## Alternatives considered

- **分三版本串行(原 roadmap)** — 否:每轮都要改 L01 回归集、前端模板、Meta Tool 注册点,返工成本远高于一次合并
- **只做 UI 不做 Meta Tool** — 否:直接违反 L01 扩展版,Lead Agent 无法做用户能做的事,是架构退化
- **Meta Tool 用 codegen 从 OpenAPI schema 自动生成** — 否(v0):descriptions / confirmation scope 是人写的语义,生成出来质量低;v2+ 若 Tool 数膨胀再评估
- **把 MCP 对话式调用推迟到 v3.2** — 否:`invoke_mcp_server_tool` 是 L4 对话式操作的灵魂示例,推迟等于承认 L01 是空话

## Related

- CLAUDE.md §3.1 (L01 扩展版)
- ADR 0003 · Tool First 架构 / ADR 0005 · Lead Agent L4 scope
- `docs/claude/learnings.md` L01
- `plans/2026-04-18-gateway-skill-mcp.md`
