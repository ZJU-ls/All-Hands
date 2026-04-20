---
id: I-0013
title: Voice & Tone chapter + Lead welcome message never added
severity: P2
status: open
discovered_at: 2026-04-19
discovered_by: track-2-qa audit
affects: product/03-visual-design.md · design-system/MASTER.md · services/employee_service.py (lead system prompt)
reproducible: true
tags: [docs, ui]
---

# I-0013 · Voice & Tone chapter + Lead welcome missing

## Repro

1. `rg -n "Voice|Tone|语气" product/03-visual-design.md design-system/MASTER.md` → 0 hits
2. `rg -n "welcome|欢迎" backend/src/allhands/services/employee_service.py` → 0 hits
3. Open the Lead's first-turn response in any fresh conversation — it just echoes "Hi, how can I help?" generic.

## Expected

Per `2026-04-18-visual-upgrade.md §3.5 voice & tone rules`, the visual-design doc should carry a short chapter covering: pronouns, emoji policy, error phrasing, welcome phrasing. The Lead's system prompt should include a `welcome_message` template that introduces itself and offers 3 example prompts on empty conversations.

## Actual

Neither exists. Self-review Round 3 ("爱不释手") will mark this as a cluster of small findings. Not a blocker, but a first-impression gap.

## Suggested fix

1. Draft a concise Voice & Tone section in `03-visual-design.md` (≤ 250 words) + port rules into MASTER.md.
2. Update the lead-agent prompt (wherever the Lead's system prompt is assembled) to include `welcome_message` for empty conversations.
3. Unit test: assert the first SSE frame of an empty conversation contains welcome content.

## Acceptance criteria

- [ ] Voice & Tone section present in both docs
- [ ] New empty conversations receive a branded welcome
- [ ] Test asserts welcome content

## 关闭记录

- **2026-04-20** · 修复提交 pending · 回归测试:
  - `backend/tests/unit/test_model_service_validation.py` (I-0002 · ModelConfigError + service-boundary ctx_window > 0)
  - `backend/tests/unit/test_gateway_seeds.py::test_gateway_seed_every_model_has_positive_context_window` (seed 数据回归)
  - `backend/tests/unit/test_model_service_validation.py::test_set_default_model_*` (I-0003 · ProviderConfigError + cross-check enabled model)
  - `backend/tests/unit/test_gateway_seeds.py::test_gateway_seed_default_model_points_to_existing_model` (seed 数据回归)
  - `web/tests/render-library-coverage.test.ts` 14 用例 · design-lab 静态扫 MarkdownCard / PlanTimeline / PlanCard / Artifact.Preview 活样本存在 (I-0012)
  - `backend/tests/unit/test_lead_welcome.py` 6 用例 · Lead prompt 含 "Welcome message" 节 + `欢迎` + ≥3 条示例 + Style 节 voice rules (I-0013)
  - `web/tests/voice-tone.test.ts` 4 用例 · 扫 `web/app/**` + `web/components/**` 的 emoji / `!` / `咱们` / 按钮文案 (I-0013)
  - `web/tests/first-run.test.ts` 8 用例 · localStorage 持久化语义 (I-0014)
  - `web/tests/coachmark.test.tsx` 4 用例 · Coachmark 首次显示 / dismiss / 再访不显示 (I-0014)
- **同步修改**:
  - `product/03-visual-design.md §9.1` 新增 Voice & Tone 章 (I-0013)
  - `design-system/MASTER.md §6.5` 新增 Voice & Tone 速查表 (I-0013)
  - `backend/src/allhands/execution/prompts/lead_agent.md` 新增 Welcome message + 扩 Style / Voice & Tone 节 (I-0013)
  - `web/lib/first-run.ts` + `web/components/ui/Coachmark.tsx` 新建 · `Cockpit.tsx` 埋 3 条 coachmark (I-0014)
  - `web/vitest.setup.ts` 加 localStorage shim 绕开 Node 25 built-in 拦截
