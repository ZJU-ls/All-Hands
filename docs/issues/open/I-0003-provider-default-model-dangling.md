---
id: I-0003
title: Provider `百炼` default_model=`glm-5` · 但库里只有 `qwen3.6-plus` · 悬空引用
severity: P2
status: open
discovered_at: 2026-04-18
discovered_by: walkthrough(api-probe)
affects: backend(providers seed)· execution(AgentRunner 选模型时)· UI(/settings 默认模型下拉)
reproducible: true
blocker_for: —
tags: [backend, data]
---

# I-0003 · provider default_model 悬空

## Repro

1. 后端已启动 · `curl http://localhost:8000/api/providers`
2. 同时 `curl http://localhost:8000/api/models`
3. 对比:provider 的 `default_model` 字段值 vs models 表里实际 `name` 字段值

## Expected

`provider.default_model` 的值 **必须命中 models 表里某一行的 `name`**(同一 provider_id 下)。否则是悬空外键式错误。

## Actual

```json
// /api/providers
[{"id":"0b84b3fb-4491-4cf9-b7e7-840fceee1095",
  "name":"百炼",
  "base_url":"https://coding.dashscope.aliyuncs.com/v1",
  "api_key_set":true,
  "default_model":"glm-5",   // ← 指向不存在的模型
  "is_default":true,
  "enabled":true}]

// /api/models
[{"id":"...","provider_id":"0b84b3fb-...","name":"qwen3.6-plus",...}]
// 没有 glm-5 这一条
```

## 影响面

- **Agent 运行时**:AgentRunner 用 `provider.default_model` 去查模型 · 查不到就 fallback 或报错
- **UI**:`/settings` provider 卡片上"默认模型"字段显示的是个鬼值
- **Meta Tool `gateway.providers_get_default_model`**:返回的字符串与实际可用模型不匹配 · Lead Agent 调用它后再调 LLM 会 404

## 证据

同上 · 两条 curl 并置即可证伪。

## 根因(推测)

- 种子数据里把 `default_model` 写成 `glm-5`(某个早期测试残留)· 但模型表初始化出来的是 `qwen3.6-plus`
- 创建 provider 和创建 model 是两条独立路径 · 没有交叉校验

## 建议修法

- **短期**:seed 里把 `default_model` 改成 `qwen3.6-plus`(或者改成 provider 创建时首个落库模型的 name)
- **结构性**:`ProviderService.set_default_model(...)` 加校验:必须是本 provider 下已存在的模型,否则抛 `ProviderConfigError`
- **回归测试**:`test_gateway.py::TestProvider::test_default_model_must_exist` · 设定一个不存在的 default_model → 应抛错

## 验收标准

- [ ] `/api/providers` 返回的 `default_model` 必须能在 `/api/models` 里按 `name` 查到(同 provider_id)
- [ ] `ProviderService.set_default_model()` 若传入不存在模型 → 抛 `ProviderConfigError` + 有单测
- [ ] 新增 integration test:seed 完后校验所有 provider 的 default_model 都存在
- [ ] 手动确认:`/settings` provider 页显示的"默认模型"是 qwen3.6-plus 而非 glm-5

## 相关

- error-patterns:暂无 · 若这类"关联字段没做交叉校验"再出现一次 · 可升 E{nn}
- 前序 issue:I-0002(同属 gateway seed 的数据健康度)
- spec:`docs/specs/gateway-design.md`

---

## 工作记录

_待执行端拾起_
