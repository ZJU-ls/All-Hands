---
track: L · I-0021
branch: employee-design-page
started: 2026-04-19
---

# Track L · `/employees/design` · Layout + Data-Path Notes

> 阶段 1 交付物。决策在写代码前,请过一眼 §3(**数据路径 · 需确认**)再跑下一阶段。

---

## 1. 现状(2026-04-19 HEAD=d33a689)

- `/employees` 只有一个**只读列表**(`web/app/employees/page.tsx` · 99 行)
- `/employees/{id}` 只读详情 + 新对话按钮(161 行)
- 没有可视化员工设计 / 修改面板 · 用户只能通过 Lead Agent 对话创建(`create_employee` meta tool)
- 后端 `employee_tools.py` 已有 `create_employee` / `update_employee` / `delete_employee` meta tool(声明 + `WRITE` scope),但 **executor 目前只构造 EmployeeCard render envelope · 不写库**
- 后端 `employees.py` REST 路由只有 GET(`/lead`、`/`、`/{id}`),**没有任何写端点**
- 因此当前实际的员工落库路径只有:`BootstrapService.ensure_lead_agent()` 种 Lead Agent 一个。其他员工"创建"走 Lead Agent chat 是**架构意图**,但执行器与服务层目前未打通

截图:`plans/screenshots/i0021-before.png`(empty state)

---

## 2. 目标 layout · `/employees/design`

```
+-----------------------------------------------------------------------+
| AppShell · 标题 "员工设计"                                             |
+-----------+-----------------------------------------------------------+
| 左列 280px |  右栏 flex-1                                              |
| ───────── |  ─────────────────────────────────────────────────────── |
| 员工列表   |  ┌ 基础信息 ─────────────────────────────────┐            |
|  · Lead   |  │ name · role · 描述 · model · avatar-initial │            |
|  · 员工A  |  └─────────────────────────────────────────────┘            |
|  · 员工B  |                                                            |
|  · 员工C  |  ┌ 运转方式(preset,**单选,不落 mode**)─┐               |
|  · 员工D  |  │ ○ Execute  ○ Plan  ○ Plan + Subagent    │               |
| ───────── |  │  preset=plan 警告:不得挂载 write tool   │               |
| [+ 新建]  |  └─────────────────────────────────────────────┘            |
|           |                                                            |
|           |  ┌ Skill 挂载(multi-pick)────────────────┐               |
|           |  │ [ ] sk_research   [ ] sk_write          │               |
|           |  │ [ ] sk_planner    [ ] allhands.render   │               |
|           |  │ …  (过滤 / 搜索)                        │               |
|           |  └─────────────────────────────────────────────┘            |
|           |                                                            |
|           |  ┌ MCP 挂载(multi-pick)──────────────────┐               |
|           |  │ [ ] github-official                     │               |
|           |  │ [ ] allhands-skills                     │               |
|           |  │ …                                       │               |
|           |  └─────────────────────────────────────────────┘            |
|           |                                                            |
|           |  ┌ System prompt 片段(textarea,8 行)────┐               |
|           |  │                                         │               |
|           |  └─────────────────────────────────────────────┘            |
|           |                                                            |
|           |  ┌ Dry run 预览(即时)───────────────────┐               |
|           |  │ 最终 tools:N 个,点击展开列表          │               |
|           |  │ 最终 system prompt:合并 skill fragment │               |
|           |  │   + 员工 prompt 的全文                   │               |
|           |  └─────────────────────────────────────────────┘            |
|           |                                                            |
|           |  [取消]                              [招聘 / 保存] ←─┐     |
+-----------+-----------------------------------------------------------+
```

复用组件:
- `AppShell`(`@/components/shell/AppShell`)
- `LoadingState`(`@/components/state`)
- 按钮 / 输入 / Badge / Empty · `design-system/MASTER.md` §2 模板
- icon 集:`UserIcon` · `SkillIcon` · `PluginIcon`(MCP)· 自有集,不装第三方

新建组件(`web/components/employee-design/*`):
- `DesignForm.tsx` · 主容器(react-hook-form 或本地 `useState` · 看仓内模式,`mcp-servers/page.tsx` 就是本地 `useState`,不引入新库)
- `PresetRadio.tsx` · 3 单选 · 根据 preset 映射 tool_ids/skill_ids/max_iterations(**Phase 3B 等 Track M 契约**)
- `SkillMultiPicker.tsx` · `/api/skills` 列表 + 复选框
- `McpMultiPicker.tsx` · `/api/mcp-servers` 列表 + 复选框
- `DryRunPanel.tsx` · 订阅表单 state · 节流调 `POST /api/employees/preview` → 展示 `{final_tools, final_system_prompt}`

---

## 3. 数据路径 · **需用户签字**

**启动 prompt 里有两处互相矛盾的表述,这里必须先对齐再落代码:**

### 3.1 矛盾点

- **启动 prompt 硬约束**(第 7 行 + §硬约束):
  > "保存按钮 → meta tool `create_employee` / `update_employee`(L01 合规)"
  > "**不新加 REST CRUD endpoint**(L01 + §6.7)"
- **CLAUDE.md §3.1 L01 扩展(2026-04-18)**:
  > "**前端允许独立 CRUD 页 + 页面操作按钮**(Gateway / Skills 管理 / MCP 管理 / **员工管理** 等),走 REST 直调;**同时**必须确认对应能力已在 Meta Tool 注册"
- **CLAUDE.md §6.7 禁止条款**:
  > "❌ 为员工/MCP/Skill 开 REST CRUD endpoint(必须走 Meta Tool)"

而现状:`mcp-servers.py` 和 `skills.py` 路由**已经** POST/PATCH/DELETE,并通过 `test_learnings.py::TestL01ToolFirstBoundary` 的"REST 写 → 必须有同名 Meta Tool"规则。说明**项目现行口径是 §3.1(扩展版)已覆盖 §6.7**,§6.7 是 stale 的老规则。

### 3.2 三条备选路径

| 方案 | 动作 | 符合 §3.1 扩展 | 符合 §6.7 字面 | 符合启动 prompt 字面 | 实现代价 |
|---|---|---|---|---|---|
| **A** 新增 REST CRUD(与 MCP/Skill 一致) | `POST /api/employees` + `PATCH /api/employees/{id}` · `employee_service.create/update` 为单实现 · meta tool executor 也绑到同 service | ✓ | ✗ | ✗ | 低(仓内已有 2 个完整先例) |
| **B** 复用 chat 派发 | 保存按钮构造 `create_employee(...)` tool-call → 打开 `/chat/{lead}` 预填请求 · Lead Agent 实调 meta tool · 触发 ConfirmationGate | ✓ | ✓ | ✓ | 高 · UX 诡异(创建员工要先开对话) · meta tool executor 还得先打通真实写库(目前只返 render envelope) |
| **C** "Tool invoke" REST 入口 | 新增 `POST /api/tools/meta/{tool_id}/invoke` 通用入口 · Gate 走 Confirmation 流程 · UI 点"招聘"就是对 `create_employee` 做一次 invoke | ✓ | 灰色(不算直接 CRUD) | 灰色 | 高 · 要新建 Meta Tool invoke 层 + Gate 流程对接 |

### 3.3 推荐:**方案 A**

**理由:**
1. 与现存 `mcp-servers` / `skills` / `providers` / `models` 路由**完全一致**,review 成本低
2. §3.1 明确列出"**员工管理**"是"允许独立 CRUD 页 + 页面操作按钮"的例子
3. 与 L01 扩展测试(`TestL01ToolFirstBoundary`)天然匹配 —— 只要 `employee_tools.py` 里 create/update/delete 三个 meta tool 还在,REST 写就合法
4. `employee_service` 作为单一实现层,两个入口(REST / Meta)都调它,**语义完全等价**,杜绝"功能漂移"
5. 顺便把 Meta tool executor **真正打通到 service 写库**(现在只返 envelope),闭环 I-0008 /  I-0021 意图

**Phase 3B 对 meta tool 的契约补丁:**
- `CREATE_EMPLOYEE_TOOL` 输入 schema 加可选 `preset: enum["execute", "plan", "plan_with_subagent"]`(读 Track M 契约映射)。executor 先读 preset,展开为 `tool_ids/skill_ids/max_iterations` 写入。**DB 层仍然不存 preset,只存展开后的三列。**
- `UPDATE_EMPLOYEE_TOOL` 同上。
- 调用者(UI)**可以只送 preset**,也可以覆盖 `tool_ids/skill_ids/max_iterations`。Dry run 预览把 UI 的展开结果也 echo 出来,让用户所见即所得。

### 3.4 触及的代码面(方案 A)

```
backend/src/allhands/api/routers/employees.py
  + POST "" (Create)  → employee_service.create
  + PATCH "/{id}"     → employee_service.update
  + DELETE "/{id}"    → employee_service.delete
  + POST "/preview"   → compute (final_tools, final_system_prompt) via expand_skills_to_tools

backend/src/allhands/execution/tools/meta/employee_tools.py
  修 execute_create_employee / 新 execute_update_employee / execute_delete_employee
    → 注入 EmployeeService · 真写库 · 返回 EmployeeCard envelope
  新 PREVIEW_EMPLOYEE_COMPOSITION_TOOL · 映射为 READ scope · 不过 Gate

backend/src/allhands/execution/tools/__init__.py
  + 注册 PREVIEW_EMPLOYEE_COMPOSITION_TOOL
  + 把 update / delete executor 接到真执行(I-0008 遗留 no-op)

backend/tests/integration/test_employee_design_contract.py  (新)
  断言 3 preset (execute / plan / plan_with_subagent) 各自展开到正确的
  tool_ids + skill_ids + max_iterations(Phase 3B · 等 M 契约)

backend/tests/unit/test_learnings.py
  L01 白名单对齐(employees.py 写动词本来就与 meta tool 成对 · 无改动需求)

web/app/employees/design/page.tsx                          (新)
web/components/employee-design/{DesignForm,PresetRadio,SkillMultiPicker,
  McpMultiPicker,DryRunPanel}.tsx                          (新)
web/lib/api.ts                                             (扩 CRUD helper)
web/tests/e2e/employee-design.spec.ts                      (新)
```

---

## 4. Phase 3B 依赖(Track M 的 `docs/specs/agent-runtime-contract.md`)

**未到**。该文件不存在于 2026-04-19 15:30 GMT+8 的 main。

Track L 阶段 1 + 2 + 3A **不需要** 契约 · 运转方式区在 Phase 3B 才动 · 阶段 2 的 PresetRadio 先以 "空位 / disabled + '等 Track M 契约'" 渲染占位。

当 M 交付契约:

```bash
git fetch origin main
git merge origin/main   # 或 cherry-pick M 的 commit
# 读 docs/specs/agent-runtime-contract.md 后再写 Phase 3B UI
```

若 M 拖延 → **停下来告知用户**,不自行猜 employee_preset shape。

---

## 5. 视觉纪律 checklist(开工前自检 · `MASTER.md` §0)

- [x] 不装第三方 icon 库 · 只用 `@/components/icons` 自有集 + legacy 5 类 SVG
- [x] 颜色全部用 token · 禁止硬编码 `#xxx` / `bg-blue-500`
- [x] 动效 ≤ 2px 位移,hover 只改 border · 无 scale / shadow
- [x] 表单 focus 用 `focus:border-primary`(MASTER §2.5 模板)
- [x] 多选 Picker 内部 list row 用 hover `bg-surface-2` + check-icon 右侧指示

---

## 6. 收工里程碑

- [ ] Phase 1 ✅ 本文件 + before 截图
- [ ] Phase 2 · 基础信息 + skill/mcp 多选 + 保存(调方案 A · 未动运转方式区)
- [ ] Phase 3A · preview meta tool + REST + DryRunPanel
- [ ] **[等 M]** Phase 3B · PresetRadio + 契约验证
- [ ] Phase 4 · ensure_sample_employees + e2e 回归 + `TRACK-L-DONE.md`

---

## 签字区

**决策 Q**:阶段 2 开始前,请用户确认:**方案 A(REST CRUD + Meta Tool 对偶)** 为数据路径。

- [ ] 用户已确认方案 A · Track L 继续
- [ ] 用户选方案 B/C · Track L 调整
