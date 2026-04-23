# Track 3 · market-data · DONE

**Spec** [`docs/specs/agent-design/2026-04-19-market-data.md`](docs/specs/agent-design/2026-04-19-market-data.md)
**Branch** `track-3-stock` · one commit below this marker
**Date** 2026-04-19

---

## What landed

- Migration `0010_add_market.py` · 4 tables (watched_symbols · holdings · market_snapshots · market_news) · up + down verified
- `core/market.py` · Symbol / Quote / Bar / NewsItem / Announcement / WatchedSymbol / Holding / ScreenCriteria / PollerThresholds / MarketAnomalyEvent
- `persistence/orm/market_orm.py` · 4 ORM rows · auto-registered via `persistence/orm/__init__.py`
- `persistence/market_repos.py` · 4 Protocols (WatchedSymbolRepo · HoldingRepo · SnapshotRepo · NewsRepo) + SQL impls
- `execution/market/` · full provider layer
  - `base.py` · `MarketDataProvider` ABC + `Capability` enum + error taxonomy (`ProviderNotSupported / RateLimitError / TransientError`)
  - **3 real providers**: `SinaRealtimeProvider` (secondly quotes) · `AkshareProvider` (quote/bars/news/announcements/search · lazy-imported) · `BaoStockProvider` (historical bars · lazy-imported)
  - **3 stubs**: `TushareProProvider` · `XtQuantProvider` · `EfinanceProvider` · raise `ProviderNotSupported`
  - `router.py` · `MarketDataRouter` · capability-based priority + fallback on rate-limit / transient / not-supported
  - `poller.py` · `MarketPoller` + `detect_anomaly` pure function · start/stop/tick_once/set_thresholds · publisher callback emits `MarketAnomalyEvent`
- `services/market_service.py` · unified facade (quotes / bars / news / announcements / search / screen / watched / holdings / CSV import / poller lifecycle)
- `api/routers/market.py` · **21 REST endpoints** (CRUD + poller start/stop/status/thresholds/tick-once) · app-state-scoped poller to avoid lifespan modification
- `execution/tools/meta/market_tools.py` · **16 Meta Tools** · full L01 parity

## Tests (all green in `./scripts/check.sh`)

- `tests/unit/market/test_providers.py` · 10 cases · Sina parse + error paths + stub capabilities + akshare fake-module injection
- `tests/unit/market/test_router.py` · 6 cases · priority / fallback / capability routing
- `tests/unit/market/test_poller.py` · 8 cases · anomaly detection matrix + start/stop idempotency
- `tests/integration/test_market_api.py` · 11 cases · full REST through TestClient with fake provider
- `tests/integration/test_market_poller_to_trigger.py` · 1 closed-loop case · poller → events table with `market.anomaly` kind
- `tests/unit/test_l01_stock_suite.py` · market row activated (previously skipped)

Total: **35+ new backend test cases** · plus 448 web tests still green · ruff / ruff-format / mypy strict / lint-imports / pnpm lint / typecheck / vitest all pass.

## Touches on existing files (single-line register only)

- `backend/src/allhands/api/app.py` · include_router for `market_router`
- `backend/src/allhands/persistence/orm/__init__.py` · import `market_orm` module to register tables
- `backend/src/allhands/execution/tools/__init__.py` · register `ALL_MARKET_META_TOOLS` in `discover_builtin_tools`

Plus the `channels` registers from the previous commit — they stay single-line.

## Web pages

- `web/app/market/page.tsx` · 自选 + 持仓 2-tab view · poller status bar · add drawer · CSV import hook (REST endpoint live · UI upload control is v1)
- `web/app/market/[symbol]/page.tsx` · quote header · 1m/5m/15m/30m/1h/1d K-line intervals with ASCII spark line · news + announcements cards · "问老张归因" prefill deep-link to /chat

## Known v0 limitations

- akshare / baostock are not in default deps · provider raises `ProviderNotSupported` when missing · router auto-falls-through to Sina (quote only)
- `screen()` against akshare returns an empty list (v0) · real screen logic lives in the stock-assistant `screen_by_logic` tool
- No lifespan wiring for the poller — it's started/stopped via `POST /api/market/poller/{start,stop}` so strict-only-add rule is honored
- No WebSocket stream · v0 HTTP polling
- K-line chart is ASCII spark line (Linear Precise tokens only) · a proper candlestick renderer is v1

## Next step

`2026-04-19-stock-assistant.md` · skill manifest + 6 tools + 3 preset triggers + 老张 persona + onboarding wizard.
