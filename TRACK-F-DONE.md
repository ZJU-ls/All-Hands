# Track F · DONE

> Deepen `/skills` + `/mcp-servers` from list-only to list + detail with
> loading / empty / error terminal states.

**Branch:** `deepen-skills-mcp` (based on `main @ f5e8276`)
**HEAD:** `1a04e98`
**Worktree:** `/Volumes/Storage/code/allhands-track-f`

## Commits

```
1a04e98 [track-f] test: vitest cover skills-detail + mcp-detail three-state
6bf3519 [track-f] feat(mcp-servers): [id] detail page with transport/tools/logs tabs
196c0f0 [track-f] feat(skills): [id] detail page with tabs + shared state
```

## New / modified files

| File | Change | Purpose |
| --- | --- | --- |
| `web/app/skills/[id]/page.tsx` | new (509 L) | Skill detail: header + 4 tabs (概览 / 参数 / 版本 / 依赖图) |
| `web/app/skills/[id]/__tests__/skills-detail.test.tsx` | new (228 L) | vitest × 4: loading / ready+tabs / error / notfound |
| `web/app/skills/page.tsx` | modified | Row-level `<Link>` → detail page; delete button preserved |
| `web/app/mcp-servers/[id]/page.tsx` | new (639 L) | MCP detail: header + 4 tabs (概览 / 工具 / 日志 / 健康时间线) |
| `web/app/mcp-servers/[id]/__tests__/mcp-detail.test.tsx` | new (222 L) | vitest × 4: loading / ready+tabs+lazy-tools / error / notfound |
| `web/app/mcp-servers/page.tsx` | modified | Row-level `<Link>` → detail page; inline actions preserved |
| `TRACK-F-FOLLOWUP.md` | new | 6 backend / meta-tool gaps surfaced by the detail pages |
| `web/pnpm-lock.yaml` | regen | Catch-up for `@testing-library/dom` already listed in package.json |

**Diff:** `8 files changed, 1660 insertions(+), 6 deletions(-)`

## Verification

### `./scripts/check.sh`

All checks passed end-to-end before **each** of the three commits — the
pre-commit hook runs the full gauntlet. The last run covers:

- backend: ruff lint + format + mypy strict + import-linter + pytest
- web: eslint + tsc `--noEmit` + vitest (574 tests pass / 43 skipped)
- visual discipline scan: no icon library, no raw Tailwind color classes,
  no `dark:` parallels, no hover:scale / hover:shadow, no animation libs
- tool-first symmetry (`TestL01ToolFirstBoundary`): green
- self-review + walkthrough-acceptance gates: green

### Targeted vitest

```
✓ app/skills/[id]/__tests__/skills-detail.test.tsx     (4 tests)
✓ app/mcp-servers/[id]/__tests__/mcp-detail.test.tsx   (4 tests)
```

Covers the three-state matrix per track spec §4:

| State | Skills | MCP |
| --- | --- | --- |
| Loading | ✓ pending fetch | ✓ pending fetch |
| Ready | ✓ header + 4 tabs via click (overview / prompt / versions / deps) | ✓ header + 4 tabs + lazy tools fetch + schema expand |
| Error | ✓ fetch reject surfaces `ErrorState` | ✓ fetch reject surfaces `ErrorState` |
| NotFound | ✓ 404 → `EmptyState` with back link | ✓ 404 → `EmptyState` with back link |

## Visual contract (CLAUDE.md §3.5)

- Zero third-party icon imports: ✓ (`grep -R "lucide\|heroicon\|phosphor\|tabler" web/app/skills/[id] web/app/mcp-servers/[id]` → none)
- All colors via token (`bg-surface`, `text-text-muted`, `border-border`,
  `text-danger`, …). No raw `bg-blue-500` / `text-zinc-400` / `dark:*`.
- Transitions use `duration-base` + `transition-colors` only.
- Shared `LoadingState` / `ErrorState` / `EmptyState` (Track B components)
  are the sole terminal-state renderers — no ad-hoc spinner / alert boxes.

## Screenshots

Live browser screenshots deferred: this track ships against static
fixtures only, no backend was started (spec explicitly allowed).
The **vitest render assertions** above are the contract that guarantees
each state + each tab panel renders with the expected data-testids +
copy. When a full stack is up, the following URLs are the ones to
eyeball:

- `http://localhost:3006/skills` — list with clickable rows
- `http://localhost:3006/skills/skill.builtin.search` — detail (overview)
- `http://localhost:3006/skills/skill.builtin.search` + click 依赖图 tab
- `http://localhost:3006/mcp-servers` — list with clickable rows
- `http://localhost:3006/mcp-servers/{id}` — detail (overview)
- `http://localhost:3006/mcp-servers/{id}` + click 工具 tab (lazy fetch)

## Followups

Tracked in [`TRACK-F-FOLLOWUP.md`](./TRACK-F-FOLLOWUP.md):

- FU-F-1 · Skill version history endpoint + meta tool
- FU-F-2 · Tool-id metadata lookup (`GET /api/tools/{id}`)
- FU-F-3 · Dedicated MCP reconnect verb + meta tool (today reuses `/test`)
- FU-F-4 · MCP communication log endpoint (`/mcp-servers/{id}/logs`)
- FU-F-5 · MCP health timeline storage + endpoint
- FU-F-6 · Playwright e2e covering list → detail → confirm flows

## Hard constraints respected

- Worktree: `/Volumes/Storage/code/allhands-track-f` · branch `deepen-skills-mcp`
- Touched only: `web/app/skills/**` + `web/app/mcp-servers/**` +
  `TRACK-F-FOLLOWUP.md` + lockfile catch-up. No edits to AppShell /
  composer / MessageBubble / `/models` / backend `core/*` / `services/*`.
- No `--no-verify`, no `--dangerously-skip-permissions`.
- Every commit prefixed `[track-f]` and gated by `./scripts/check.sh`
  (pre-commit hook).
