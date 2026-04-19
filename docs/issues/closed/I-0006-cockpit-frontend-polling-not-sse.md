---
id: I-0006
title: Cockpit frontend polls every 5s instead of consuming the SSE stream
severity: P0
status: closed
discovered_at: 2026-04-19
closed_at: 2026-04-19
discovered_by: track-2-qa audit
affects: web/components/cockpit/Cockpit.tsx · /api/cockpit/stream
reproducible: true
blocker_for: cockpit spec DoD ("SSE 首条 snapshot < 1s" · "SSE 断线/重启 → 前端自愈")
tags: [ui, api, perf]
---

# I-0006 · Cockpit frontend polls every 5s instead of consuming the SSE stream

## Repro

1. `grep EventSource web/` → 0 hits.
2. `grep /api/cockpit/stream web/` → 0 hits.
3. Open `web/components/cockpit/Cockpit.tsx` — observe `const POLL_MS = 5000` + `setInterval(load, POLL_MS)`.
4. Backend has `GET /api/cockpit/stream` (SSE) present and tested, but no frontend ever subscribes.

## Expected

`docs/specs/agent-design/2026-04-18-cockpit.md` (L7 Workspace SSE) specifies that the cockpit page subscribes to `/api/cockpit/stream` and applies snapshot + delta frames. DoD explicitly calls out "SSE 首条 snapshot < 1s" and "SSE 断线/重启服务 → 前端自愈".

## Actual

Frontend uses interval polling of `/api/cockpit/summary`. This means:
- First render is 0-5s stale
- Live activity (new conversation, task finish, trigger fire) shows up with a lag of up to `POLL_MS`
- No self-heal test is actually exercising the SSE reconnect path on the UI side

## Evidence

- `web/components/cockpit/Cockpit.tsx:20` `const POLL_MS = 5000`
- `web/components/cockpit/Cockpit.tsx:44-46` `setInterval(() => { load(); }, POLL_MS)`
- Zero EventSource references anywhere in `web/`

## Suggested fix

1. Replace the `setInterval` loop with an `EventSource("/api/cockpit/stream")`, falling back to the `/summary` endpoint only on `error` events.
2. Handle snapshot + delta frame types per the spec's event schema.
3. Keep `/summary` for the initial render (before the SSE snapshot frame arrives) to avoid a blank flash.
4. Regression: Playwright test that stops+restarts the backend and asserts the stream reconnects + the cockpit keeps updating.

## Acceptance criteria

- [ ] Cockpit component subscribes to `/api/cockpit/stream`
- [ ] Polling loop removed
- [ ] E2E test: disconnect/reconnect preserves the feed
- [ ] `plans/screenshots/.../fix-I-0006.png` shows live counter incrementing

## Related

- spec: `docs/specs/agent-design/2026-04-18-cockpit.md § L7 + §11 DoD`

## 关闭记录

- status: closed
- closed_at: 2026-04-19
- fix: `web/components/cockpit/Cockpit.tsx` replaced `setInterval(POLL_MS)` with `new EventSource(cockpitStreamUrl())`. Handles `snapshot` / `activity` / `run_update` / `run_done` / `health` / `kpi` / `heartbeat` / `error` frames. Initial `/summary` fetch kept only for instant first paint; snapshot frame remains the source of truth.
- regression test: `backend/tests/acceptance/test_audit_regressions.py::test_i0006_cockpit_consumes_sse` (xfail → pass) + `web/components/cockpit/__tests__/cockpit-sse.test.tsx` (4 cases: loading / hydration / delta append / stream error).
- UI states: loading / error / empty branches go through `EmptyState` / `ErrorState` / `LoadingState` (I-0007). setInterval polling is gone.
