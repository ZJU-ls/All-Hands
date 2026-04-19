"""W3 · Self-dispatch a task (fire-and-forget).

Sign-of-life assertions for the live W3 walkthrough:

1. ``tasks.py`` router exists + has POST (create) + the status-transition
   side verbs (cancel / answer / approve).
2. ``/tasks`` + ``/tasks/[id]`` routes exist in the web app.
3. Every ``required_meta_tools`` entry from plan.json is registered.
4. ``tasks_create`` declares WRITE + gate (so Lead cannot fire tasks silently).
5. ``TaskStatus`` covers the contract states queued / running / completed /
   failed / cancelled (+ needs_input / needs_approval) per the async spec.

The tasks spec merged as 8c847ea; these assertions are now live (no xfail).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

STAGE_ID = "W3"
WRITE_VERB = re.compile(r"@router\.(post|patch|put|delete)\b", re.IGNORECASE)


def _stage(plan: dict, stage_id: str) -> dict:
    return next(s for s in plan["stages"] if s["id"] == stage_id)


def test_tasks_router_present_and_writes(routers_dir: Path) -> None:
    path = routers_dir / "tasks.py"
    assert path.exists(), "W3 precondition: backend/src/allhands/api/routers/tasks.py"
    src = path.read_text(encoding="utf-8")
    assert WRITE_VERB.search(src), (
        "W3 needs tasks.py with POST (fire-and-forget create + state transitions)"
    )
    # Status-transition side verbs (cancel / answer / approve) per async tasks spec.
    for verb in ("/cancel", "/answer", "/approve"):
        assert verb in src, f"W3 expects tasks.py to expose {verb} (async spec §5 status flow)"


def test_tasks_route_page_exists(web_app_dir: Path) -> None:
    assert (web_app_dir / "tasks" / "page.tsx").exists(), "W3 expects /tasks list route"
    # /tasks/[id] detail page — N2 one-screen decision requires a focused view
    assert (web_app_dir / "tasks" / "[id]" / "page.tsx").exists(), (
        "W3 expects /tasks/[id] detail route (N2 · drill-in)"
    )


def test_required_meta_tools_registered(walkthrough_plan, meta_tools_dir: Path) -> None:
    stage = _stage(walkthrough_plan, STAGE_ID)
    joined = "\n".join(p.read_text(encoding="utf-8") for p in meta_tools_dir.glob("*_tools.py"))
    missing = [t for t in stage["required_meta_tools"] if t not in joined]
    assert not missing, (
        f"W3 missing meta tools {missing} — Lead cannot dispatch or watch tasks via chat"
    )


def test_tasks_create_is_gated(meta_tools_dir: Path) -> None:
    path = meta_tools_dir / "task_tools.py"
    text = path.read_text(encoding="utf-8")
    marker = 'name="tasks_create"'
    assert marker in text
    start = text.find(marker)
    block_start = text.rfind("Tool(", 0, start)
    depth = 0
    block_end = block_start
    for i, ch in enumerate(text[block_start:], start=block_start):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                block_end = i + 1
                break
    block = text[block_start:block_end]
    assert "ToolScope.WRITE" in block or "ToolScope.IRREVERSIBLE" in block, (
        "tasks_create must be WRITE (creates a durable work unit)"
    )
    assert "requires_confirmation=True" in block, (
        "tasks_create must set requires_confirmation=True (CLAUDE.md §3.3)"
    )


def test_task_status_enum_covers_contract(meta_tools_dir: Path) -> None:
    """The tasks_create tool's description promises a status contract.

    Spec §5 async tasks: queued → running → (needs_input | needs_approval) →
    completed | failed | cancelled. The enum is declared at module scope in
    task_tools.py; make sure none of the six contract states are missing.
    """
    text = (meta_tools_dir / "task_tools.py").read_text(encoding="utf-8")
    required_states = [
        "queued",
        "running",
        "needs_input",
        "needs_approval",
        "completed",
        "failed",
        "cancelled",
    ]
    missing = [s for s in required_states if f'"{s}"' not in text]
    assert not missing, (
        f"task_tools.py missing status enum entries {missing} — state transitions won't render"
    )


@pytest.mark.parametrize("route", ["artifacts.py"])
def test_tasks_produces_artifact(routers_dir: Path, route: str) -> None:
    """W3 DoD · 'task result publishes an artifact'.

    Structural proxy: the artifacts router has to exist so the task runner
    can persist + fetch outputs. If someone deletes the artifacts router,
    W3's final step silently stops producing evidence.
    """
    assert (routers_dir / route).exists(), f"W3 DoD expects artifacts pipeline; {route} missing"
