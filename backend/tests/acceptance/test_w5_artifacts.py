"""W5 · Artifacts live push (chat → panel).

Blocked by I-0005 · ``artifact_changed`` SSE event is never emitted, so Lead's
``artifact_create`` output cannot light up the ArtifactPanel in realtime. Until
Track A lands the fix, the realtime assertion xfails with a pointer to the
issue. The structural preconditions (routers + meta tools + panel component)
already exist and are asserted as real.

When I-0005 closes, flip the xfail in
``test_artifact_changed_event_emitted`` to a plain assert and close the issue
per ``docs/issues/README.md``.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

STAGE_ID = "W5"


def _stage(plan: dict, stage_id: str) -> dict:
    return next(s for s in plan["stages"] if s["id"] == stage_id)


def test_artifacts_router_exists_with_reads(routers_dir: Path) -> None:
    path = routers_dir / "artifacts.py"
    assert path.exists(), "W5 precondition: routers/artifacts.py"
    src = path.read_text(encoding="utf-8")
    # We need at least the read surface — writes go via Meta Tool gate.
    assert re.search(r"@router\.get\b", src), "W5 expects GET endpoints on artifacts.py"


def test_artifact_panel_component_exists(repo_root: Path) -> None:
    panel = repo_root / "web" / "components" / "artifacts" / "ArtifactPanel.tsx"
    assert panel.exists(), (
        "W5 expects ArtifactPanel to exist in web/components/artifacts/ "
        "(it's the 'live push' target)"
    )


def test_required_meta_tools_registered(walkthrough_plan, meta_tools_dir: Path) -> None:
    stage = _stage(walkthrough_plan, STAGE_ID)
    joined = "\n".join(p.read_text(encoding="utf-8") for p in meta_tools_dir.glob("*_tools.py"))
    missing = [t for t in stage["required_meta_tools"] if t not in joined]
    assert not missing, (
        f"W5 missing meta tools {missing} — artifact Meta Tool surface is the "
        f"entry point for the chat-driven write path"
    )


def test_artifact_changed_event_emitted(repo_root: Path, walkthrough_plan) -> None:
    """W5 realtime DoD · blocker I-0005.

    When Track A lands ``artifact_changed`` on execution/events.py + has the
    service publish it, this xfails becomes a pass. The stage in plan.json
    carries blocker_issues=["I-0005"] so the pointer is machine-readable.
    """
    stage = _stage(walkthrough_plan, STAGE_ID)
    assert "I-0005" in stage["blocker_issues"], (
        "walkthrough_plan.json must declare I-0005 as a blocker on W5"
    )
    events = repo_root / "backend" / "src" / "allhands" / "execution" / "events.py"
    service = repo_root / "backend" / "src" / "allhands" / "services" / "artifact_service.py"
    events_text = events.read_text(encoding="utf-8") if events.exists() else ""
    service_text = service.read_text(encoding="utf-8") if service.exists() else ""
    has_event = "artifact_changed" in events_text or "ArtifactChanged" in events_text
    has_publish = "artifact_changed" in service_text or "ArtifactChanged" in service_text
    if not (has_event and has_publish):
        pytest.xfail(
            "W5 blocker I-0005: artifact_changed event not emitted — artifacts "
            "SSE realtime path cannot be verified"
        )
