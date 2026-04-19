---
id: I-0020
severity: P1
status: open
title: Seed 数据基础设施 · 每个新功能交付时必须自带"满载状态"的真实 demo 数据
affects: backend/services/seed_service.py(新) · backend/services/bootstrap_service.py(扩) · data/seeds/*.json(新) · CLI allhands seed dev(新) · 所有新 feature 的 DoD 约束
discovered: 2026-04-19 / user-product-review(Wave-2 merge 后评审反馈)
blocker-for: 所有 Wave-3+ 新功能验收(I-0019 / I-0021 等)· 产品评审低效问题
tags: backend, infra, devx, data
---

## Repro

用户 Wave-2 评审时的原话:"功能 merge 后,我打开对应页面看到的是空表 / '暂无数据',必须手动构造数据才能看到功能'满载时的样子'"。

1. Track F merge 后打开 `/skills`:0 条(没有 seed skill)
2. Track G merge 后打开 `/traces`:0 条
3. Track H merge 后打开 `/employees`:0 条

空 state 是否好看 vs 有数据时是否好看**是两回事**,产品评审覆盖不到后者。

## Expected

**Phase 1 · 基础设施**

- `backend/src/allhands/services/seed_service.py`(新)· 提供幂等 `ensure_*()` 函数家族
- `backend/src/allhands/main.py` `startup` 事件里调用 `seed_service.ensure_all_dev_seeds()`(仅当 env `ALLHANDS_ENV=dev` 或显式 `ALLHANDS_SEED=1`)
- CLI 入口 `allhands seed dev` / `allhands seed reset`(通过 `pyproject.toml` scripts + `backend/src/allhands/cli/__main__.py`)· 一键清库 + 重新 seed
- seed 数据从 `backend/data/seeds/*.json`(或 yaml)读取 · 文件名按 domain 分:`providers.json` / `models.json` / `employees.json` / `skills.json` / `mcp_servers.json` / `conversations.json` / `traces.json`
- seed 内容必须**真实、可跑通**:
  - provider base_url 跟 `.env.example` 对齐
  - model name 是真名(`qwen3.6-plus` 不是 `demo-model-1`)
  - 员工、skill、mcp 字段值符合业务语义(不写 `foo` / `bar` / `lorem`)

**Phase 2 · DoD 规则落地 + 回溯补**

- 更新 `docs/claude/working-protocol.md` 阶段 4 DoD 模板 · 加一节 "Seed 数据":
  - 字段:具体数量(如 `3 providers × 5 models`)
  - 来源:service-level `ensure_*()` · 不准直接写 SQL
  - 验证:e2e `playwright` 打开页面断言 "≥ N 条 seed 可见"
- 回溯补 seed 给已 merge 的功能:employees(2 个样例员工)/ skills(6 个 builtin 已有,继续加 demo 挂载)/ mcp_servers(1 个官方 HTTP MCP 样例)/ conversations(1 条"完整来回"带 reasoning 的历史对话)/ traces(4 条各种状态的 run trace)
- 给每个新 feature 的 issue DoD 模板加一条 "seed fixture 注入"

## Actual

- `backend/src/allhands/services/bootstrap_service.py` 已有 `ensure_bootstrap_version()` 模式 · 但只覆盖 providers/models 的最小 viable 配置
- 没有 `ensure_employees()` / `ensure_skills_mounting()` / `ensure_conversations()` / `ensure_traces()`
- 没有 CLI 一键 reset 入口

## 评估方向

1. Phase 1 · 搭基础设施(本 track 主要工作)· commit 1-3
2. Phase 2 · 更新 working-protocol 模板 + 给 employees/conversations/traces 各补 seed · commit 4-5
3. **测试 fixture ≠ seed** · 在 `docs/claude/working-protocol.md` 明确写:测试 fixture 是单条隔离的;seed 是一整套营造"产品上线后第一天"的形态

## 硬约束

- seed 必须幂等(可重复 `startup` 不重复写入)· idempotent by business key(`provider.slug` / `model.name` / `employee.slug` 等)
- seed 必须**真实**:符合 `.env.example` · 不写 `foo/bar`
- seed 不走 SQL 脚本 · 一律走 service 层
- CLI `allhands seed reset` 只在 `ALLHANDS_ENV=dev` 允许 · 生产环境拒绝
- **不**在生产环境自动 seed(默认关,用 env 变量显式开)

## 验收标准

- [ ] `backend/src/allhands/services/seed_service.py` 新增 · 含 `ensure_all_dev_seeds()` + 各 domain 的 `ensure_*()`
- [ ] `backend/data/seeds/*.json` · 至少 7 份(providers / models / employees / skills-mount / mcp_servers / conversations / traces)· 内容真实
- [ ] `allhands seed dev` CLI 可用 · `allhands seed reset` 可用 · README 一节介绍
- [ ] `docs/claude/working-protocol.md` 阶段 4 DoD 模板含 seed 一节
- [ ] 冷启第一次打开 `/gateway` / `/employees` / `/skills` / `/mcp-servers` / `/traces` 都有数据 · 每页截图 `plans/screenshots/i0020-seed-<page>.png`
- [ ] 回归测试:`backend/tests/integration/test_seed_service.py` · 至少 6 条(各 domain 幂等性)· `web/tests/e2e/seed-full-house.spec.ts` 断言各页数量
- [ ] `./scripts/check.sh` 全绿

## 相关

- feedback memory:`feedback_seed_data_for_new_features.md`(已落)
- 被 I-0019(gateway nested)、I-0021(employee 设计页)消费 —— 它们的 DoD 依赖本 track 的 seed 基础设施
- 不冲突:可以独立推进 · 其他 track 写 seed 时先 stub 本地 JSON · 本 track 统一收口
