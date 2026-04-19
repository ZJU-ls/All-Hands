# Track 3 · notification-channels · DONE

**Spec** [`docs/specs/agent-design/2026-04-19-notification-channels.md`](docs/specs/agent-design/2026-04-19-notification-channels.md)
**Branch** `track-3-stock` · one commit below this marker
**Date** 2026-04-19

---

## What landed

- Migration `0009_add_channels.py` · 3 tables (channels · channel_subscriptions · channel_messages) · up + down verified on sqlite
- `core/channel.py` Pydantic domain · `ChannelKind / NotificationPayload / InboundMessage / DeliveryResult / ChannelSubscription / ChannelMessage`
- `persistence/orm/channels_orm.py` · 3 ORM rows (registered via single-line import in `persistence/orm/__init__.py`)
- `persistence/channel_repos.py` · 3 Protocols + 3 SQL impls
- `execution/channels/` · `ChannelAdapter` ABC + **2 real adapters** (Telegram double-ended, Bark outbound) + **4 stubs** (WeCom, Feishu, Email, PushDeer) · auto-discovery
- `services/channel_service.py` · CRUD + subscriptions + send_direct + notify (topic fan-out) + handle_inbound
- `services/channel_inbound.py` · Inbound→ChatService bridge · find-or-create conversation per (channel, user_ref) · fire-and-forget drain
- `api/routers/channels.py` · **10 REST endpoints** + separate `notifications_router` · all write paths covered
- `execution/tools/meta/channel_tools.py` · **9 Meta Tools** (list / register / update / delete / test / send_notification / list_subscriptions / update_subscription / query_channel_history) · L01 parity enforced
- `web/app/channels/page.tsx` · list + register wizard + test + delete
- `web/app/channels/[id]/page.tsx` · detail + subscriptions CRUD + recent 50 messages audit

## Tests (all green in `./scripts/check.sh`)

- `tests/unit/channels/test_adapters.py` · 15 cases · Telegram happy/error/signature/inbound + Bark + stubs raise
- `tests/unit/channels/test_service.py` · 12 cases · CRUD + subscription routing + severity/symbol filter + inbound handler callback + update partials
- `tests/unit/test_l01_stock_suite.py` · 4 cases · parity between write routes and Meta Tool files (channels covered · market skipped until next spec lands)
- `tests/integration/test_channel_api.py` · 11 cases · REST through TestClient with fake adapter monkey-patched in
- `tests/integration/test_channel_inbound_to_chat.py` · 2 cases · `build_inbound_handler` creates conversation and reuses on subsequent messages

Total: **44 new backend test cases** · plus 434 existing web tests still green · ruff / ruff-format / mypy strict / lint-imports / pnpm lint / typecheck / vitest all pass.

## Touches on existing files (single-line register only)

- `backend/src/allhands/api/app.py` · import + include_router for `channels_router` and `notifications_router`
- `backend/src/allhands/persistence/orm/__init__.py` · import `channels_orm` module to register tables with `Base.metadata`
- `backend/src/allhands/execution/tools/__init__.py` · import + register `ALL_CHANNEL_META_TOOLS` in `discover_builtin_tools`

No other existing file was changed. Feature is pluggable in/out via those three lines.

## Known v0 limitations

- 4 stub adapters raise `NotImplementedError` on `send` · real HTTP plumbing lands in v1
- No retry / DLQ · failures are logged + persisted in `channel_messages.error_message`
- Single-user model · `external_user_ref` conversation routing assumes one-to-one
- Telegram MarkdownV2 escaping deferred to v1 · v0 trusts agent-authored titles
- AppShell side menu not touched (per strict file constraint) · `/channels` is reachable by URL until a Wave 3 visual tweak adds the entry

## Next step

`2026-04-19-market-data.md` · migration 0010 + providers + poller.
