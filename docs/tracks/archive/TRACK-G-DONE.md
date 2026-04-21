# Track G · /traces + ArtifactPanel SSE · DONE

**Branch:** `traces-artifacts-live` (cut from `main` at `f5e8276`)
**HEAD:** `8a38316`
**Scope:** two independent UI gaps — /traces was a 10-line placeholder; ArtifactPanel polled every 10 s instead of consuming the I-0005 SSE fan-out that Track A shipped.

## Commits

```
8a38316 [track-g] test: vitest cover traces-page + artifact-panel-sse
84d8f7d [track-g] feat(artifacts-ui): subscribe /api/artifacts/stream · live update
0657af8 [track-g] feat(traces): real trace list + filter + detail panel
```

`./scripts/check.sh` ran green before every commit (enforced by pre-commit hook):
backend ruff / format / mypy / import-linter / pytest · web lint / typecheck / vitest · visual-discipline · L01 tool-first symmetry · walkthrough-acceptance v0.

## Files changed / added

```
web/app/traces/page.tsx                            | +214  -5      rewrite placeholder → real page
web/components/artifacts/ArtifactPanel.tsx         | +96  -28      SSE consumer, three states
web/components/traces/TraceFilters.tsx             | +162         new — filter bar
web/components/traces/TraceTable.tsx               | +188         new — sortable table
web/components/traces/TraceDetailDrawer.tsx        | +152         new — side drawer
web/components/traces/__tests__/traces-page.test.tsx   | +211      new — 5 cases
web/components/artifacts/__tests__/artifact-panel-sse.test.tsx | +280  new — 7 cases
web/lib/artifacts-api.ts                           | +25          artifactStreamUrl + frame types
web/lib/observatory-api.ts                         | +4           fetchTraces accepts since/until
web/tests/artifact-panel.test.tsx                  | +20          EventSource stub (jsdom has none)
```

## A. /traces real page (commit `0657af8`)

- **Filter bar** · time range (1h/24h/7d/30d/all) · 员工 dropdown (from `listEmployees`) · 状态 (all/ok/failed) · 关键词 (client-side substring filter on trace_id + employee_name) · count pill · refresh button.
- **Table** · sticky header, row click opens drawer, sortable columns (started_at · duration · tokens) with ↑/↓ indicator. Keyboard Enter/Space also opens the row.
- **Detail drawer** · 420 px side panel — status pill · employee · started_at · duration · tokens · Langfuse external link (`<host>/trace/<id>`, `target="_blank"`) when `observatory.host` is set. No iframe — per spec langfuse is external-link only.
- **Three states** · reuses Track B `LoadingState` / `ErrorState` / `EmptyState` · EmptyState offers a "reset filters" action.
- **Pagination** · "加载更多" button uses `until = oldest trace's started_at` as cursor · dedupes by `trace_id` · "已到末尾" sentinel when fewer rows return than `PAGE_SIZE (50)`.
- **Back-end surface** · only extended `fetchTraces` to thread `since` / `until` through; no backend changes.

## B. ArtifactPanel subscribes `/api/artifacts/stream` (commit `84d8f7d`)

- Removed the 10 s `setInterval` refresh loop.
- Opens `new EventSource(artifactStreamUrl())` on mount; closed on unmount.
- Event handling per I-0005 `artifact_changed` frame:
  - `op = "created"` → `getArtifact(id)` then **prepend**.
  - `op = "updated"` / `"pinned"` → `getArtifact(id)` then **replace in place**.
  - `op = "deleted"` → filter out; closes the detail pane if the deleted artifact was selected.
  - Malformed frame → swallowed; next event or remount reconciles.
- Pin / unpin that other clients (or meta-tool calls) trigger flow back through the stream — no local setState from the pin button (consistent with the prompt's "走 stream 回路").
- Added an `· offline` chip in the header when the browser `error` event fires so users notice when the live feed is wedged.
- Three states wired via Track B (`LoadingState` on first fetch, `ErrorState` when the initial list fetch fails with no cached items, `EmptyState` when the list is clear).

## C. Tests (commit `8a38316`)

Added 12 vitest cases across 2 files. Both drive a `FakeEventSource` + hoisted `vi.mock` of the API layer so we don't hit network.

**`components/artifacts/__tests__/artifact-panel-sse.test.tsx` (7 cases)**

| # | Case |
| - | --- |
| 1 | Opens `/api/artifacts/stream`, shows `LoadingState`, hydrates after first list resolve |
| 2 | `op = created` prepends and calls `getArtifact(id)` |
| 3 | `op = updated` replaces the row in place (new name shows, old one disappears) |
| 4 | `op = deleted` removes the row without calling `getArtifact` |
| 5 | `op = pinned` flips the row to the "置顶" section (verified via `ArtifactList` section header) |
| 6 | `setInterval` is never installed — the 10 s polling regression would fail here |
| 7 | `EventSource.close()` fires on unmount |

**`components/traces/__tests__/traces-page.test.tsx` (5 cases)**

| # | Case |
| - | --- |
| 1 | Loading state on the first fetch promise |
| 2 | Error state when `fetchTraces` rejects |
| 3 | Empty state when the API returns `[]` |
| 4 | Tokens column sort — click once flips to desc (big→small), click again flips to asc |
| 5 | Row click opens the drawer with the right Langfuse href (`https://lf.example/trace/tr_open`, `target="_blank"`) |

## Guardrails honoured

- **Visual contract (CLAUDE.md §3.5)** · no icon library imports; colour via tokens only; no parallel `dark:` classes; no `hover:scale` / `hover:shadow`; no animation libraries. Confirmed green by the `visual-discipline` gate in `check.sh`.
- **Scope · only touched** `web/app/traces/**` · `web/components/traces/**` · `web/components/artifacts/ArtifactPanel.tsx` · `web/components/artifacts/__tests__/**` · `web/lib/artifacts-api.ts` · `web/lib/observatory-api.ts` · `web/tests/artifact-panel.test.tsx` (EventSource stub only).
- **Untouched** — main nav (Track E) · Composer (Track D) · Cockpit (Track B) · /skills · /mcp-servers (Track F). No backend code changed.
- **Commit discipline** · 3 commits, all prefixed `[track-g]`; `./scripts/check.sh` ran green via pre-commit hook before each; no `--no-verify` / `--dangerously-skip-permissions`.

## Follow-ups (out of scope for this track)

- **Trace steps inline** · backend `TraceSummary` / `get_trace` expose only summary fields. The drawer notes "完整 step 见 Langfuse" and externally links; wiring inline steps needs either a new `GET /api/observatory/traces/{id}/events` endpoint or the Langfuse HTTP client (spec § 5.4, deferred to wave 2).
- **Playwright e2e for /traces** · `web/tests/e2e/traces-flow.spec.ts` would cover the three states + drawer + Langfuse link. The I-0011 xfail list shows the e2e harness is still catching up, so we deferred rather than land a flaky/skipped file.
- **Virtualised table** · at >500 traces the flat tbody will hurt; wire up a windowing lib when someone actually hits that. Today's `limit 50 + load more` keeps it cheap.
- **ArtifactPanel detail pane reuse of SSE updates** · when an artifact's version changes while the detail pane is open, the pane doesn't auto-refresh (it still uses `ArtifactDetail`'s own fetch). Non-blocker; artifact detail tracks I-0005 separately.

## Screenshots

Not captured in this worktree — the dev server wasn't started since the visual gate + vitest cover the regression surface and the prompt calls screenshots "optional" when harness is not available. `TRACK-G-DONE.md` is the text artefact of record.
