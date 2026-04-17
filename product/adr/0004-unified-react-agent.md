# ADR 0004 · 统一 React Agent,无 mode 字段

**日期:** 2026-04-17  **状态:** Accepted

## Context

用户需求提到"3 种员工模式":直接 / 计划(Plan)/ 主管(Supervisor)。常见做法是为每种模式维护独立的 LangGraph 架构(分别用 `create_react_agent` / `plan_and_execute` / `supervisor`)。这会导致:

- 三种 graph 的调试路径各异
- 数据模型里有 `mode` 字段,改模式 = 改架构
- 观测、Tool 约定、Checkpoint 都要分别处理

## Decision

**所有员工走同一条代码路径:`create_react_agent`(LangGraph prebuilt)。**

"模式"不是架构,而是**工具包预设**:

- **直接模式** = 业务工具集,无特殊工具
- **计划模式** = 业务工具 + `plan(goal) → steps`(一个 Tool)
- **主管模式** = 业务工具 + `dispatch_employee(name, task)` + `list_employees`(几个 Meta Tool)
- **Lead Agent** = 装全套 Meta Tool 的 React Agent

**数据模型里没有 `mode` 字段,只有:**
- `tool_ids[]`
- `skill_ids[]`(展开为额外 tool)
- `max_iterations`
- `system_prompt`
- `model_ref`

## Rationale

- **一种架构,所有员工**:调试路径、观测、checkpoint 完全统一
- **模式可自由组合**:同一员工可同时装 plan + dispatch,变成"计划+调度"混合模式
- **无架构性 mode 迁移成本**:改模式 = 改工具列表,无数据库 schema 变化
- **与 Tool First 自洽**:既然一切是 Tool,"能做计划"、"能调度"也只是 Tool

## Consequences

- **Plan / Supervisor 能力完全由 Tool 的 prompt description 驱动**,需要高质量的 Tool description
- **Lead Agent 的工具数量大** → prompt token 成本升高 → 需要"选择性加载"(未来优化)
- **前端 UI 不能简单按 mode 分 tab**,改为"员工列表 + 工具数量 badge"展示

## Alternatives considered

- **三种独立 LangGraph 架构** — 否:复杂度 3x,无架构收益
- **一个 mode 字段但共用代码** — 冗余,mode 字段没有实际分派作用
