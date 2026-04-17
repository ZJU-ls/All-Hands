# ADR 0003 · Tool First 架构

**日期:** 2026-04-17  **状态:** Accepted

## Context

Agent 平台常见做法是把"能力"分类:LLM / Tool / Workflow / Knowledge / UI 页面。这导致每类能力有独立的数据模型、API、UI、扩展点,代码膨胀、认知负担重。我们要做的是**把"能力"统一为一个抽象**。

## Decision

**一切能力皆 Tool**。三种同构子类型:

1. **Backend Tool** — 有副作用(DB / 外部 API / 文件)
2. **Render Tool** — 返回 `{component, props, interactions}`,前端 ComponentRegistry 映射
3. **Meta Tool** — 操作平台自身(员工、Skill、MCP 的 CRUD、派遣)

所有 Tool 共享:
- 统一 Pydantic `Tool` 模型(`id, kind, name, description, input/output_schema, scope, requires_confirmation`)
- 统一 `ToolRegistry` 注册
- 统一 `ConfirmationPolicy` 审批
- 统一 LangFuse trace
- 统一 audit log

## Rationale

- **抽象压缩到最小**:Agent 看到的只是"工具列表",不区分能力类别
- **前端无专用配置页**:所有 CRUD 由 Lead Agent 通过 Meta Tool + Render Tool 动态展示
- **新增能力 = 注册新 Tool**:零核心代码改动
- **语义对齐 MCP 协议**:天然与 MCP 生态兼容
- **驾驶舱 v1 迁移零成本**:v0 的 `render_system_status` 直接升级为顶层路由

## Consequences

- **Lead Agent 工具集会很大**(20+ Meta Tool 起步)→ 需要按需加载 / prompt 里精选
- **Render Tool 的 props schema 与前端组件强耦合**→ 必须有 schema 对齐测试
- **Meta Tool 的 scope 与 confirmation 规则必须严格**,否则 L4 全对话操作会失控

## Alternatives considered

- **节点式(LangFlow / n8n)** — 否:前端工作量大,新能力需要改可视化编辑器
- **Action / Function 分层** — 否:本质仍是"能力分类",违背压缩原则
