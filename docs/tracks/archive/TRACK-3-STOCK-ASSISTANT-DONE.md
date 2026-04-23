# Track 3 · stock-assistant · DONE

**Spec** [`docs/specs/agent-design/2026-04-19-stock-assistant.md`](docs/specs/agent-design/2026-04-19-stock-assistant.md)
**Branch** `track-3-stock` · one commit below this marker
**Date** 2026-04-19

---

## What landed

- `backend/skills/builtin/stock_assistant/SKILL.yaml` — auto-discovered by `SkillRegistry._load_builtin_skill`
- `backend/skills/builtin/stock_assistant/prompts/guidance.md` — the skill prompt fragment that trains the Lead Agent on data sourcing + tone + topic conventions
- `backend/skills/builtin/stock_assistant/prompts/stock_watcher.md` — "老张" persona / employee system prompt
- `backend/skills/builtin/stock_assistant/triggers/{anomaly_to_telegram,opening_briefing_cron,closing_journal_cron}.yaml` — 3 preset triggers that users import on /triggers
- `backend/src/allhands/execution/tools/meta/stock_tools.py` — 6 declared tools:
  - Production-grade (v0): `generate_briefing` · `explain_anomaly` · `daily_journal`
  - Skeleton (v0): `portfolio_health` · `sanity_check_order` · `screen_by_logic`
- `web/app/stock-assistant/setup/page.tsx` — 5-step onboarding wizard that inspects channel / watched / holdings / employee / trigger counts live

## Tests (all green in `./scripts/check.sh`)

- `tests/unit/test_stock_assistant.py` · 10 cases · skill loads · every tool_id registered · production descriptions compose platform Meta Tools · skeleton tools declared as "v0" · persona prompt exists · 3 trigger yamls parse into valid `Trigger` · briefing input schema
- `tests/integration/test_stock_assistant_flow.py` · 3 closed-loop cases · briefing → channel delivery captured · anomaly tick-once · full skill-to-tool-registry reachability

Total test run: **594 backend cases / 455 web cases** all green. Ruff / ruff-format / mypy strict / lint-imports / pnpm lint / typecheck / vitest all pass.

## Touches on existing files (single-line register only)

- `backend/src/allhands/execution/tools/__init__.py` · import + register `ALL_STOCK_ASSISTANT_TOOLS`

That's the only existing-file modification for this spec. Skill auto-discovery, trigger yamls, and web pages all sit in new files.

## Manual-test checklist

1. Open `/stock-assistant/setup` · see 5 steps pending.
2. Register Telegram (or Bark) channel on `/channels` · step 1 turns ✓.
3. Add 1 watched symbol + 1 holding on `/market` · step 2 turns ✓.
4. Enable an employee with `skill_ids` including `allhands.skills.stock_assistant` · step 3 turns ✓.
5. Create 3 triggers using the yaml presets · step 4 turns ✓.
6. Click ▶ start poller on `/market` · poller status bar green.
7. Open `/chat` and message the 老张 employee with "看看今天" — he composes list_holdings + get_quote + get_news + send_notification using the skill guidance.

## Known v0 out-of-scope

- No real LLM-driven end-to-end integration test (requires provider + API key; covered by existing trigger/briefing dispatch path)
- Skeleton tools (portfolio_health / sanity_check_order / screen_by_logic) return agent-composed output only — no structured backend computation yet
- Preset triggers are installed manually via UI/yaml paste; auto-install on skill enable is a v1 ergonomics feature
- Briefing / journal do not auto-subscribe the user's channel to `stock.briefing.daily` / `stock.journal.daily` — the user sets the subscription on `/channels/[id]`

## Full track summary

Three specs, three commits, one Track-3 branch. All platform primitives (channels · market · stock-assistant) compose through Meta Tools so the Lead Agent can perform every user-facing operation via chat.
