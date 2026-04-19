---
id: I-0002
title: `qwen3.6-plus` 模型 context_window=0 · 前端设置页显示异常 / Agent token 预算失效
severity: P2
status: open
discovered_at: 2026-04-18
discovered_by: walkthrough(api-probe)
affects: backend(models seed / 0003_llm_models migration)· web(/settings 模型列表)· execution(AgentRunner 用 ctx 计算预算)
reproducible: true
blocker_for: —
tags: [backend, data]
---

# I-0002 · qwen3.6-plus context_window=0

## Repro

1. 后端已启动 · seed 已跑过 · `curl http://localhost:8000/api/models`
2. 返回体里 `context_window: 0`

## Expected

`qwen3.6-plus` 真实 context window ~128000(或与 provider docs 对齐的正数)。

## Actual

```json
[{"id":"cee427af-50c9-4418-b477-2bd9b17a4a09",
  "provider_id":"0b84b3fb-4491-4cf9-b7e7-840fceee1095",
  "name":"qwen3.6-plus",
  "display_name":"qwen3.6-plus",
  "context_window": 0,
  "enabled":true}]
```

## 影响面

- **UI**:`/settings` 模型列表大概率显示 "0 tokens" · 用户困惑
- **Agent 运行时**:若 `AgentRunner` 用 `ctx - max_output` 做 token 预算,这个 0 会导致预算为负 · 要么 early-fail 要么异常行为(具体要看 AgentRunner 是否有兜底)
- **Gateway Meta Tool**(`models_update`)默认值可能也是 0 · 新建模型会带这个坑

## 证据

- `curl -s http://localhost:8000/api/models`(上面 JSON)
- seed 或 migration 里 `context_window` 没填真实值(需排查 `backend/alembic/versions/0003_llm_models.py` 或对应 seed service)

## 根因(推测)

两种可能:

1. migration/seed 用了 `Column(..., default=0)` 或创建时没传值 · 落库成 0
2. `百炼` provider 对 context_window 还没做探测 · 需要手填

## 建议修法

- **短期**:在 seed / bootstrap 里写真实值(qwen3.6-plus 假设 128K → `context_window=128000`)
- **中期**:`services/gateway/models.py` 加一条:创建模型时 context_window 必须 > 0(Pydantic validator)
- **长期**:Meta Tool `gateway.models_upsert` 暴露 `context_window` 必填字段 · Lead Agent 对话建模型时提示用户填

## 验收标准

- [ ] `/api/models` 返回的 context_window 为真实正整数(> 0)
- [ ] 新增回归测试 `test_gateway.py::TestModelSeed::test_context_window_positive` · 校验种子模型 ctx > 0
- [ ] 若 Pydantic validator 加了 · 有对应 unit test 拒绝 ctx ≤ 0
- [ ] `/settings` 模型列表真机目测显示正确数值(截图:`plans/screenshots/I-0002/after-fix-*.png`)

## 相关

- error-patterns:暂无对应 E · 若再发同类"seed 带默认 0 值"→ 可升级为 E{nn}
- 前序 issue:—
- spec:`docs/specs/gateway-design.md`(或对应 gateway 设计文档)

---

## 工作记录

_待执行端拾起_
