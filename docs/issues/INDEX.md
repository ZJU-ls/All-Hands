# allhands · Open Issues Index

> 只列 `status ∈ {open, in-progress, blocked}` 的 issue。
> `closed` 的在 `closed/` 目录 · 不再出现在此表。
> **新建 / 关闭 issue 必须同步更新本表。**

最后更新:2026-04-19(Track N 关闭 I-0020 seed 基础设施 · Wave-3 基础设施闭环)

---

## 现役清单

| ID | Severity | Status | Title | Affects | Discovered | Blocker-for | Tags |
|---|---|---|---|---|---|---|---|
| [I-0017](open/I-0017-ag-ui-protocol-migration.md) | P0 | open | 前后端 SSE/streaming 协议统一迁移到 AG-UI Protocol · 自定义事件名不符合 AI-native 行业标准 | backend/api/routers/*.py · web/lib/stream-client.ts · 所有 SSE 消费点 | 2026-04-19 / user-product-review | Wave-3 AI-native · CopilotKit 接入 | arch, api, streaming, protocol |
| [I-0018](open/I-0018-model-test-stream-not-streaming.md) | P0 | open | /gateway 模型对话测试观感为非流式 · 字符一次性蹦出 | web/components/gateway/ModelTestDialog · backend/services/model_service · Next rewrites | 2026-04-19 / user-product-review | AI-native DoD(I-0016 本该已覆盖) | ui, streaming, bug |
| [I-0022](open/I-0022-dynamic-skill-injection-and-subagent.md) | P0 | open | Skill 作为 Tool 动态注入 + Subagent spawn + Plan 模式 · 参考 ref-src-claude | backend/execution/skills.py · agent_runner · core/tool.py · 新 execution/modes/* | 2026-04-19 / user-product-review | I-0021 员工设计页 · Wave-3 reasoning-light model 可用性 | backend, agent-runtime, arch |
| [I-0019](open/I-0019-gateway-nested-view-and-per-model-tests.md) | P1 | open | /gateway 改单页嵌套展开 · 每个 model 行 ping + 对话测试双按钮 | web/app/gateway · web/components/gateway · backend 新 ping endpoint | 2026-04-19 / user-product-review | Wave-3 gateway 体验闭环 | ui, ux, gateway |
| [I-0021](open/I-0021-employee-design-page.md) | P1 | open | /employees 员工设计(招聘)页 · preset + skill/mcp 挂载 · Dry run 预览 | web/app/employees · web/components/employee-design · employee_tools meta | 2026-04-19 / user-product-review | Wave-3 员工组织能力闭环 | ui, ux, employees |
| [I-0002](open/I-0002-model-context-window-zero.md) | P2 | open | `qwen3.6-plus` context_window=0 · 前端显示异常 / Agent token 预算失效 | backend(models seed) + web(settings) | 2026-04-18 / api-probe | — | backend, data |
| [I-0003](open/I-0003-provider-default-model-dangling.md) | P2 | open | Provider `百炼` default_model=`glm-5` · 但库里只有 `qwen3.6-plus` · 悬空引用 | backend(providers seed) | 2026-04-18 / api-probe | — | backend, data |
| [I-0012](open/I-0012-design-lab-missing-live-samples.md) | P2 | open | design-lab missing live samples for Viz components + Artifact.Preview | web/app/design-lab | 2026-04-19 / track-2-qa | — | ui, visual, docs |
| [I-0013](open/I-0013-voice-tone-chapter-and-lead-welcome-missing.md) | P2 | open | Voice & Tone chapter + Lead welcome message never added | product/03-visual-design · employee_service | 2026-04-19 / track-2-qa | — | docs, ui |
| [I-0014](open/I-0014-coachmark-firstrun-guide-missing.md) | P2 | open | Coachmark system + first-run guided tour not built | web/components/ui · lib/first-run | 2026-04-19 / track-2-qa | — | ui, onboarding |

---

## 分布

| 维度 | 数量 |
|---|---|
| P0 | 3 |
| P1 | 2 |
| P2 | 5 |
| **open** | 10 |
| **in-progress** | 0 |
| **blocked** | 0 |

---

## 使用说明

**执行端 Claude** · 在以下时机扫本表(细则见 [`docs/claude/bug-fix-protocol.md`](../claude/bug-fix-protocol.md)):

1. **每个 task commit 前** · 若 P0 清单非空 → 必须先修 P0
2. **每天第一个 commit 前** · 若 P1 清单非空 → 当日至少清 1 条
3. **关闭 plan 前** · P0 / P1 清单必须全空

**发现新 bug 的流程:**

1. `cp docs/issues/TEMPLATE.md docs/issues/open/I-<NNNN>-<slug>.md`
2. 填正文(repro + expected + actual + evidence)
3. 追加到本表末尾
4. commit:`docs(issues): I-<NNNN> <一句话>`

**关闭 issue 的流程:**

1. 修复代码 + 回归测试 · commit
2. issue 末尾追 `## 关闭记录` · 填 sha + 测试名
3. `mv open/I-<NNNN>-*.md closed/`
4. 本表里**删掉该行**(closed 不在本表露出)
5. commit:`fix(I-<NNNN>): <一句话> + 回归测试 <test_name>`

---

## 历史

- 2026-04-18 · 初建 · 录入 I-0001(E04 chunks blank)· I-0002(context_window=0)· I-0003(default_model 悬空)
- 2026-04-19 · 关闭 I-0001(E04 复发实例 · track-1 拾起 · dev 冷启 + routes-smoke 31/31 绿)
- 2026-04-19 · track-2-qa 审计 7 份交付 spec · 新增 I-0005…I-0014(3 P0 / 4 P1 / 3 P2)
- 2026-04-19 · 关闭 I-0005(track-A fix-artifacts-sse · ArtifactChangedEvent + bus 广播 + /api/artifacts/stream + tests/integration/test_artifacts_sse.py)
- 2026-04-19 · Track B 关闭 I-0007(EmptyState / ErrorState / LoadingState / FirstRun 全量落地 · vitest 6 用例 · design-lab 活样本)
- 2026-04-19 · Track B 关闭 I-0006(Cockpit 改 EventSource('/api/cockpit/stream') · snapshot + delta 帧 + 自愈重连 · 移除 POLL_MS/setInterval · vitest 4 用例消费 SSE)
- 2026-04-19 · Track I 关闭 I-0009(product/04-architecture.md 补齐 L5.9 Triggers & Event Bus + L5.7 8 条 trigger meta tool + L7.1 触发器/webhook/cockpit 路由 + L8.1 cockpit workspace SSE 帧清单 · test_i0009 xfail → assert)
- 2026-04-19 · Track I 关闭 I-0011(7 份 spec DoD 测试骨架全部落地 · backend 2 份 integration + web 4 份 e2e smoke · xfail/test.fixme 标注被阻塞的 follow-up · test_i0011 参数化 xfail → assert)
- 2026-04-19 · Track D 关闭 I-0015(Composer AI-native layout · 统一 send/stop)+ I-0016(全平台流式输出 + 打字机效果)· P0 2 → 0
- 2026-04-19 · Track H 关闭 I-0008(EmployeeCard render component + 注册表 + `EmployeeCardProps` 前后端对齐 + `execute_create_employee` 回包为 render envelope · `test_w2_employee.py::test_render_card_for_employee_registered` xfail → hard assert · 新增 `test_create_employee_returns_render_envelope` + unit/web 18 用例)
- 2026-04-19 · Track H 关闭 I-0010(`.eslintrc.json` `no-restricted-syntax` JSXText 规则 + `web/tests/no-raw-state-literal.test.ts` 86 用例守门 · 17 个 app/components 文件扫荡到 `<LoadingState/>` / `<EmptyState/>` / `<ErrorState/>` · `ConversationHeader` 保留 inline 占位 + per-line 豁免 1 处)
- 2026-04-19 · 用户产品评审 Wave-2 merge 后新增 I-0017(AG-UI 协议迁移)+ I-0018(模型测试非流式 bug)· 分发 Track J(复用 `allhands-track-d` worktree · 分支 `ag-ui-migration-and-stream-fix`)
- 2026-04-19 · Wave-3 并行分发 · 新增 I-0019(gateway 嵌套)+ I-0020(seed 基础设施)+ I-0021(员工设计页)+ I-0022(skill 动态注入)· 分发 Track K/N/L/M(复用 `allhands-track-a/e/b/c` · 端口 3010-3013/8010-8013)
- 2026-04-19 · Track N 关闭 I-0020(seed 数据基础设施 · `seed_service.py` + `ensure_all_dev_seeds()` + 7 domain `ensure_*` + `data/seeds/*.json` × 7 + `allhands-seed` CLI + `main.py::_should_seed` dev/test 自动 · `working-protocol.md` §4 DoD seed 块 + L02 + E01 · 回归 `test_seed_service.py` 10 cases + `test_seed_cli.py` 7 cases + `seed-full-house.spec.ts` 冷启 5 页 ≥ N)· P1 3 → 2 · open 11 → 10
