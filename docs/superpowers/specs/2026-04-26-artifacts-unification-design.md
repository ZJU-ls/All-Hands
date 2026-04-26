# Artifacts Unification · Refactor Design

**Branch:** feat/iteration · **Date:** 2026-04-26
**Drives:** Tool First (§3.1) · Skill = Dynamic Capability Pack (§3.4) · 解耦合 (§3.7)

---

## North Star

**一个技能,一种心智模型。** `allhands.artifacts` 是制品的唯一入口 —— 生产 / 渲染 / 搜索 / 编辑 / 版本 / 删除 都在它名下。

Lead Agent 退化成"派遣员"(thin shim),具体能力住在 skill + tool 里。

---

## 1. 当前问题

### 1.1 能力散落在 3 个 skill

- `allhands.artifacts` —— CRUD + 通用 create
- `allhands.drawio-creator` —— drawio 专属(模板 + 三步仪式)
- `allhands.render` —— 一次性可视化(line_chart 等)

模型要画 drawio 得激活 2 个 skill;要既画图又改文档,激活 3 个。心智糊。

### 1.2 Lead Agent 系统提示臃肿

`lead_agent.md` 当前 ~150 行,含具体生产协议(kind 列表 / hallucination 钳制 / drawio 三步法 / write_file 区分 …)。这是 Lead 不该承担的知识 —— 用什么工具,该由工具/技能自己说。

### 1.3 内联渲染对 pptx / docx / 长 pdf 体验差

所有 `artifact_create*` 当前自动返 `Artifact.Preview` 内联。pptx 内联只能看标题列表,docx 类似。用户截图反馈:**不能内联的应该给可点击卡片,聚焦到制品区**。

### 1.4 drawio-creator 已经在用

不能简单删 —— 数据库 `employees.skill_ids` / `skill_runtime_state` 存量记录引用它。需要数据迁移。

---

## 2. 目标架构

### 2.1 分层

```
┌──────────────────────────────────────────────────────────┐
│  Lead Agent (system prompt ≤ 50 行)                      │
│  ───────────────────────────────────                     │
│  • 派遣优先 (dispatch_employee 找有能力的员工)           │
│  • 否则用 skill 找能力 (list_skills / resolve_skill)     │
│  • 已激活的 tool 直接调                                  │
└──────────────────────────────────────────────────────────┘
                       │ resolve_skill
                       ▼
┌──────────────────────────────────────────────────────────┐
│  allhands.artifacts skill                                │
│  ───────────────────────────                             │
│  prompts/guidance.md   ← 决策树(150 行内 · 激活注入)    │
│  kinds/*.md            ← 每种 kind 详细说明 (按需读)    │
│  templates/drawio/*.xml← drawio 模板 (按需读)           │
│  workflows/*.md        ← 编辑 / 多版本 / 缩略图 (按需读) │
└──────────────────────────────────────────────────────────┘
                       │ executor 调
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Tools                                                   │
│  ─────                                                   │
│  Producers:  artifact_create / render_drawio /           │
│              artifact_create_{pdf,xlsx,csv,docx,pptx}    │
│  CRUD:       artifact_{list,read,search,update,          │
│              rollback,delete,pin}                        │
│  Skill self: read_skill_file                             │
└──────────────────────────────────────────────────────────┘
```

### 2.2 渲染信封一分二

```
artifact_create*(...)
       │
       ▼
  按 kind 路由
       │
       ├── 内联适合 (html / drawio / mermaid / image / markdown / code / csv / xlsx / data)
       │       └─→ {component: "Artifact.Preview", props, ...}
       │              └─→ 聊天里直接显示完整内容
       │
       └── 不适合内联 (pptx / docx / pdf>2MB / 大 markdown)
               └─→ {component: "Artifact.Card", props, ...}
                      └─→ 聊天里只显示卡片("点击在制品区打开")
                          └─→ 点击 → 制品面板打开 + scroll 到目标
```

---

## 3. Lead Agent 系统提示瘦身

### 3.1 现状(~150 行 · 节选)

```
You are the Lead Agent...
Your job is to coordinate...

[SECTION] 制品系统协议
1. resolve_skill("allhands.artifacts") ...
2. artifact_create({kind, ...}) — kind 是 markdown / code / html / image / data / mermaid / drawio / pdf / xlsx / csv / docx / pptx
   流程图 / 时序图 / ER / 架构图 → 用 render_drawio({name, xml})
   ...
3. No second step. Every artifact_create* returns render envelope ...

[SECTION] Hard rule for diagrams
never write mxfile XML or mermaid source as a code block ...

[SECTION] Anti-hallucination clause (CRITICAL)
if your reply contains 「这是一个 X」「我已经为你 X」 ...

[SECTION] Action-first for vague creation requests
当用户说「给我画个 X」「来一份 Y」 ...

[SECTION] Rendering rule (non-negotiable)
The render_* tools — render_line_chart, render_bar_chart, ...

[... etc]
```

### 3.2 目标(~30 行)

```
You are the Lead Agent of an allhands organization.

# How you work

1. **Dispatch first.** If an employee is registered for this kind of
   work, call `dispatch_employee(employee_id, task)` — they already
   have the right skills + context. Use `list_employees` to see who's
   available.

2. **Find capabilities through skills.** When you don't have the tool
   you need, call `list_skills` then `resolve_skill('<id>')` to
   activate it. Activation injects the skill's body + tools into your
   scope. Common skill ids: `allhands.artifacts` (制品 ·
   html/drawio/pdf/...), `allhands.render` (一次性图表), 
   `allhands.team_management` (员工 CRUD), ...

3. **Use the tool.** Activated tools appear in your tool list — call
   them directly. Read their description for usage; if a skill body
   was injected, follow that. If a skill points to subfiles, use
   `read_skill_file(skill_id, relative_path)` to load them on demand.

4. **Speak briefly.** Don't narrate what tools you're about to call —
   just call them. If a tool returns a render envelope, the user sees
   the card; don't repeat the content as prose.

That's it. The specifics live in skills, not here.
```

**砍掉的**:
- artifact 协议 → `allhands.artifacts/prompts/guidance.md`
- drawio 仪式 → `allhands.artifacts/kinds/drawio.md`
- hallucination 钳制 → 留在 agent_loop 的 `_looks_like_artifact_hallucination`(代码层 self-correction · 提示不需要也写一遍)
- action-first → 各 skill body 自己说
- render_* 协议 → `allhands.render/prompts/guidance.md`(已经存在)
- write_file vs artifact_create → tool 描述自己讲清楚

---

## 4. allhands.artifacts skill 文件结构

```
backend/skills/builtin/artifacts/
├── SKILL.yaml
├── prompts/
│   └── guidance.md                      # ≤ 150 行 · 顶层决策树 + 一步到位 + click-to-open 卡片说明
├── kinds/                               # 按需 read_skill_file
│   ├── html.md                          # 何时用 / examples / 大小限制
│   ├── drawio.md                        # 简单直写 vs 复杂用模板 / 常见坑
│   ├── mermaid.md                       # 关系图入门 / 限制
│   ├── pdf.md                           # markdown / html source 对比 / 字体限制
│   ├── docx.md                          # blocks 协议 / 不支持的特性
│   ├── xlsx.md                          # sheets / cell 类型推断 / formula 转义
│   ├── csv.md                           # BOM / 分隔符默认
│   ├── pptx.md                          # 4 个 layout · 内联预览仅文本
│   ├── markdown.md                      # 长度阈值 → Card 降级
│   ├── code.md                          # language hint / mime
│   ├── data.md                          # JSON 数据集 (≤ 1MB)
│   └── image.md                         # base64 + mime 限制
├── workflows/
│   ├── edit-existing.md                 # search → read → update 三步
│   ├── multi-version.md                 # version_switcher / rollback
│   └── cleanup.md                       # delete / pin
└── templates/
    └── drawio/
        ├── flowchart.drawio.xml          # 从 drawio-creator 搬过来
        ├── sequence.drawio.xml
        ├── er.drawio.xml
        ├── architecture.drawio.xml
        └── mindmap.drawio.xml
```

`SKILL.yaml`:

```yaml
id: allhands.artifacts
name: 制品
description: 产出 / 渲染 / 编辑 html · drawio · pdf · 表格 · 文档 · 图等制品
version: 2.0.0
builtin: true

tool_ids:
  # producers
  - allhands.artifacts.create
  - allhands.artifacts.render_drawio
  - allhands.artifacts.create_pdf
  - allhands.artifacts.create_xlsx
  - allhands.artifacts.create_csv
  - allhands.artifacts.create_docx
  - allhands.artifacts.create_pptx
  # CRUD
  - allhands.artifacts.list
  - allhands.artifacts.read
  - allhands.artifacts.search
  - allhands.artifacts.update
  - allhands.artifacts.rollback
  - allhands.artifacts.delete
  - allhands.artifacts.pin
  - allhands.artifacts.render          # legacy 复显老制品
  # skill 自身
  - allhands.meta.read_skill_file

prompt_fragment_file: prompts/guidance.md
```

---

## 5. 渲染信封路由(后端)

`_artifact_create_result(... kind_value)` helper 内部决策:

```python
INLINE_KINDS = {"html", "drawio", "mermaid", "image", "markdown",
                "code", "csv", "xlsx", "data"}
CARD_ONLY_KINDS = {"pptx", "docx"}
SIZE_THRESHOLD_BYTES = 200_000  # markdown / code 超过就降级 Card

def _artifact_create_result(*, artifact_id, version, kind_value, size_bytes, warnings=None):
    if kind_value in CARD_ONLY_KINDS:
        component = "Artifact.Card"
    elif kind_value == "pdf" and size_bytes > 2_000_000:
        component = "Artifact.Card"
    elif kind_value in INLINE_KINDS and size_bytes <= SIZE_THRESHOLD_BYTES:
        component = "Artifact.Preview"
    elif kind_value in INLINE_KINDS:
        component = "Artifact.Card"
    else:
        component = "Artifact.Card"  # safe default
    return {
        "component": component,
        "props": {"artifact_id": artifact_id, "version": version, "kind": kind_value},
        ...
    }
```

---

## 6. 前端 click-to-focus 机制

### 6.1 新增 `Artifact.Card` 组件

`web/components/render/Artifact/Card.tsx`:

- kind 图标 + name + version + kind badge
- 一行 description(若有)
- 主按钮:`在制品区打开`
- 点击 → `useArtifactPanel().focus(artifact_id)`

### 6.2 全局 store

`web/lib/store.ts` 加:

```typescript
interface ArtifactPanelState {
  panelOpen: boolean;
  selectedArtifactId: string | null;
  focusBumpTick: number;       // 涨一拍 → list 收到 → scroll + 高亮
}
focus: (id: string) => set({ panelOpen: true, selectedArtifactId: id, focusBumpTick: tick + 1 })
```

### 6.3 `Artifact.Preview` header 加"在制品区打开"按钮

跟 `Artifact.Card` 同款,内联预览的也允许跳转到面板。

---

## 7. drawio-creator 物理删除 + 数据迁移

### 7.1 物理删

```bash
git rm -rf backend/skills/builtin/drawio-creator/
```

模板文件搬到 `backend/skills/builtin/artifacts/templates/drawio/`(同名)。

### 7.2 数据迁移(Alembic)

新建 `backend/alembic/versions/<rev>_drop_drawio_creator_skill_id.py`:

```python
def upgrade():
    # employees.skill_ids 是 ARRAY[TEXT] 或 JSON,看 ORM 模型确认
    op.execute("""
        UPDATE employees
        SET skill_ids = array_replace(skill_ids,
                                       'allhands.drawio-creator',
                                       'allhands.artifacts')
        WHERE 'allhands.drawio-creator' = ANY(skill_ids)
    """)
    # SkillRuntimeState 里的 active_skills 字段同样替换
    op.execute("""
        UPDATE skill_runtime_state
        SET active_skills = jsonb_set(
            active_skills,
            ...,  -- jsonb_path_replace
            ...
        )
        WHERE active_skills @> '"allhands.drawio-creator"'::jsonb
    """)

def downgrade():
    # 反向不可逆 (skill 已物理删) · 留 noop
    pass
```

(具体 SQL 跑通要看实际 ORM。SQLite 无 array · 用 JSON path 替换。)

### 7.3 Discovery + Resolver fail-loud

`SkillService.resolve_skill(...)` 收到 `allhands.drawio-creator`(老对话残留)→ 返 `skill not found`(明确错误,不哑迁移)。日志记一行 warn 让我们能看到。

### 7.4 测试

`tests/integration/test_drawio_creator_removed.py`:
- 启动期 discover → registry 不应该 register `allhands.drawio-creator`
- 任意 employee.skill_ids 含老 id → migration 后应消失
- 老 SkillRuntimeState 含老 id → migration 后应消失

---

## 8. 实施分阶段

每阶段独立可测、可上线、不破现状。

### P1 · 双信封 + click-to-focus

- 后端: `_artifact_create_result` 路由按 kind 选 Preview / Card
- 前端:
  - `web/lib/component-registry.ts` 注册 `Artifact.Card`
  - `web/components/render/Artifact/Card.tsx` 新组件
  - `web/lib/store.ts` 加 `ArtifactPanelState` + `focus` action
  - `web/components/render/Artifact/Preview.tsx` header 加"在制品区打开"按钮
  - `web/components/artifacts/ArtifactPanel.tsx` 监听 `selectedArtifactId` + `focusBumpTick`
- 测试: 后端 unit 覆盖 kind 路由;前端 vitest 覆盖 Card 渲染 + click

### P2 · `allhands.artifacts` skill 目录

- 新建 `skills/builtin/artifacts/` 目录(按 §4 结构)
- 写 12 个 kinds/*.md 子文件 + 3 个 workflows/*.md
- 新 `prompts/guidance.md` (≤ 150 行)
- `SKILL.yaml` 列全 tool_ids
- 模板从 drawio-creator 搬过来(git mv 保历史)
- 测试: `test_resolve_skill_body_injection.py` 加 case 覆盖 artifacts skill 激活;`test_skill_files_sandbox.py` 验证 kinds/*.md + templates/drawio/*.xml 可读

### P3 · drawio-creator 物理删除 + alembic data migration

- `git rm -rf` 老 skill
- 写 alembic migration(§7.2)
- `SkillService` 不需要改(老 id 会自然 not found,这就是想要的)
- 测试: alembic upgrade head + downgrade -1 OK;`test_drawio_creator_removed.py`

### P4 · Lead Agent 提示瘦身

- `lead_agent.md` 替换为 §3.2 的 ~30 行版本
- 砍掉 artifact / render / hallucination / action-first 各章
- 端到端冒烟: 让 Lead 处理「画 drawio」「画 html」「出 pptx」三个用例,每个都应该:
  1. resolve_skill(allhands.artifacts)
  2. 调对应的 artifact_create*
  3. 聊天里出现合适的卡片(Preview 或 Card)
- `_ARTIFACT_HALLUC_PATTERNS` 保留(代码层 safety net 不删)

---

## 9. 验收清单

- [ ] (P1) `Artifact.Card` 点击 → 制品面板打开 + scroll 聚焦目标 artifact (e2e)
- [ ] (P1) pptx / docx 不再内联 (返回 Card);html / drawio 仍内联
- [ ] (P1) `Artifact.Preview` header 加"在制品区打开"按钮
- [ ] (P2) `lint-imports` 全绿
- [ ] (P2) `test_resolve_skill_body_injection` 含 artifacts skill 激活路径
- [ ] (P2) `test_skill_files_sandbox` 覆盖 `kinds/*.md` + `templates/drawio/*.xml`
- [ ] (P2) `read_skill_file('allhands.artifacts', 'kinds/html.md')` 真能读到内容
- [ ] (P3) `alembic upgrade head` 然后 `alembic downgrade -1` OK
- [ ] (P3) 数据库 sanity: 启动期日志 `grep drawio-creator` 应零结果
- [ ] (P3) `tests/integration/test_drawio_creator_removed.py` 启动期 discovery 不含老 id
- [ ] (P4) `lead_agent.md` 行数 ≤ 50
- [ ] (P4) 三种用例端到端 smoke:画 drawio · 画 html · 出 pptx · 出 docx
- [ ] 所有 unit + integration tests 全绿
- [ ] mypy strict + ruff + import-linter 零违规

---

## 10. 风险登记

| 风险 | 概率 | 缓解 |
|---|---|---|
| 数据迁移失败 → 老员工 skill_ids 引用悬空 | 低 | alembic 用事务 · 失败回滚 · 启动期 fail-loud 检测 |
| pptx/docx 改 Card 后用户找不到内容 | 中 | Card 上写明「点击在制品区打开」+ 第一次创建时短暂 toast 提示 |
| Lead 提示砍太狠 → 行为退化 | 中 | P4 单独阶段 · 端到端冒烟 3 用例必过才合 |
| `read_skill_file` 沙盒漏掉 templates/drawio/ | 低 | 已有 `test_skill_files_sandbox` · 路径在 install_root/<slug>/ 内 |
| 老对话 ledger 记录 `allhands.drawio-creator` 字符串 → trace 显示无效 | 低 | 仅是历史展示问题 · 不影响 runtime · 文档说明 |

---

## 11. 不在范围

- `allhands.render`(line_chart / bar_chart / table 这些一次性可视化)**不动** —— 与制品是不同物种(短暂可视 vs 持久产出)
- `write_file` tool **不动** —— 写本地服务端文件 · 与制品无关
- mcp 制品扩展 **暂不动**
- 制品全文索引 / 向量化 **不在范围**
