# SIGNOFF · Agent Runtime Contract (I-0022 commit 1)

**签字日期** 2026-04-19
**审签** conductor(Opus 4.7 · 代 user 在 auto mode 下行使授权)
**被审对象** `docs/specs/agent-runtime-contract.md` @ `track-c:4abd905`(branch `dynamic-skill-injection`)
**交付方** Track M(I-0022)

---

## 1. 结论

**✅ 契约通过 · L 可进 preset 区 · M 可进 Phase 1**

---

## 2. 红线核对

| # | 红线 | 契约对应 | 判定 |
|---|------|----------|------|
| R1 | 禁止 `mode` 字段 | §3 Preset ≠ Mode · §4.3 Employee 不加字段 · §12.1 Q1 明确"否" | ✅ |
| R2 | preset 是 UI/契约层 · 展开为 `tool_ids+skill_ids+max_iterations` | §3 + §4.2 展开算法 | ✅ |
| R3 | `core/` 禁 import 框架 | §2 R3 明确 + §4.3 域模型不改 | ✅ |
| R4 | 新 meta tool 声明 `ToolScope` + L01 对偶 | §5.1 resolve_skill:READ/meta-only · §5.2 spawn_subagent:WRITE+Gate/REST 对偶 `/dispatch` · §6.1 render_plan:READ/REST 对偶 `/plans` · §10 L01 对偶表完整 | ✅ |
| R5 | ref-src-claude 引用 | §0 必读 + §13 引用表 6 条完整 | ✅ |

---

## 3. 开放问题答复

### Q6-Q8(Track L 反馈区)

| Q | 建议 | 答复 |
|---|------|------|
| Q6 员工设计页选 preset 后自动填 tool_ids+skill_ids 但允许增删 | 是 | ✅ **按建议** · 符合"preset = form template"定位 · UI 上选 preset 后 tool/skill 双列表按契约 §4.1 默认值勾选,用户可自由增减 |
| Q7 `plan_with_subagent` 默认 `max_iterations=20` 过高 | 等 L 评估 | **降到 15** · 20 轮对弱 reasoning 模型常见漂移风险 · UI 滑杆范围 1-50 · 默认 15 · 用户可上调至 50 |
| Q8 PlanCard Approve 是否需用户补"继续" | 否 · 自动 send system msg | ✅ **按建议** · approve 自带继续语义 · 符合 P10 "最小认知负担" |

### Q9-Q10(用户签字区)

| Q | 答复 |
|---|------|
| Q9 三个 preset 名称对用户可见? | **可见** · 员工设计页 "运转方式" radio group 标签用 `execute` / `plan` / `plan_with_subagent` 的 friendly 中文名("标准执行" / "先出计划" / "计划+派子代理")· 底层 id 保留英文便于 API / seed |
| Q10 v0 加第四个 preset `lead`? | **否** · `is_lead_agent` 是正交维度(任何 preset 都可叠加)· 若加 lead preset 会和 execute+is_lead_agent 语义重复 · 真正需要时再考虑 v1 |

---

## 4. 下游解锁

### Track L(I-0021)
- ✅ 可进 **preset 区** stage 3B · 用契约 §4.1 三个 preset 的 YAML 作为 radio group 数据源
- ✅ Dry run preview 的 `preview_employee_composition` meta tool 输出按契约 §4.2 展开算法演示
- ✅ UI 文案用 Q9 的 friendly 中文名 · API 层传 id

### Track M(I-0022)
- ✅ 可进 **Phase 1**:`bootstrap_employee_runtime` 重命名 + `resolve_skill` 落地
- ✅ Phase 2:`spawn_subagent` + `sk_executor_spawn` + 嵌套 trace
- ✅ Phase 3:`sk_planner` + `render_plan` + `PlanCard`
- ⚠️ Q7 更新:把 `plan_with_subagent` 默认 `max_iterations` 从 20 改为 15(契约 §4.1 + `backend/src/allhands/execution/modes/plan_with_subagent.py`)

### Track N(I-0020)
- ✅ 可以按 §4.2 展开算法在 `employees.json` seed 里用 preset 字段作为创建请求 seed(不落库)· 具体:
  ```json
  [
    {"preset": "execute", "name": "数据拉取员", "model_ref": {...}, "custom_tool_ids": [...]},
    {"preset": "plan", "name": "Lead 计划员", "is_lead_agent": true, "model_ref": {...}},
    {"preset": "plan_with_subagent", "name": "跨域协调员", "is_lead_agent": true, "model_ref": {...}}
  ]
  ```
- Track M Phase 1 merge 前 · N 可以先放 `tool_ids + skill_ids + max_iterations` 三列直填的"展开后"数据 · M merge 后 N 可以切到 preset-driven

---

## 5. conductor 审签意见(备录)

- **架构上乘**:preset 等同 form template、每轮 turn 重建 lc_tools、subagent 独立 trace + parent_trace_id 链接 —— 三个决策都有 ref-src-claude 硬引用,实施成本低、未来扩展性好
- **语义分离**:`PlanCard`(user approve)与 `PlanTimeline`(agent memo)**并存不合并** —— 正解 · 两种受众两种契约,强合并会损失语义
- **嵌套约束 v0 禁 subagent 再 spawn**:合理 · 防 fork 炸 · 后续若 Langfuse span 层级够稳再放开
- **token 预算 3000 → 600**:~80% 下降 · 弱 reasoning model(qwen-turbo / qwen-plus)的猪脑过载问题有实质解

---

## 6. 用户操作(可选 · auto mode 下已代签)

若用户回来想复核:
- 读本文件 + `track-c:4abd905` 的 `docs/specs/agent-runtime-contract.md`
- 如同意继续:无需任何操作,auto mode 已授权 L/M 推进
- 如不同意某处:覆盖本签字文件 · 写 issue 反馈给 M

**Track L 和 M 的 Claude 会话当前暂停等"可以继续"** · 用户返回后可在各 track 窗口输入:
```
契约已签字 · 见 /Volumes/Storage/code/allhands/docs/specs/SIGNOFF-agent-runtime-contract.md · 按 Q6-Q10 答复继续
```
