# Track F · FOLLOWUP

> Short list of backend / meta-tool gaps surfaced by the `/skills/[id]` +
> `/mcp-servers/[id]` detail pages. None of these blocked the track — each
> is currently surfaced as an `EmptyState` placeholder on the relevant tab.

## Skills

- **FU-F-1 · Version history endpoint**
  Backend currently returns a single `version` string per skill. The
  `版本历史` tab on `/skills/[id]` shows a placeholder until a
  `GET /api/skills/{id}/versions` (and sibling meta tool) lands.

- **FU-F-2 · Tool-id lookup**
  `/skills/[id] · 依赖图` shows raw `tool_id`s and classifies them by prefix
  (`allhands.builtin.*` vs `allhands.mcp.*`). Ideal: `GET /api/tools/{id}`
  returning `{name, description, scope, requires_confirmation}` so the
  dependency table can show rich info + link to /gateway.

## MCP servers

- **FU-F-3 · Dedicated reconnect verb + meta tool**
  `/mcp-servers/[id]` "重连" button currently re-uses the existing
  `POST /api/mcp-servers/{id}/test` endpoint (which re-handshakes). Ideal:
  a semantically distinct `POST /api/mcp-servers/{id}/reconnect` + the
  sibling `mcp_server.reconnect` meta tool (CLAUDE.md §3.1 symmetry).

- **FU-F-4 · MCP communication log endpoint**
  The `日志` tab shows an empty-state placeholder. Add
  `GET /api/mcp-servers/{id}/logs?limit=N&level=…` streaming recent
  handshake / request / response / error lines.

- **FU-F-5 · Health timeline storage**
  The `健康时间线` tab only renders the current `{last_handshake_at, health}`
  row. Persist a rolling window (e.g. last 20 status transitions) and expose
  `GET /api/mcp-servers/{id}/health/timeline`.

## Visual / infra

- **FU-F-6 · Detail-page e2e coverage**
  vitest covers render + tab-switch + three-state. Real browser flows
  (click through list → detail → delete confirm → back) should land as
  playwright specs once the harness is ready for per-track e2e.
