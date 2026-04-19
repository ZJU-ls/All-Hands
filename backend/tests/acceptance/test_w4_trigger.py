"""W4 · Build a trigger + fire it.

Skeleton for W4 walkthrough (not v0-active yet). The trigger family landed on
main so the structural preconditions already exist; this file asserts that
shape so when cockpit's event-consumer work lands, W4 flips from skeleton to
live without re-authoring the file.

Preconditions asserted:
1. ``/triggers`` + ``/triggers/[id]`` routes exist.
2. ``triggers.py`` router exposes ``POST /`` (create) + ``POST /{id}/fire``.
3. ``create_trigger`` + ``fire_trigger_now`` + ``list_trigger_fires`` Meta
   Tools registered.
4. ``create_trigger`` is WRITE + gated.

Until a live browser run asserts the end-to-end (event-in → agent responds),
this file stays sign-of-life. The live run is covered by
``cockpit.run_walkthrough_acceptance({paths:["W4"]})``.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

STAGE_ID = "W4"


def _stage(plan: dict, stage_id: str) -> dict:
    return next(s for s in plan["stages"] if s["id"] == stage_id)


def test_triggers_routes_exist(web_app_dir: Path) -> None:
    for rel in ("triggers/page.tsx", "triggers/[id]/page.tsx"):
        target = web_app_dir / rel
        assert target.exists(), f"W4 expects web/app/{rel}"


def test_triggers_router_has_create_and_fire(routers_dir: Path) -> None:
    path = routers_dir / "triggers.py"
    assert path.exists(), "W4 precondition: routers/triggers.py"
    src = path.read_text(encoding="utf-8")
    assert re.search(r'@router\.post\(\s*"",', src), (
        "W4 expects POST / on triggers.py (create_trigger REST mirror)"
    )
    assert "/fire" in src, "W4 expects POST /{trigger_id}/fire (fire_trigger_now REST mirror)"


def test_required_meta_tools_registered(walkthrough_plan, meta_tools_dir: Path) -> None:
    stage = _stage(walkthrough_plan, STAGE_ID)
    joined = "\n".join(p.read_text(encoding="utf-8") for p in meta_tools_dir.glob("*_tools.py"))
    missing = [t for t in stage["required_meta_tools"] if t not in joined]
    if missing:
        pytest.xfail(
            f"W4 missing meta tools {missing} — triggers spec has shipped the "
            f"name set but walkthrough still in skeleton mode. "
            f"Precondition: {stage['preconditions']}"
        )


def test_create_trigger_is_gated(meta_tools_dir: Path) -> None:
    path = meta_tools_dir / "trigger_tools.py"
    if not path.exists():
        pytest.xfail("W4 skeleton: trigger_tools.py not yet present")
    text = path.read_text(encoding="utf-8")
    marker = 'name="create_trigger"'
    if marker not in text:
        pytest.xfail("W4 skeleton: create_trigger not yet registered")
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
        "create_trigger must be WRITE (schedules recurring work)"
    )
    assert "requires_confirmation=True" in block, (
        "create_trigger must set requires_confirmation=True (CLAUDE.md §3.3)"
    )
