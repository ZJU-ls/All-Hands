# ADR 0021 · Tool / Skill 自解释 · 不打 prompt 补丁

**Status**: Accepted · 2026-04-27
**Driver**: round-22 全局 review · 用户反馈"出错了应该让 LLM 知道哪里错从而可以改正确"
**Supersedes**: 无 · 提升为第 9 条核心原则

---

## Context · 为什么需要这条原则

跑了 21 个 ADR + 几十轮迭代,我们一次次给 lead_agent.md 和工具 description 打补丁:

- 「**You must actually invoke this tool — do not write `resolve_skill(...)` as a chat message**」(resolve_skill description)
- 「**Anti-hallucination clause (CRITICAL)**: if your reply contains 「这是一个 X」「I've created X」 then **the assistant turn MUST contain an `artifact_create` tool_call**」(lead_agent.md 历史版本)
- 「**Hard rule for diagrams**: never write mxfile XML or mermaid source as a code block」
- 「**STOP talking** — do not stream progress updates」(tasks_create description)

这些补丁的共性:
1. 都是**模型行为偏好**(怎么说 / 不要说什么),不是**工具契约**(我吃什么 / 我做什么)
2. 都在错误地方(系统提示 / 工具 description),让一份知识散落多处
3. 都是**事后修补** —— 模型出问题了,加段警告希望下次别犯,而不是改 affordance

更糟的是:错误处理也是同样的"补丁"模式。Pydantic ValidationError 直接吐到 ToolMessage,LLM 读不出"哪个 field 错 / 该怎么写",只能瞎试。

## Decision · 第 9 条核心原则

**Tool / Skill 自解释 · 不打 prompt 补丁**

```
Tool 说契约:    我吃什么(input_schema · 类型 / required / enum) · 我做什么
                · 我的 scope · 是否需要确认 · returns 什么 shape
                — 一切都是声明式的 · 用 schema 表达 · 不用祈使句

Skill 说偏好:    决策树("用户在说 X → 用 kind=Y") · 行为指导(模糊请求先动手)
                · 常见坑 · 失败兜底 · 跨工具协议
                — 但仅在 LLM 进入"我要做这件事"上下文时才注入(resolve_skill)

Lead prompt:    身份 · 4 步通用 workflow(派遣 / 找能力 / 调用 / 简短说话)
                · capability-discovery 路由(L06)· welcome / voice
                — 不教具体工具用法 · 不当 cheatsheet

错误回 LLM:     结构化 ToolMessage · {error, field, expected, received, hint}
                — LLM 读完直接知道哪里错 / 怎么改 / 下一轮自纠
                · 不再吐 stack trace
```

**反面**(以下视为补丁,不应再写):

- ❌ 在 tool description 里写 "**You must**" / "**MUST**" / "do NOT chain"
- ❌ 在 lead_agent.md 里复述某个 tool 的用法(那是 tool description 该说的)
- ❌ 在 skill body 里复述工具的 scope / requires_confirmation(已是 schema 一部分)
- ❌ Pydantic ValidationError 直接吐回去
- ❌ 用 prompt instruction 解决可以用 enum / required / 类型约束解决的问题

**正面**(应该是常态):

- ✅ tool input_schema 用 `enum: [...]` 表达"只能是这几个" · LLM 选错 → ToolArgError 列出所有合法值
- ✅ tool description 用陈述句 "Returns X. Use after Y." · 不用"do not Z"
- ✅ skill body 用决策树 "用户在说 X → 用 Y" · 不用"必须先 Z"
- ✅ 错误回 envelope `{error, field, expected, received, hint}` · LLM 一眼能改
- ✅ 用 scope=WRITE + requires_confirmation=True 表达"危险操作要确认" · 不用 prompt 写"call this carefully"

## Mechanism · 实现路径(已在 round-22 实施)

1. `execution/tool_arg_validation.py` · `ToolArgError` + `coerce_and_validate(tool, kwargs)`
   - 必填缺失 / 类型不匹配 / enum 违规 → 结构化 envelope
   - stringified JSON 自动 coerce(LLM 高频小错宽容)
   - JSON parse error 摘要进 `received` 字段
2. `tool_pipeline.py` · 两条 path 都 catch `ToolArgError` · 走 `to_payload()`
3. 全 audit · 8 处补丁清理(见 `docs/principle-audit.md`)
4. lead_agent.md 砍 workspace state 段 + render hallucination 钳制 · 都下沉到对应 tool / skill

## Rationale · 为什么这是第一性原则

**信息论**: 同一份知识只在一处。Tool 说"我吃什么"是定义,prompt 复述是噪音。
**LLM 体验**: 模型看到错误能自纠 = 收敛快; 看到 stack trace = 瞎试 = 收敛慢。
**维护性**: 加新 tool 自动受益 schema 校验 + 结构化错误,不用每个作者记得加 try/except。
**架构纯度**: tool / skill / prompt 三层职责清晰,不漂移。

## Consequences

**好处**:
- 新工具开发零样板 · 声明 schema 即获得校验
- 工具描述可读性提升 · `description` 是真契约不是营销文案
- LLM 自纠成功率提升 · 一次错就改对,不再多轮试错
- 系统提示可瘦身 · lead_agent.md 已从 258 行 → 68 行

**代价**:
- 现有 8 处补丁要清理(round-22 已做完)
- 必须教育新贡献者:不要在 description 里写 "**MUST**" 类祈使句
- pin tests 需要保护这条原则不被回潮

## Alternatives 考虑过

1. **强提示词工程**(在 lead 提示里把所有 hack 写全)— 模型轮次越多失效率越高,prompt 不可维护
2. **依赖 Pydantic 错误**(让 ValidationError 自己说)— 错误格式不可预测,LLM 难以自纠
3. **在每个 tool 自己写 validation**(去 schema 化)— DRY 违反 + 错误格式不一致

都不如 schema-driven + 自解释错误干净。

## 落地清单(round-22 完成)

- [x] `tool_arg_validation.py` 模块 + 17 unit cases
- [x] `tool_pipeline.py` 接入 + 4 e2e cases
- [x] 8 处补丁清理(audit A1-A5 + B1-B2 + C1)
- [x] `lead_agent.md` 砍 workspace state + render hallucination
- [x] 这份 ADR + `north-star.md` / `CLAUDE.md` 第 9 条原则
- [x] `allhands.design` skill v1 (品牌设计语言下沉到 skill,不是 prompt)

## References

- `docs/principle-audit.md` — round-22 补丁清单
- `plans/principle-refactor-log.md` — round-22 实施日志
- `backend/src/allhands/execution/tool_arg_validation.py` — 实现
- `backend/tests/unit/test_tool_arg_validation.py` — 17 cases
- `backend/tests/unit/test_tool_pipeline.py::test_*_arg_validation_*` — 4 e2e cases

## Related ADRs

- ADR 0011 · principles refresh (8 条原则) — 这是第 9 条
- ADR 0015 · skill progressive loading — skill 注入机制
- ADR 0017 · event-sourced claude-code pattern — Tool 是 Agent 的核心边界
- ADR 0018 · claude-code loop — Tool / pipeline / loop 关系
