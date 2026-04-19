---
id: I-0021
severity: P1
status: open
title: /employees 员工设计(招聘)页 · 通过 skill/tool/iteration 组合配置员工运转方式 + 挂载 skill/mcp
affects: web/app/employees/**/* · web/components/employee-design/*(新)· backend/execution/tools/meta/employee_tools.py(扩) · backend/services/employee_service.py(扩)
discovered: 2026-04-19 / user-product-review
blocker-for: Wave-3 员工组织能力闭环 · L01 Tool First 扩展可视化
tags: ui, ux, employees, meta-tools
---

## Repro

1. `pnpm dev`
2. 打开 `http://localhost:3000/employees`
3. 观察到:只有员工列表 / 简单详情 · **没有设计(招聘)流程 UI**
4. 用户当前只能通过 Lead Agent 对话创建员工 · 没有可视化的员工 "profile" 配置面板

## Expected

**/employees/design(或 /employees/new)· 员工招聘 / 设计页:**

左栏:当前员工列表(含 seed 的样例员工)· 右栏:设计面板,字段包括:

1. **基础信息** · name / role / 描述 / avatar / 归属团队
2. **运转方式(operating preset)**:3 个单选预设 · 底层**不存 mode 字段**,而是写入 `tool_ids[] + skill_ids[] + max_iterations`:
   - **Execute 执行型**(preset=`execute`)
     - 基础 tools(fetch_url / write_file / 分配的 skill)
     - max_iterations = 10
     - 无 plan skill / 无 spawn_subagent tool
   - **Plan 计划型**(preset=`plan`)
     - 挂载 `sk_planner`(新 skill · 只输出结构化计划,不动工)
     - max_iterations = 3
     - 无 write 类 tool
   - **Plan + Subagent 计划+子代理**(preset=`plan_with_subagent`)
     - `sk_planner` + `sk_executor_spawn`(新 skill)
     - max_iterations = 20
     - 挂载 meta tool `spawn_subagent`(新 · 类似 Claude Code Task tool · 见 I-0022)
3. **Skill 挂载** · 多选 · 从 SkillRegistry 列出(builtin + custom)· 勾选写入 `employee.skill_ids[]`
4. **MCP 挂载** · 多选 · 从 MCP server 列出 · 勾选写入 `employee.mcp_ids[]`
5. **提示词** · system prompt 片段(与 skill prompt_fragment 拼接)
6. **Dry run 预览** · 右下角展示该员工 "最终 tools 清单"(经 `expand_skills_to_tools` 合并去重)+ "最终 system prompt"(与 skill fragment 合并后的全文)· 让设计者所见即所得

**保存按钮:**
- 不直接写数据库 · 调 meta tool `create_employee` / `update_employee`(L01 合规)
- 经过 `ConfirmationGate`(scope=WRITE · 如 mcp 挂载是 IRREVERSIBLE 需二次确认)

**契约对接 I-0022:**
- `preset` 枚举 + `spawn_subagent` tool schema 由 I-0022 Track M 第一 commit 落地契约文件 `docs/specs/agent-runtime-contract.md` · 本 track 读该文件做 UI
- I-0022 第一 commit 前**不能**开始本 track 的运转方式单选区 · 可以先做基础信息 + skill/mcp 挂载

## Actual

- `web/app/employees/page.tsx` 99 行 · 只是 list
- `web/app/employees/[employeeId]/page.tsx` 161 行 · 只是详情
- 后端 `employee_tools.py` 有 `create_employee` / `update_employee` / `delete_employee` meta tool(L01 合规)
- `expand_skills_to_tools()` 已在 `backend/src/allhands/execution/skills.py:88` · 可复用做 Dry run 预览

## 评估方向

1. **对齐契约**(commit 1)· 等 I-0022 Track M 出 `docs/specs/agent-runtime-contract.md` · 复制到本 track 的 reading list
2. **UI 骨架**(commit 2)· `/employees/design` 路由 · 基础信息 + Skill/MCP 挂载多选 + Dry run 预览 · 无运转方式区
3. **运转方式区**(commit 3)· 读取 I-0022 契约 · 3 个 preset 单选 · 提交时映射到 `tool_ids/skill_ids/max_iterations`
4. **回归测试**(commit 4)· e2e 走完一个设计流程 + meta tool 契约测试

## 硬约束

- **永不**在 employee / session 表加 `mode` 字段(CLAUDE.md §3.2 · 违反立打回)
- 保存走 meta tool(`create_employee`/`update_employee`)· 不新加 REST CRUD endpoint
- 视觉契约:Linear Precise · 自有 icon 集 · 无第三方 icon 库 · token 色
- Preset 是 UI 层概念,不落库:保存时展开为 `tool_ids[] + skill_ids[] + max_iterations` 三列实体字段

## 验收标准

- [ ] `/employees/design` 路由可达 · 截图 `plans/screenshots/i0021-design.png`
- [ ] 三种 preset 可切换 · Dry run 面板实时显示最终 tools + prompt
- [ ] Skill / MCP 多选 · 保存后通过 meta tool `create_employee` 写库
- [ ] 回归测试:`web/tests/e2e/employee-design.spec.ts` · playwright 走完 3 个 preset × (skill 挂载 + 保存)· `backend/tests/integration/test_employee_design_contract.py` 断言三个 preset 正确映射到实体字段
- [ ] **Seed 数据**:至少 `3 样例员工(each preset 各 1)` + 每人挂载 ≥ 2 skill + 1 mcp · 首次冷启打开 `/employees` 就"满载"
- [ ] `test_learnings.py::TestL01ToolFirstBoundary` 通过(Meta Tool + REST 对偶)
- [ ] `./scripts/check.sh` 全绿

## 相关

- 强依赖 **I-0022**(Track M)· `docs/specs/agent-runtime-contract.md`(由 M 的 commit 1 交付 · L 读完再动运转方式区)
- 依赖 **I-0020**(Track N)seed 基础设施 · 本 track 提供 `ensure_sample_employees()` 给 seed_service
- L01 Tool First(扩展版)· CLAUDE.md §3.1
- `ref-src-claude`:Agent profile / Task tool 的组织方式(对标"运转方式"概念,但我们用 preset 映射字段而不是 mode)
