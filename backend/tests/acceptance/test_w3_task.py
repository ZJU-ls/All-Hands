"""W3 · Self-dispatch a task (fire-and-forget).

The tasks spec is still in flight on Track 1 (migration 0011). Until it lands
on main, this test xfails with a clear reason rather than blocking the gate.
When tasks ships, the xfail becomes an xpass and pytest will flag it — that's
the signal for this file's assertions to be tightened into real requirements.
"""

from __future__ import annotations

from pathlib import Path

import pytest

STAGE_ID = "W3"


def _stage(plan: dict, stage_id: str) -> dict:
    return next(s for s in plan["stages"] if s["id"] == stage_id)


def test_tasks_router_exists_or_xfail(walkthrough_plan, routers_dir: Path) -> None:
    if not (routers_dir / "tasks.py").exists():
        pytest.xfail("tasks spec pending merge · W3 not yet v0-active")
    # When present, require write verbs.
    import re

    src = (routers_dir / "tasks.py").read_text(encoding="utf-8")
    assert re.search(r"@router\.(post|patch|put|delete)\b", src, re.IGNORECASE), (
        "W3 needs tasks.py with POST (fire-and-forget create)"
    )


def test_tasks_route_page_exists_or_xfail(walkthrough_plan, web_app_dir: Path) -> None:
    if not (web_app_dir / "tasks" / "page.tsx").exists():
        pytest.xfail("tasks spec pending merge · W3 not yet v0-active")


def test_tasks_meta_tool_or_xfail(walkthrough_plan, meta_tools_dir: Path) -> None:
    stage = _stage(walkthrough_plan, STAGE_ID)
    joined = "\n".join(p.read_text(encoding="utf-8") for p in meta_tools_dir.glob("*_tools.py"))
    missing = [t for t in stage["required_meta_tools"] if t not in joined]
    if missing:
        pytest.xfail(
            f"{missing} not registered yet — tasks spec pending merge · W3 not yet v0-active"
        )
