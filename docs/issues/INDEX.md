# allhands · Open Issues Index

> 只列 `status ∈ {open, in-progress, blocked}` 的 issue。
> `closed` 的在 `closed/` 目录 · 不再出现在此表。
> **新建 / 关闭 issue 必须同步更新本表。**

最后更新:2026-04-20(关闭全部 5 条 P2 · I-0002/I-0003/I-0012/I-0013/I-0014 · P0/P1/P2 = 0 · open → 0)

---

## 现役清单

| ID | Severity | Status | Title | Affects | Discovered | Blocker-for | Tags |
|---|---|---|---|---|---|---|---|
| — | — | — | open 清单已清空 | — | — | — | — |

---

## 分布

| 维度 | 数量 |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| **open** | 0 |
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
- 2026-04-19 · Track K 关闭 I-0019(/gateway master-detail → accordion · PingIndicator 4 态状态机 · `POST /api/models/{id}/ping` + `allhands.meta.ping_model` 成对 · 6+5+5 后端用例 + 3 playwright smoke · provider/model seed 由 Track N 的 `seed_service` 统一供给)· P1 2 → 1 · open 10 → 9
- 2026-04-19 · Track L 关闭 I-0021(/employees/design Phase-3B · `execution/modes/{execute,plan,plan_with_subagent,preview}.py` 单一展开算法 · `plan_with_subagent.max_iterations=15`(SIGNOFF Q7)· `POST /api/employees/preview` 配 `PREVIEW_EMPLOYEE_COMPOSITION_TOOL`(L01 REST+Meta 双入口)· PresetRadio 3 选一友好中文名 + DesignForm + DryRunPanel + SkillMultiPicker + max-iterations field · 10 preview + 6 e2e + L01 green · §3.2 6 层证据)· P1 1 → 0 · open 9 → 8
- 2026-04-19 · Track M 关闭 I-0022(skill 动态注入 + Subagent + PlanCard · Phase 1 `resolve_skill` + `SkillDescriptor` + `SkillRuntime` + `bootstrap_employee_runtime` + AgentRunner per-turn rebuild (V02 §2.1) · Phase 2 `spawn_subagent` + `sk_executor_spawn` + depth-cap (V10 §4.5) · Phase 3 `sk_planner` + `render_plan` + PlanCard · system-prompt token 1752→140 / 92% 缩减 · 7 ref-src-claude citations · 10 integration + 8 unit + 5 web + L01 green)· P0 3 → 2 · open 8 → 7
- 2026-04-19 · Track J 阶段 1 诊断 I-0018 · `docs/tracks/J-diagnosis.md` · Next rewrites **证伪** · 根因两层叠加(H1 上游 batching · H2 前端 React 18 同步 batching)
- 2026-04-19 · Track J 关闭 I-0018(`stream-client.ts` WHILE 循环每帧 `await setTimeout(0)` 让出宏任务 · `web/lib/__tests__/stream-client.test.ts` + `web/tests/e2e/model-test-streaming.spec.ts` 两条回归)
- 2026-04-19 · Track J 关闭 I-0017(AG-UI Protocol v1 全链路迁移 · ADR 0010 · `backend/api/ag_ui_encoder.py` v1 事件工厂 + camelCase + `encode_sse()` · 后端 4 端点 chat/model-test/cockpit/artifacts 同步切换 · `stream-client.ts` 重写为 AG-UI v1 parser + 11 typed 回调 + `onCustom` + `onEvent` · 4 web 消费者切语义钩子 · `test_ag_ui_wire_format.py` + e2e 两本 spec · P0 2 → 0 · open 7 → 5)
- 2026-04-20 · 关闭 I-0002(`LLMModelService` 加 `ModelConfigError` + create/update 守 `context_window > 0` · seed 数据补 positive-ctx 回归)· P2 5 → 4
- 2026-04-20 · 关闭 I-0003(`LLMProviderService.set_default_model` 新增 · cross-check 依赖 `LLMModelRepo` 里存在且 `enabled=True` 的同名 model · seed 数据补 default-model-exists 回归)· P2 4 → 3
- 2026-04-20 · 关闭 I-0012(`web/app/design-lab/page.tsx` 新增 `RenderLibraryShowcase` · 活样本覆盖 MarkdownCard / PlanTimeline / PlanCard / Artifact.Preview · `web/tests/render-library-coverage.test.ts` 14 用例守门)· P2 3 → 2
- 2026-04-20 · 关闭 I-0013(`product/03-visual-design.md §9.1` Voice & Tone 章 + `design-system/MASTER.md §6.5` 速查表 + `lead_agent.md` Welcome message + 扩 Style 节 · `backend/tests/unit/test_lead_welcome.py` 6 用例 + `web/tests/voice-tone.test.ts` 4 用例 扫 emoji / `!` / 咱们 / 按钮文案)· P2 2 → 1
- 2026-04-20 · 关闭 I-0014(`web/lib/first-run.ts` localStorage 持久化 + `web/components/ui/Coachmark.tsx` 组件 + `Cockpit.tsx` 埋 3 条 coachmark · `web/vitest.setup.ts` 加 Node-25 localStorage shim · 8+4 用例守门首次显示 / dismiss / 持久化语义)· P2 1 → 0 · open → 0
