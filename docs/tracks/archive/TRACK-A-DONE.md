# Track A · I-0005 · DONE

Branch: `fix-artifacts-sse` (from main `e473bcd`)
Date: 2026-04-19

## Scope

Fixed P0 **I-0005 · `artifact_changed` SSE event never emitted**. Artifact panel can now live-update instead of requiring a page refresh.

## HEAD commit

Single commit on `fix-artifacts-sse` — subject: `[fix-i0005] emit artifact_changed on every artifact write + /api/artifacts/stream SSE`. Run `git log -1 fix-artifacts-sse` for the SHA (recording the SHA in this file would self-reference and drift on every amend).

## Files touched

**backend (prod):**
- `backend/src/allhands/execution/events.py` — add `ArtifactChangedEvent` envelope model.
- `backend/src/allhands/services/artifact_service.py` — accept optional `EventBus`; publish `kind="artifact_changed"` at end of `create` / `update` / `delete` / `set_pinned`; silent no-op when no bus wired.
- `backend/src/allhands/api/deps.py` — `get_artifact_service` resolves bus from `request.app.state.trigger_runtime.bus`.
- `backend/src/allhands/api/routers/artifacts.py` — new `GET /api/artifacts/stream` SSE endpoint (subscribe → filter `artifact_changed` → forward; 15 s heartbeat).

**backend (tests):**
- `backend/tests/integration/test_artifacts_sse.py` (new) — 6 tests covering service → bus publication for every write path (create / update / delete / pin / no-bus silent) + SSE endpoint forwards frames (driving the route coroutine directly to sidestep the known TestClient+aiosqlite+SSE deadlock).
- `backend/tests/acceptance/test_audit_regressions.py` — `test_i0005_artifact_changed_event_emitted` flipped from `pytest.xfail` to hard `assert`; comment updated.

**docs:**
- `docs/issues/open/I-0005-artifact-changed-sse-missing.md` → `docs/issues/closed/I-0005-artifact-changed-sse-missing.md` (+ frontmatter status → closed, closed_at/closed_by + `## Resolution` section).
- `docs/issues/INDEX.md` — removed I-0005 row; P0: 3 → 2, open: 12 → 11; added history line.

## Regression xfail → pass proof

Before:
```
$ uv run pytest tests/acceptance/test_audit_regressions.py::test_i0005_artifact_changed_event_emitted
... XFAIL (I-0005: artifact_changed SSE event never emitted — ...)
```

After:
```
$ uv run pytest tests/acceptance/test_audit_regressions.py::test_i0005_artifact_changed_event_emitted tests/unit/test_artifact_service.py tests/integration/test_artifacts_flow.py -v
...
tests/acceptance/test_audit_regressions.py::test_i0005_artifact_changed_event_emitted PASSED [  5%]
tests/unit/test_artifact_service.py .............                             [ 68%]
tests/integration/test_artifacts_flow.py ......                               [100%]
============================== 19 passed in 1.06s ==============================
```

The I-0005 row is also gone from the xfail list in the full `check.sh` run (no longer appears in "XFAIL" short summary).

## `./scripts/check.sh` tail

```
[1;32mAll checks passed.[0m
```

Full triage gate:
```
==> bug triage signoff (docs/issues/INDEX.md)
✓ INDEX P0 = 2
✓ INDEX P1 = 4
✓ INDEX P2 = 5
✓ INDEX open = 11
! P0 issue count = 2 · feature commits must clear P0 first (INDEX §usage 1)
```

Full suite:
```
702 passed, 1 skipped, 13 xfailed, 12 warnings in 8.95s
```
(Skipped = pre-existing `cockpit.stream` deadlock workaround. 13 xfails = the other open audit issues, I-0005 no longer among them.)

## Out of scope / follow-ups

- **Frontend subscribe.** `web/components/chat/ArtifactPanel.tsx` still fetches on mount; subscribing to `/api/artifacts/stream` is a separate frontend task (constrained by this track's `不改 web/` rule).
- **Meta tool wiring.** `artifact_tools.py` declarations still have no executors bound to the service; unrelated to I-0005.
