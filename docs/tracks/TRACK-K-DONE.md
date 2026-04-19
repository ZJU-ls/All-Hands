# Track K · DONE

**Issue:** [I-0019](../issues/closed/I-0019-gateway-nested-view-and-per-model-tests.md) · P1 · /gateway 单页嵌套 + 每模型 ping + 对话双按钮
**Branch:** `gateway-nested-redesign`
**Worktree:** `/Volumes/Storage/code/allhands-track-a`
**Ports:** web :3010 · backend :8010
**HEAD:** `dd3206b`

---

## 交付一览

| Phase | Commit | 内容 |
|---|---|---|
| 1 | `ce0d8d8` | `docs/tracks/K-design-notes.md` · 视觉契约线框 + PingIndicator 状态机规格 + 颜色密度自检 |
| 2 | `f6f0e2d` | `POST /api/models/{id}/ping` · `allhands.meta.ping_model`(L01 成对)· 6+5 TDD 用例 |
| 3 | `330a1ea` | `PingIndicator` / `ModelRow` / `ProviderSection` + `page.tsx` 853→637 行 accordion |
| 4 | `dd3206b` | `bootstrap_service.ensure_gateway_demo_seeds`(3 × 7) + e2e 三 case |

---

## 关键文件

**新增:**
- `web/components/gateway/PingIndicator.tsx` · 4 态 · 7px token 静点/脉动 · CATEGORY_LABEL
- `web/components/gateway/ModelRow.tsx` · 行内 [ping][对话][删除] + inline PingIndicator
- `web/components/gateway/ProviderSection.tsx` · ▾/▸ 折叠 + 批量 ping 进度 + 默认/禁用 chip
- `docs/tracks/K-design-notes.md` · Phase 1 契约基线
- `backend/tests/unit/test_ping_model_meta_tool.py` · 6 用例
- `backend/tests/integration/test_model_ping_endpoint.py` · 5 用例
- `backend/tests/unit/test_gateway_seeds.py` · 5 用例

**修改:**
- `backend/src/allhands/api/routers/models.py` · 新 `ping_model` endpoint + 5s httpx 超时
- `backend/src/allhands/execution/tools/meta/model_tools.py` · `PING_MODEL_TOOL` 注册
- `backend/src/allhands/services/bootstrap_service.py` · `GATEWAY_SEED_PRESETS` + `ensure_gateway_demo_seeds`
- `backend/src/allhands/main.py` · startup hook 上挂 seed
- `web/app/gateway/page.tsx` · 重写为 accordion(853→637 行 · 含 Suspense 外壳)
- `web/tests/e2e/gateway.spec.ts` · 重写为 accordion 契约(3 case)
- `web/tests/error-patterns.test.ts` · E03 在无 useSearchParams 页面时 idle

---

## 验收 DoD

- [x] `/gateway` 一次看到所有 provider + 所有 model(默认全展开 · 用户 toggle 保留)
- [x] 每 model 行 [ping] + [对话] · PingIndicator 4 态 + 中文类别
- [x] `POST /api/models/{id}/ping` · max_tokens=4 · 5s 超时 · 错误分类共享 `run_chat_test`
- [x] `allhands.meta.ping_model` 注册 · `TestL01ToolFirstBoundary` 持续绿
- [x] 3 seed providers(百炼 / OpenRouter / DeepSeek)· 共 7 models · 首装幂等
- [x] 视觉契约:颜色密度 3(灰 · 绿 · 琥珀状态点)· 全 token · `duration-base` · 无 icon 库
- [x] `./scripts/check.sh` 全绿:backend 799 passed + web 993 passed + L01 TestBoundary 绿 + self-review passed + walkthrough-acceptance passed

---

## 视觉对照(PingIndicator 状态机)

```
idle      · [·]  灰 7px 静点
running   · [◯]  7px spinner + "测试中"
ok        · [●]  success 脉动点 + "✓ 123ms" mono
fail      · [●]  danger 静点 + "✗ 认证失败" mono · hover=完整 error
```

## 后续可做(不阻断关闭)

- 折叠状态持久化到 URL query(?expand=id1,id2)——deferred;当前 session-local 已够用
- 批量连通性测试切换成 `SSE` 流式进度而非轮询 Promise.all · 当 ≥20 model 时意义大
- Seed provider 支持从 `.env` 读 `DASHSCOPE_API_KEY` 自动注入(目前留空由用户 UI 填)
- I-0020 seed 基础设施整体方案(CLI `allhands seed dev` · employee / skill / mcp 全量 demo)仍 open

---

## L01 自证

PING endpoint + meta tool 双入口成对:

| REST | Meta Tool |
|---|---|
| `POST /api/models/{id}/ping` | `allhands.meta.ping_model(model_id)` |

两者共享 `run_chat_test` 实现 · 语义等价 · 通过 `TestL01ToolFirstBoundary` 全自动校验。
