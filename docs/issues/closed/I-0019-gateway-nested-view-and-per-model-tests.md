---
id: I-0019
severity: P1
status: closed
title: /gateway 改为单页嵌套展开视图 · 每个 model 行同时暴露"连通性测试"与"对话测试"两个入口
affects: web/app/gateway/page.tsx · web/components/gateway/* · backend/api/routers/models.py(新 ping endpoint)
discovered: 2026-04-19 / user-product-review
blocker-for: Wave-3 gateway 体验闭环 · 产品评审验收
tags: ui, ux, gateway
---

## Repro

1. `pnpm dev` 起 web
2. 打开 `http://localhost:3000/gateway`
3. 观察到左右双栏 master/detail:左边是 provider 列表,右边**只显示当前选中 provider 的 models**
4. 要想看"所有 provider + 所有 model 是什么样的",必须**逐个点击**

## Expected

单页嵌套全展开(accordion / disclosure 列表):

```
▾ 百炼(enabled · default model qwen3.6-plus · 4 models)  [连通性测试]  [编辑凭证]
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ qwen3.6-plus            ctx=131072  pricing=...     [ping]  [对话测试]     │
   │ qwen-max-latest         ctx=32768   pricing=...     [ping]  [对话测试]     │
   │ qwen-plus-2024-09-19    ctx=131072                  [ping]  [对话测试]     │
   │ qwen-turbo              ctx=131072                  [ping]  [对话测试]     │
   └──────────────────────────────────────────────────────────────────────────┘
▸ OpenRouter(enabled · 2 models)                              [连通性测试]
▸ DeepSeek(disabled · 1 model)                                [启用]
```

- 每个 provider 行可**折叠 / 展开**,默认全部展开(visible summary state)
- 每一**行 model** 暴露两个按钮:
  - **[ping]**:同步连通性测试 · 发一条 `{"role":"user","content":"ping"}` · max_tokens=4 · 成功即绿点 + latency 数字;失败红点 + 错误摘要(在本行内展示,不弹 modal)
  - **[对话测试]**:打开已存在的 `ModelTestDialog`(Track J 修完后的流式版本)
- 在 provider 头部保留 `[连通性测试]` 作为"批量测试该 provider 下所有 model"的入口(跑一遍所有 model 的 ping,结果落到每一行)

## Actual

- `web/app/gateway/page.tsx` 853 行,当前是 master/detail layout
- 连通性测试入口在 provider 级别(page.tsx:476-481 "连通性测试"按钮),model 级别没有
- `onTestModel` 弹 `ModelTestDialog`,但只能先选 provider 再选 model

## 评估方向

1. 重构 `page.tsx` 为 **accordion 列表** · 用 design-system 已有的 disclosure 组件(若没有则新建 `web/components/gateway/ProviderAccordion.tsx`)
2. 新增 model 行级 ping 按钮 · 结果在本行内展示(不弹 dialog)
3. 后端新增 `POST /api/models/{id}/ping` · 同步返回 `{ok: bool, latency_ms: int, error?: str}` · 实现走 `model_service.run_chat_test(..., max_tokens=4)` · 已有 `ping` meta tool → 复用或新增
4. **L01 Tool First** · 新增 `ping_model` meta tool(Lead Agent 对话里也能测)· 与 REST endpoint 成对出现
5. 视觉契约 · accordion 左边 1px 竖线(Linear Precise)· 无 icon 库 · 状态点 + kbd chip 区分 enabled/disabled
6. 保持 ModelTestDialog 消费者不变(Track J merge 后自然升级为 AG-UI 流式)

## 硬约束

- **不要**给员工数据加 `mode` 字段(与本 issue 无关,但贯彻 CLAUDE.md §3.2)
- **不要**扩 Lucide / Heroicons · 用 `web/components/icons/` 自有集或 kbd chip
- **不要**用 `bg-zinc-*` / 十六进制色 · 一律 token

## 验收标准

- [ ] `/gateway` 页面一次看到所有 provider + 所有 model(展开状态)· 截图放 `plans/screenshots/i0019-gateway-nested.png`
- [ ] 每个 model 行有 [ping] + [对话测试] 两按钮 · ping 成功时行内显示绿点 + latency · 失败时红点 + 错误
- [ ] 后端新 `POST /api/models/{id}/ping` · 通过 `curl` 能跑:`curl -X POST http://localhost:8010/api/models/<id>/ping | jq` 返回 `{ok, latency_ms, ...}`
- [ ] 对应 `ping_model` meta tool 已注册 · `test_learnings.py::TestL01ToolFirstBoundary` 通过
- [ ] 视觉回归:playwright 截图 `web/tests/e2e/gateway-nested.spec.ts` 断言"1 次进入看到 ≥ N 个 model row(N = seed 后的数量)"
- [ ] **Seed 数据**:bootstrap 保证至少 `3 providers × ≥ 5 models`(百炼 / OpenRouter / DeepSeek · 真实 base_url · 真实 model name · 跟 `.env.example` 对齐)· 首次冷启开页就是"满载状态"
- [ ] `./scripts/check.sh` 全绿 · `pnpm lint` + `pnpm typecheck` + `pnpm test` + `pnpm test:e2e` 全绿

## 相关

- 参考 Track J(ModelTestDialog 流式) —— 本 track 消费 J 的产物,不修改其内部
- L01 Tool First:Provider/Model 的 REST + Meta Tool 双入口
- 视觉契约:`product/03-visual-design.md` Linear Precise · ADR 0009
- Seed 规则:`docs/issues/open/I-0020`(seed 基础设施)· 本 issue 需要 seed 提供真实多 provider 多 model

## 关闭记录

- **关闭时间:** 2026-04-19
- **分支:** `gateway-nested-redesign`
- **提交链:**
  - `ce0d8d8` phase 1 · K-design-notes 视觉契约对齐
  - `f6f0e2d` phase 2 · `POST /api/models/{id}/ping` + `allhands.meta.ping_model`(L01 成对)
  - `330a1ea` phase 3 · accordion UI · PingIndicator / ModelRow / ProviderSection · page.tsx 853→637 行
  - `dd3206b` phase 4 · 3 seed providers × 7 models + e2e 三 case 回归

**回归测试:**
- `backend/tests/unit/test_ping_model_meta_tool.py` · 6 用例
- `backend/tests/integration/test_model_ping_endpoint.py` · 5 用例
- `backend/tests/unit/test_gateway_seeds.py` · 5 用例
- `web/tests/e2e/gateway.spec.ts` · 3 playwright smoke(empty→add→delete · error→retry · ping ok/fail)
- `backend/tests/learnings/test_learnings.py::TestL01ToolFirstBoundary` 持续绿(ping_model 进 ALL_MODEL_META_TOOLS)

**DoD:**

- [x] `/gateway` 单次进入看到所有 provider + 所有 model(默认全展开 · 用户 toggle 状态保留)
- [x] 每个 model 行 [ping] + [对话] 双按钮 · 4 态 PingIndicator(idle/running/ok/fail + 延迟 + 中文类别)
- [x] `POST /api/models/{id}/ping` · 5s httpx 超时 · max_tokens=4 · 走共享 run_chat_test 错误分类
- [x] `allhands.meta.ping_model` 注册 · TestL01ToolFirstBoundary 持续绿
- [x] 3 个 seed providers(百炼 · OpenRouter · DeepSeek)× 7 models · 首装幂等
- [x] 视觉契约 · 颜色密度 3 · 全 token · 无 icon 库 · duration-base
- [x] `./scripts/check.sh` 全绿
