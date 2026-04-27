# Principle Audit · 2026-04-27 round-22

> 原则 9 候选 · **Tool / Skill 自解释 · 不打 prompt 补丁**
> 错误结构化回 LLM,让 LLM 看到 field/expected/received/hint 即能自纠。
> Tool 的 description 说"我做什么 + 我吃什么";行为约束靠 schema(scope / requires_confirmation / 类型 / enum / required)。
> 一切跨工具的协议、模型行为偏好 → skill body;运行时不变量 → 代码。

本审计**只读**,产出问题清单 + 修法建议 + 优先级。

---

## 三类问题速览

| 类 | 计数 | 核心症状 |
|---|---|---|
| A · Tool description 含 prompt-style hack | 5 处 | "**You must**…" / "do NOT chain X" / "**WHEN NOT TO USE**" 这类祈使句出现在 description 里 |
| B · Lead prompt 含 tool 该自带的话 | 2 处 | Workspace state 用法 / render hallucination 钳制 — 应该下沉到 cockpit_tools / render skill |
| C · Skill body 含 tool 该自带的话 | 1 处 | artifacts skill 有 confirmation 行为表 — tool scope 已经声明,不需要重复 |

总计 **8 处**。下面逐项列。

---

## A · Tool description 里的 prompt-style hack

### A1 · `resolve_skill` description 含"不要把工具名当文本写出来"

**位置**: `backend/src/allhands/execution/tools/meta/resolve_skill.py:25-36`

**现状**:
```
description=(
    "Activate one of the skills mounted on this employee, adding "
    "its tools and prompt fragment to the conversation. **You must "
    "actually invoke this tool — do not write `resolve_skill(...)` "
    "as a chat message; the user will see only that text and nothing "
    "happens.** ..."
)
```

**为什么是补丁**: "**You must actually invoke**" 是行为偏好,不是工具契约。LLM 把工具名当文本写出来 = 模型输出策略问题,跟 tool 是什么没关系。

**修法**: description 砍成"激活一个挂载在当前 employee 上的 skill · 把它的 tools + body 注入会话 · 幂等"。把"必须真调"行为指导(如果还需要)放到 lead_agent.md 通用规则段(已有"Don't narrate")或 dispatch 出问题就 ToolArgError 报"skill_id required"。

**优先级**: ★★ · 中

---

### A2 · `task_tools.py` description 含 "STOP talking" / "If you can't write a DoD..."

**位置**: `backend/src/allhands/execution/tools/meta/task_tools.py:43, 53`

**现状**:
```
"...task id and STOP talking — do not stream progress updates into the chat;
the user "
"...If you can't write a DoD, you don't understand the request — ask the
user first.\n\n"
```

**为什么是补丁**: 第一句是流程命令(STOP talking) · 第二句是哲学指导(if you can't write a DoD, you don't understand)。Tool description 的对象是"调用方查阅契约",不是"训诫"。

**修法**:
- "STOP talking" → 这条规则应该是 task 系列工具 skill 的 body(已有 task_management skill)。把它搬过去
- "If you can't write a DoD" → 同样搬到 task_management skill body

**优先级**: ★ · 低(语义还能让 LLM 理解,但不优雅)

---

### A3 · `observatory_tools.py` 用全大写 "WHEN NOT TO USE" 警告

**位置**: `backend/src/allhands/execution/tools/meta/observatory_tools.py:80`

**现状**:
```
"**WHEN NOT TO USE**: You don't have a specific id yet (list first ..."
```

**为什么是补丁**: WHEN NOT TO USE 这种语气对 LLM 是补丁,读起来像在喊话。
合理的 tool description 是冷静陈述 "fetches X · returns Y · errors when Z"。

**修法**: 改"Returns the trace detail for a specific run id. Use after `list_recent_runs` to drill into one row." — 用陈述句表达"先 list 后 detail"。

**优先级**: ★ · 低

---

### A4 · `artifact_tools.py:render` description 含 "Call this after every create"

**位置**: `backend/src/allhands/execution/tools/meta/artifact_tools.py:130-138`

**现状**:
```
description=(
    "Emit an `Artifact.Preview` render payload in the chat so the user sees the "
    "artifact without the full content hitting the agent's context. Call this after "
    "every create / update."
)
```

**为什么是补丁 + 正确性问题**:
1. "Call this after every create / update" 是行为强制 · 该删
2. **更糟糕**: 这条 hint **已过期** —— 我们 P1 改了 `_artifact_create_result` 让 create 自带 render envelope · 不再需要后续 render 调用。description 还在让 LLM 多调一次,反而是错误指导。

**修法**: 改"Re-emit a render preview for an EXISTING artifact (legacy / re-show after a long gap). New artifacts created via `artifact_create*` already include the render envelope inline; you don't need to chain this after create."

**优先级**: ★★★ · 高(已是过期错误)

---

### A5 · `plan_tools.py` description 块 含 "❌ Don't ..."

**位置**: `backend/src/allhands/execution/tools/meta/plan_tools.py:` 多处 ❌ 列表

**现状**: description 用 emoji ❌ 反例列表。

**为什么是补丁**: ❌ 列表 = 写 prompt instruction · description 只该说"is for X"。

**修法**: 反例列表搬到 planner skill body 的"常见坑"段(已有此结构)。description 改成一句"Create a working plan with N steps · agent's own todo memo · no external effect."

**优先级**: ★ · 低

---

## B · Lead prompt 里的 tool 该自带的话

### B1 · `lead_agent.md:27` "Don't say '已激活 render 技能'"

**位置**: `backend/src/allhands/execution/prompts/lead_agent.md` line 27

**现状**:
```
- `render_*` (...) — also always hot. Don't say "已激活 render 技能" — that's hallucination.
```

**为什么是补丁**: 这是模型 hallucination 反例,对 lead 不是 lead 该承担的知识。`render` skill 自己已经有 guidance,可以在那里说"这些工具一直热,不要假装激活"。

**修法**: 删 lead 这行 + render skill body 加一行 "Pre-existing on every employee · do not write '激活 render 技能' as text · just call the tool."

**优先级**: ★ · 低(原话已经下沉一次,只是没删干净)

---

### B2 · `lead_agent.md:46-50` Workspace state 工具特定话术

**位置**: lead_agent.md `## Workspace state questions` 整段

**现状**: lead prompt 教 LLM "用户问咋样 → call cockpit.get_workspace_summary first, summarize in one paragraph"。

**为什么是补丁**: 这是 cockpit_tools.get_workspace_summary 该自己说的"用法",而不是 lead 该背的。

**修法**: 把整段搬到 `cockpit_tools.get_workspace_summary.description` —— "Returns aggregated KPIs (active runs / cost today / failures / queues) for the workspace. **Use this first** when the user asks about platform state ('现在咋样' / 'what's going on' / etc.); summarize in one paragraph rather than piecing together from individual list_* calls."

之后 lead prompt 这一节就不需要存在(L06 capability-discovery 也已经 require list_* first,等同效果)。

**优先级**: ★★ · 中

---

## C · Skill body 里的 tool 该自带的话

### C1 · `artifacts/prompts/guidance.md` 含 confirmation policy 表

**位置**: 早期 artifacts skill body 有 "READ + 创建类 — 无确认 / WRITE 改类 — 弹 confirmation / IRREVERSIBLE — 严肃确认"。

**现状**: P2 重写时这段已基本删除。仅剩残留 description。

**为什么(曾经)是补丁**: tool 的 scope 字段 + requires_confirmation 是契约源头 · skill body 重复一次只会漂移。

**修法**: 已经在 P2 时基本清理 · 只需扫一遍最终确认。

**优先级**: ★ · 低(基本已修复)

---

## 修复路线图(iter 5–7)

| iter | 范围 |
|---|---|
| **5** | A1, A4 优先 · 改 resolve_skill / artifact_render 的 description · 后者是正确性问题 |
| **5** | A2, A3, A5 一起改 · description 言简意赅化 · ❌ 列表搬 skill body |
| **6** | B1, B2 · lead_agent.md 砍掉 render hallucination 提示 + workspace state 段 · 内容下沉到对应 tool description |
| **7** | C1 验证清理 · 体检 artifacts / planner / model_management 三个 skill body 最后一遍 |

---

## 不在本次范围

- **Tool description 行业风格统一**: 现在有的是 "Create X · ..." 句式,有的是 "Returns ..." · 不强行统一
- **添加 description i18n**: tool description 一直是 EN 单语 · 多语化是另一个工程
- **改 schema 字段命名**: required / properties 字段命名跟 JSON Schema 一致 · 不动

---

## 度量

iter 4 后,**搜 grep "STOP|MUST|do NOT|❌|🚨" 在 tools/meta/ 应有 ≤ 3 处**(留必要的全大写 IRREVERSIBLE 之类的状态词)。
iter 6 后,**lead_agent.md 行数 ≤ 60**。
iter 7 后,**除 allhands-design / planner 外,skill body 都 ≤ 100 行**(顶层决策树 + 引用子文件)。
