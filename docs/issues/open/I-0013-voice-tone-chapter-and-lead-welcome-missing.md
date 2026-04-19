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
