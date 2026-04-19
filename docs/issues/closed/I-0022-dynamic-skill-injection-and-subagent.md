---
id: I-0022
severity: P0
status: closed
closed_at: 2026-04-19
closed_by: track-m
title: Skill 作为 Tool 动态注入(而非 pre-load 全量)+ Subagent spawn + Plan 模式 · 参考 ref-src-claude
affects: backend/execution/skills.py · agent_runner.py · core/tool.py · 新 backend/execution/modes/* · 新 meta tool `spawn_subagent` · 新 skill `sk_planner` / `sk_executor_spawn`
discovered: 2026-04-19 / user-product-review
blocker-for: I-0021(员工设计页运转方式)· Wave-3 reasoning-light model 可用性
tags: backend, agent-runtime, arch, meta-tool
---

## Repro

1. 创建一个挂载了大量 skill 的员工(例如 10 个 skill,每个 skill 携带 3-5 个 tool → 总计 30+ tool)
2. 用弱 reasoning model 跑(例如 `qwen-turbo`)
3. 观察到:**tool schema 全部 pre-load 到 system message**,输入 token 过载,模型"猪脑过载"表现:工具调用乱套 / reasoning 丢失 / 偏题
4. 对比:Claude Code(`ref-src-claude`)的 Skills 是**声明但不 pre-load**,由 Claude 通过 `Skill` meta tool 按需 resolve

## Expected

**Phase 1 · 动态 skill 注入(把 skill 从 pre-load 改成 on-demand)**

- Skill 不再在 agent bootstrap 时通过 `expand_skills_to_tools()` 一次性把所有 tool 灌进 system message
- 改成:
  - Employee bootstrap 只注入**一个** meta tool `resolve_skill(skill_id)` · 参数是已挂载的 skill_id(可选 enum)
  - Lead Agent 决定需要时调用 `resolve_skill("sk_research")` → 动态把 `sk_research` 的 tool_ids + prompt_fragment **注入当前轮对话上下文**(不存库,本轮有效)
  - 已挂载 skill 的 **descriptor**(id / name / description)作为静态清单放到 system message(短,不爆)
- 参考 `ref-src-claude`:
  - `ref-src-claude/volumes/V04-tool-call-mechanism.md`(Tool scope / 注册 / 动态暴露)
  - `ref-src-claude/INDEX.md` → Skills 体系章节(Skill auto-discovery + on-demand loading)
- 适配层:LangGraph `create_react_agent` 要支持"对话中途扩展 tools[]"· 可能要写 wrapper(参考现有 `AgentRunner`)

**Phase 2 · Subagent spawn(Plan + Subagent 模式)**

- 新 meta tool `spawn_subagent(profile, task, return_format)`:
  - 参考 `ref-src-claude` 的 `Task` tool(V04 / V0N 里的 sub-agent pattern)
  - 启一个独立 `AgentRunner` 实例 · 独立 memory scope · 跑完返回结构化结果
  - profile 可选:`execute` / `plan` / 自定义 employee_slug
- 新 skill `sk_executor_spawn` · 挂载此 tool + prompt fragment 教 agent 何时用
- 父 agent 的 trace 记录 subagent 的 trace id(嵌套 trace · 在 `/traces` 页可展开)

**Phase 3 · Plan 模式(只输出计划,不动工)**

- 新 skill `sk_planner` · prompt fragment 约束:必须**先输出完整 plan**(用 `render_plan` tool · 需新建)· 用户确认后才继续
- 新 render tool `render_plan` · 返回 `{component: "PlanCard", props: {steps: [...]}}`
- 前端 `web/components/render/PlanCard.tsx` · 读 plan 展示 · 带 approve / reject / edit 按钮(approve 回发确认事件)

**Phase 0(前置 · 必须最先做)· Runtime 契约文件**

- commit 1(**停下来等用户 + Track L 签字**):`docs/specs/agent-runtime-contract.md`
- 内容:
  ```yaml
  employee_preset:
    execute:
      tool_ids: [allhands.builtin.fetch_url, allhands.builtin.write_file]
      skill_ids_whitelist: ["sk_research", "sk_write"]
      max_iterations: 10
    plan:
      tool_ids: [allhands.builtin.render_plan]
      skill_ids_whitelist: ["sk_planner"]
      max_iterations: 3
    plan_with_subagent:
      tool_ids: [allhands.builtin.render_plan, allhands.meta.spawn_subagent]
      skill_ids_whitelist: ["sk_planner", "sk_executor_spawn"]
      max_iterations: 20

  meta_tool:
    resolve_skill:
      description: "Dynamically inject a skill's tools + prompt fragment into this turn"
      input: { skill_id: string }
      output: { tool_ids: [string], prompt_fragment: string }
      scope: READ
    spawn_subagent:
      description: "Run a subordinate agent on a scoped task and return its result"
      input: { profile: enum, task: string, return_format: string }
      output: { result: object, trace_id: string }
      scope: WRITE  # 有 side effect,经 ConfirmationGate
  ```
- 这份契约 Track L(I-0021)读后才能做运转方式区 UI · **所以必须最先产出**

## Actual

- `backend/src/allhands/execution/skills.py:88 expand_skills_to_tools()` 在 employee bootstrap 时**一次性**把所有 skill 的 tools + fragments 展开到 `tools[] + system_prompt`
- 没有 `spawn_subagent` / `sk_planner` / `render_plan`
- `qwen-turbo` / `qwen-plus` 等 reasoning-light model 在 6+ skill 挂载下表现明显降级

## 评估方向 / 参考源码

**必查 `ref-src-claude`(CLAUDE.md 硬规则):**

- `ref-src-claude/INDEX.md` → 找到 Skills 章节(auto-discovery · lazy-load 模式)
- `ref-src-claude/volumes/V04-tool-call-mechanism.md` → Tool scope + 动态暴露机制
- `ref-src-claude/volumes/V02-*`(Query/Agent 内核)→ AsyncGenerator 主循环如何在轮内扩展 context
- `ref-src-claude` 里 `Task` tool 实现 → subagent 隔离、返回协议
- 笔记写进 commit message(reference-sources.md §4 要求)

## 硬约束

- **禁止**在 employee / session 表加 `mode` 字段(CLAUDE.md §3.2 · 本 track 是高危区,因为"运转方式"这个词很像 mode · 一定不能落字段)
- 运转方式 = preset 是 **UI/契约层概念** · 落库时展开为 `tool_ids + skill_ids + max_iterations`
- `core/` 禁止 import sqlalchemy / fastapi / langgraph / langchain / openai(§3.4)
- 新 meta tool 声明 `scope` + 经 ConfirmationGate(§3.3)
- **必须先看 ref-src-claude 再写代码**(reference-sources.md §4 必查场景 1/2/3)

## 验收标准

- [x] commit 1 · `docs/specs/agent-runtime-contract.md` 交付 · 停下来等 Track L + 用户签字 → Q6/Q7/Q9 签字 delta 已 commit `22cd3f5`
- [x] Phase 1 · `resolve_skill` meta tool 落地 · `AgentRunner` 支持轮内动态扩 tools[] · 回归测试 `tests/integration/test_resolve_skill_mid_turn.py`(5 cases) 绿
- [x] Phase 1 · 改前后对比:挂载所有 skill 的员工,system prompt token `1752 → 140`(92% 缩减 · 见 `TRACK-M-DONE.md` 复现脚本)
- [x] Phase 2 · `spawn_subagent` meta tool + `sk_executor_spawn` skill · 回归测试 `tests/integration/test_spawn_subagent_isolated_memory.py`(10 cases · 含 v0 深度上限 + `parent_run_id` 嵌套追踪)绿
- [x] Phase 3 · `sk_planner` + `render_plan` + `PlanCard` · 回归测试 `tests/unit/test_render_plan.py`(8 cases)+ `web/tests/plan-card.test.tsx`(5 cases)绿;e2e playwright 跟进另开(同一契约已被 unit + 组件层覆盖)
- [x] 3 个 preset 在 `execution/modes/{execute,plan,plan_with_subagent}.py` 实现为配置字典(不是类继承)· 每个 preset ≤ 30 行(实际 20/20/21 行)
- [x] `test_learnings.py::TestL01ToolFirstBoundary` 通过 · `resolve_skill` / `spawn_subagent` 按 meta-only 归档(spec § 10),`render_plan` 复用既有 `/plans` REST 对偶
- [x] `./scripts/check.sh` 全绿 · 包含 `lint-imports`(分层边界 · 3 contracts kept)
- [ ] **Seed 数据**:与 I-0020 协作,留给 Track N 随 seed 基础设施交付(本 track 不阻塞关闭;运行时契约已就位)

## 相关

- **被依赖**:I-0021(员工设计页)· M 的 commit 1 契约交付是 L 的前置
- **参考源码**:`ref-src-claude`(必查)· V02 / V04 / Skills 章节 / Task tool
- **L01 Tool First**:所有新 meta tool 遵守扩展版(Agent 能做的用户也能做 · REST 对偶 or 明确 meta-only)
- **§3.2**:运转方式不得落 mode 字段(红线)

## 关闭记录

- status: closed · closed_at: 2026-04-19 · closed_by: track-m
- branch: `dynamic-skill-injection` · head: `7db746d`
- commit chain: `4abd905` (spec) → `22cd3f5` (Q6/Q7/Q9 signoff) → `9b3ab60` (SkillRuntime) → `9a9efd1` (resolve_skill) → `715b25d` (per-turn rebuild) → `252b37c` (spawn_subagent) → `7db746d` (render_plan + PlanCard)
- full delivery report: `TRACK-M-DONE.md` (repo root) · includes token-budget proof, ref-src-claude citations per commit, `./scripts/check.sh` tail.
- Seed-data bullet (3 employees × 3 presets) handed off to **I-0020 / Track N** — runtime contract is in place so the seed just builds fixtures on top.
