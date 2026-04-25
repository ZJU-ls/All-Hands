# Skill Pack 作者指南

> 给后续添加 builtin / market skill 包的人看 · 让上下文持续可控 · LLM 持续高效。

## 0. 这本指南要回答什么

「我想加一个新 skill 包,该按什么模板?填什么字段?写多深?」

不读这份的代价 = 上下文猪脑过载,LLM 用错工具,用户体验差。

---

## 1. 准入门槛(出现以下信号才该加 skill 包)

✅ 应该加:
- 有一组 ≥ 3 个工具,语义上回答「同一类问题」(例:`triggers_management` 回答「怎么自动跑」)
- 这组工具 90% 的对话不需要,但需要时往往集中需要
- 工具 schema 加起来 > 1k token(否则直接挂 `tool_ids` 上更省事)

❌ 不要加:
- 单一工具(直接挂 employee.tool_ids)
- 每轮都需要的能力(走 always-hot 或 DEFAULT_SKILL_IDS)
- 不属于「能用一句话回答的问题」的杂烩(先想清楚边界)

---

## 2. 模板:目录结构

```
skills/builtin/<pack-name>/
├── SKILL.yaml                  ← 必须
├── prompts/
│   └── guidance.md             ← 必须
└── references/                 ← 可选 · 但强烈建议
    ├── <topic-1>.md
    └── <topic-2>.md
```

`pack-name` 用 `snake_case` · 与 yaml 里的 `id` 后缀一致(`allhands.<pack-name>`)。

---

## 3. SKILL.yaml 字段约束

```yaml
id: allhands.<pack-name>          # 必须 · ≤ 32 字符
name: 中文人话名                   # 给设置页 UI 用
description: <≤ 80 字符>          # 进 system prompt · 必须 LLM 触发友好
version: 1.0.0
builtin: true

tool_ids:                         # 至少 1 个 · 全部必须实际注册
  - allhands.meta.foo
  - allhands.meta.bar

prompt_fragment_file: prompts/guidance.md
```

### 3.1 description 怎么写(LLM 友好)

✅ 「定时 / 自动跑 / cron / 事件触发 · 创建 启停 立即 fire 和查执行历史」
- 动词 + 关键词列表
- 包含 3-5 个用户可能用到的触发词(用户说「定时」「自动跑」都能命中)
- ≤ 80 字符(自动测试 enforce)

❌ 「让员工的工作可以无人值守自动跑」
- 太抽象 · 关键词覆盖小 · LLM 决策不直接

### 3.2 tool_ids 必须先注册

`test_progressive_skill_packs::test_pack_tool_ids_all_registered` 会 enforce 这一点 · 写完之前先确认对应 `*_tools.py` 里有这个工具。

---

## 4. guidance.md 五大章节(强制)

`test_skill_guidance_quality` lint 检查 · 缺一段 build 红。

```markdown
# <Pack 中文名> · 工作流

## 何时调用
用户说「X 关键词」「Y 关键词」 → 这套技能。

## 典型工作流
1. **盘点** — `list_xxx()` 看现有
2. **创建 / 改** — `create_xxx(...)` · 关键参数说明
3. ...

## 调用示例
\```
list_triggers()                    # 拿到 trigger_id
create_trigger(name="...", schedule="0 9 * * *", ...)
toggle_trigger(id=trigger_id, enabled=True)
\```

## 常见坑
- 创建后忘 toggle → 用户以为创建了实际没跑
- ...

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `create_xxx` 报 "validation error" | ... |
| ... | ... |
```

**为什么是这 5 段**:LLM 对话场景下,这 5 段覆盖了「决策(何时) · 执行(工作流 + 示例) · 自检(坑) · 自愈(失败)」全闭环。少任一段都会导致某类错误无法自动恢复。

---

## 5. references/ 子文件的写法

只在用户「可能反复查同一份资料」时才放(例:cron 速查 · API 状态码表)。

特点:
- markdown · ≤ 256KB(loader hard cap)
- 标题清晰 · 表格优先 · 代码块够用
- 顶部一行说「`read_skill_file('<skill-id>', 'references/<file>.md')` · 直接抄」

read_skill_file 走的是 path 直读 · LLM 必须知道路径才拉得到。所以:
1. 在 guidance.md 的「典型工作流」里**显式提到** references 文件名
2. 不要把 references 当成 RAG 检索 · 它就是 cheat sheet

---

## 6. Lead 配置接入

加完 yaml + guidance 还要把 skill_id wire 到 Lead:

```python
# allhands/services/employee_service.py
LEAD_EXTRA_SKILL_IDS: tuple[str, ...] = (
    ...,
    "allhands.<pack-name>",   # 加这一行
)
```

`test_progressive_skill_packs::test_all_new_packs_wired_on_lead` 会 enforce(只对当前清单里的 6 个,新加 pack 也要在 NEW_PACKS 元组里加)。

---

## 7. 测试清单

每加一个新 pack,自动跑过的:

| 测试 | 检查什么 |
|---|---|
| `test_progressive_skill_packs::test_pack_dir_layout` | 目录 + 必要文件存在 |
| `test_progressive_skill_packs::test_pack_yaml_required_fields` | yaml 必填字段 |
| `test_progressive_skill_packs::test_pack_description_within_budget` | description ≤ 80 char |
| `test_progressive_skill_packs::test_pack_tool_ids_all_registered` | 所有 tool_id 实际注册 |
| `test_progressive_skill_packs::test_pack_prompt_non_empty` | guidance.md 非空 |
| `test_progressive_skill_packs::test_all_new_packs_wired_on_lead` | LEAD_EXTRA_SKILL_IDS 含此 pack |
| `test_skill_guidance_quality::test_guidance_has_all_five_sections` | 5 大章节齐全 |
| `test_skill_guidance_quality::test_guidance_has_runnable_example` | 示例段有 code block 或 tool call |
| `test_skill_guidance_quality::test_skill_tool_referential_integrity` | 跨包 referential 一致(已存在的 lint) |

---

## 8. 反模式 · 不要这样

❌ description 抒情:「让你的员工生活更美好」 — 没关键词,LLM 不会激活
❌ guidance.md 100 字以内的占位 — 测试会过但 LLM 没东西学
❌ tool_ids 列了一个未实现的占位 ID — referential test 会红
❌ 把 5 段 guidance 合并成一个长 markdown 段落 — section 测试会红
❌ skill_id 用 `allhands.MARKET_DATA`(全大写) — 不符合命名规范
❌ description 多种语言混写 — 中文 / 英文挑一种

---

## 9. 上线后回看(self-check)

加完 1 周后回头看这个 skill:
- Lead 真的会激活它吗?(看 trace,搜 resolve_skill 命中率)
- 激活后 LLM 真的按 guidance 调用吗?(看 trace,有没有调对 tool 顺序)
- 用户反馈有没有「我说 X 它没识别」?(可能 description 关键词不全)
- references 真的被 read_skill_file 拉过吗?(没拉就说明 guidance 没引导好)

如果以上有任一项答 No,这个 skill 没真正发挥作用 — 改 description / guidance 而不是加新工具。
