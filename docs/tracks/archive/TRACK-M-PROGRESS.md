# Track M Progress Log

Track M scope · I-0022 · Skill 动态注入 + spawn_subagent + plan 模式
Branch · `dynamic-skill-injection`
Worktree · `/Volumes/Storage/code/allhands-track-c`(复用 Track C 的壳)
Base commit · `d33a689`

---

## 2026-04-19 · Phase 0 done · 等 Track L + 用户签字

**Delivered · commit 1**

- [`docs/specs/agent-runtime-contract.md`](docs/specs/agent-runtime-contract.md)
  · 300+ 行契约 spec · preset(execute / plan / plan_with_subagent)定义 + 展开算法
  · `resolve_skill` / `spawn_subagent` / `render_plan` tool 完整契约
  · `sk_planner` / `sk_executor_spawn` 两个新 skill
  · AgentRunner 生命周期变更(bootstrap + 每轮重建 + 动态注入)
  · Observability 嵌套 trace 契约
  · L01 Tool First 对偶表
  · `ref-src-claude` 引用映射表(V02 / V04 / V05 / V10)
  · 红线映射(§3.2 禁 `mode` · §3.3 Gate · §3.4 分层 import)

- Phase 1/2 测试 skip-placeholder(PR 后面 wave 来 flip green):
  - [`backend/tests/integration/test_resolve_skill_mid_turn.py`](backend/tests/integration/test_resolve_skill_mid_turn.py)
  - [`backend/tests/integration/test_spawn_subagent_isolated_memory.py`](backend/tests/integration/test_spawn_subagent_isolated_memory.py)
  - [`backend/tests/unit/test_skill_registry_lazy.py`](backend/tests/unit/test_skill_registry_lazy.py)

**Key decisions (签字点 · 有异议请在此停下)**

1. **红线 R1**:preset 不落字段 · 仅在 Employee 创建 service 层一次性展开为 `tool_ids + skill_ids + max_iterations`
2. **三个 v0 preset**:`execute` / `plan` / `plan_with_subagent`(是否要第四个 `lead`? 建议否 · `is_lead_agent=true` 已是独立维度)
3. **PlanCard vs PlanTimeline 并存**:PlanTimeline = agent 内部进度 memo;PlanCard = 需人工 approve 的契约卡 · 不合并
4. **subagent 嵌套约束**:v0 不允许子 agent 再 spawn 子 agent(参考 `ref-src-claude/V10` § 4.5)
5. **resolve_skill 幂等 + per-runner 局部**:重复调只注入一次 · 不跨 subagent
6. **Token 预期**:挂 10 skill 员工 system prompt 从 ~3000 → ~600(验收标准)

**开放问题(待 Track L UI 反馈 · § 12.2)**

- Q6 · 员工设计页选 preset 后是否自动填 tool_ids/skill_ids 但允许手工增删?
- Q7 · `plan_with_subagent` 默认 `max_iterations=20` 是否过高?
- Q8 · Approve 按钮是否自带"继续"语义(无需再发 "继续" message)?

**下一步(待签字后启动)**

Phase 1 · 重写 `expand_skills_to_tools` → `bootstrap_employee_runtime` + 实现 `resolve_skill` meta tool + AgentRunner 支持 mid-turn tools[] 扩展。

---

**STATUS · M Phase 0 done · 等 Track L + 用户签字 · 暂停中**
