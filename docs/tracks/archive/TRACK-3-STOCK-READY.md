# Track 3 · Stock 套件 · READY

**Branch** `track-3-stock` (base `main@14b2948`)
**Date** 2026-04-19
**Three specs · three commits · one worktree · zero cross-track collisions**

---

## Commits (newest → oldest)

1. `[track-3-stock] feat(stock-assistant): first real skill on channels+market+triggers`
2. `[track-3-stock] feat(market): market data layer + 3 free providers + anomaly poller`
3. `[track-3-stock] feat(channels): notification channel abstraction + Telegram/Bark + 4 stubs`

Each commit passes `./scripts/check.sh` green (ruff + ruff-format + mypy strict + lint-imports + pytest + pnpm lint + typecheck + vitest).

Migration sequence extended: `0008 → 0009 (channels) → 0010 (market)`. Single head.

---

## Files added (all new · zero modifications to existing Track 1 / Track 2 territory)

### notification-channels
```
backend/alembic/versions/0009_add_channels.py
backend/src/allhands/core/channel.py
backend/src/allhands/persistence/orm/channels_orm.py
backend/src/allhands/persistence/channel_repos.py
backend/src/allhands/services/channel_service.py
backend/src/allhands/services/channel_inbound.py
backend/src/allhands/execution/channels/{__init__.py,base.py,telegram.py,bark.py,wecom.py,feishu.py,email.py,pushdeer.py}
backend/src/allhands/execution/tools/meta/channel_tools.py
backend/src/allhands/api/routers/channels.py
backend/tests/unit/channels/{__init__.py,test_adapters.py,test_service.py}
backend/tests/unit/test_l01_stock_suite.py
backend/tests/integration/test_channel_api.py
backend/tests/integration/test_channel_inbound_to_chat.py
web/app/channels/page.tsx
web/app/channels/[id]/page.tsx
TRACK-3-CHANNELS-DONE.md
```

### market-data
```
backend/alembic/versions/0010_add_market.py
backend/src/allhands/core/market.py
backend/src/allhands/persistence/orm/market_orm.py
backend/src/allhands/persistence/market_repos.py
backend/src/allhands/services/market_service.py
backend/src/allhands/execution/market/{__init__.py,base.py,sina_realtime.py,akshare_provider.py,baostock_provider.py,tushare_pro.py,xtquant.py,efinance_provider.py,router.py,poller.py}
backend/src/allhands/execution/tools/meta/market_tools.py
backend/src/allhands/api/routers/market.py
backend/tests/unit/market/{__init__.py,test_providers.py,test_router.py,test_poller.py}
backend/tests/integration/test_market_api.py
backend/tests/integration/test_market_poller_to_trigger.py
web/app/market/page.tsx
web/app/market/[symbol]/page.tsx
TRACK-3-MARKET-DONE.md
```

### stock-assistant
```
backend/skills/builtin/stock_assistant/SKILL.yaml
backend/skills/builtin/stock_assistant/prompts/{guidance.md,stock_watcher.md}
backend/skills/builtin/stock_assistant/triggers/{anomaly_to_telegram,opening_briefing_cron,closing_journal_cron}.yaml
backend/src/allhands/execution/tools/meta/stock_tools.py
backend/tests/unit/test_stock_assistant.py
backend/tests/integration/test_stock_assistant_flow.py
web/app/stock-assistant/setup/page.tsx
TRACK-3-STOCK-ASSISTANT-DONE.md
```

## Files touched (single-line register only · spelled out in each commit message)

- `backend/src/allhands/api/app.py` · include_router for `channels_router`, `notifications_router`, `market_router`
- `backend/src/allhands/persistence/orm/__init__.py` · import `channels_orm` + `market_orm` so alembic `Base.metadata` sees new tables
- `backend/src/allhands/execution/tools/__init__.py` · register `ALL_CHANNEL_META_TOOLS` + `ALL_MARKET_META_TOOLS` + `ALL_STOCK_ASSISTANT_TOOLS` in `discover_builtin_tools`

No existing `core/*.py` / `services/*.py` / `execution/*.py` (outside `channels/` + `market/` subdirs) was edited. No Track 1 / Track 2 file was touched.

---

## Test counts

| Suite | New cases | Status |
|---|---|---|
| `tests/unit/channels/` | 27 | ✓ |
| `tests/unit/market/` | 24 | ✓ |
| `tests/unit/test_stock_assistant.py` | 10 | ✓ |
| `tests/unit/test_l01_stock_suite.py` | 4 | ✓ |
| `tests/integration/test_channel_api.py` | 11 | ✓ |
| `tests/integration/test_channel_inbound_to_chat.py` | 2 | ✓ |
| `tests/integration/test_market_api.py` | 11 | ✓ |
| `tests/integration/test_market_poller_to_trigger.py` | 1 | ✓ |
| `tests/integration/test_stock_assistant_flow.py` | 3 | ✓ |
| **Total new** | **93** | **all green** |

Plus pre-existing suite: 594 backend + 455 web all still pass. One pre-existing cockpit SSE skip (unrelated).

### Full pipeline

```
./scripts/check.sh
  ==> backend: ruff (lint)         All checks passed!
  ==> backend: ruff (format check) 203 files already formatted
  ==> backend: mypy (strict)       Success: no issues found in 139 source files
  ==> backend: import-linter       Contracts: 3 kept, 0 broken.
  ==> backend: pytest              594 passed, 1 skipped
  ==> web: lint                    No ESLint warnings or errors
  ==> web: typecheck               OK
  ==> web: test                    455 passed | 37 skipped
  All checks passed.
```

---

## Manual smoke (recommended before merging to main)

- [ ] `docker compose up` (port 8002/3002 per Track 3 convention)
- [ ] Open `/channels` → register a real Telegram bot (bot_token + chat_id) → press Test → see `ok`
- [ ] `/channels/{id}` → add subscription `stock.briefing.daily`
- [ ] `/market` → + 加自选 `SSE:600519 贵州茅台` → + 加持仓 100 @ 1700 → start poller
- [ ] `/stock-assistant/setup` → watch all 5 steps turn green
- [ ] `/chat` with 老张 → ask "给我开盘 briefing" → expect Telegram message

---

## Known v0 limitations

- akshare / baostock are optional deps — `ProviderNotSupported` is the fallback path; Sina realtime covers quote hot-path for free
- 4 channel adapters (WeCom / Feishu / Email / PushDeer) raise `NotImplementedError` on send — they exist to receive config (v1 plumbs real transport)
- Poller runs via explicit `POST /api/market/poller/start` (not lifespan-attached) to respect the Wave 2 strict-only-add constraint
- `portfolio_health` / `sanity_check_order` / `screen_by_logic` tools are schema-only skeletons
- AppShell sidebar doesn't list `/channels`, `/market`, `/stock-assistant/setup` because adding menu items requires touching an existing file beyond "single-line register"; routes reachable by URL

---

## Ready signal for coordinator

Track 3 = all three specs delivered · `track-3-stock` branch is clean and tested. Coordinator (cron 9afb88dd) can `git merge --no-ff track-3-stock` + rerun `./scripts/check.sh`; white-list design guarantees no Track 1 / Track 2 conflicts.
