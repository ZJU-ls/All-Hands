---
id: I-0005
title: artifact_changed SSE event never emitted — artifact panel has no push signal
severity: P0
status: open
discovered_at: 2026-04-19
discovered_by: track-2-qa audit (walkthrough-acceptance scaffold)
affects: backend/execution/events.py · services/artifact_service.py · chat/ArtifactPanel
reproducible: true
blocker_for: walkthrough-acceptance W3 (artifact live-update), artifacts-skill spec DoD
tags: [backend, api, artifacts]
---

# I-0005 · artifact_changed SSE event never emitted

## Repro

1. Grep `backend/src/allhands/` for `artifact_changed` → 0 hits.
2. Open `backend/src/allhands/execution/events.py` — no `ArtifactChanged` event type.
3. Read `backend/src/allhands/services/artifact_service.py` — `create_artifact` / `update_artifact` do not call the event bus after writing.

## Expected

`docs/specs/agent-design/2026-04-18-artifacts-skill.md §7` and its DoD ("agent 执行 create → 制品面板实时出现") require an `artifact_changed` (or equivalent) event to fan out through the chat SSE stream, so the right-pane `ArtifactPanel` updates without a page reload.

## Actual

The service writes to the DB and returns. No event is published. The panel is therefore populated only on initial page load / explicit refetch. Live runs of W3 will look broken: the user sees the agent claim "artifact created" but the panel stays empty.

## Evidence

- `rg -n artifact_changed backend/` → 0 occurrences
- `backend/src/allhands/services/artifact_service.py` ends a create with `await self._repo.create(...)` and returns; no `await self._bus.publish(...)`.
- Frontend `web/components/chat/ArtifactPanel.tsx` re-reads `/api/artifacts?conversation_id=...` only when `conversationId` changes (no SSE subscription).

## Suggested fix

1. Add `ArtifactChanged` to `execution/events.py` (`workspace_id`, `conversation_id`, `artifact_id`, `kind`, `op: created|updated|deleted`).
2. Publish from `artifact_service` at the end of each write path.
3. Extend the existing conversation SSE stream (or cockpit stream) to relay it; ArtifactPanel subscribes and refetches/merges on each event.
4. Regression test: `backend/tests/integration/test_artifacts_sse.py` — simulate a create and assert the stream delivers an `artifact_changed` frame within N ms.

## Acceptance criteria

- [ ] `ArtifactChanged` event class exists + is published on every artifact write (unit test)
- [ ] Conversation SSE stream forwards it; `ArtifactPanel` subscribes (integration test)
- [ ] Walkthrough-acceptance W3 observes the artifact appear without a manual refresh

## Related

- spec: `docs/specs/agent-design/2026-04-18-artifacts-skill.md §7` + DoD
- spec: `docs/specs/agent-design/2026-04-18-walkthrough-acceptance.md W3`
