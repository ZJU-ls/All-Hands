"""W1 · Bootstrap · from zero to usable.

Sign-of-life only — a live browser run is done by
``cockpit.run_walkthrough_acceptance`` (spec §3.3). Here we assert:

1. /gateway route exists on the web side.
2. Providers + Models routers have write verbs (so the REST path is real).
3. Each of ``add_provider`` / ``create_model`` / ``chat_test_model`` appears as
   a Meta Tool string somewhere under ``execution/tools/meta/``.

When all three check out, W1's structural DoD is met. A failure here means the
Bootstrap flow is missing a piece *even before* we try to click it.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

WRITE_VERB = re.compile(r"@router\.(post|patch|put|delete)\b", re.IGNORECASE)
STAGE_ID = "W1"


def _stage(plan: dict, stage_id: str) -> dict:
    return next(s for s in plan["stages"] if s["id"] == stage_id)


def test_entry_route_is_realized(walkthrough_plan, web_app_dir: Path) -> None:
    stage = _stage(walkthrough_plan, STAGE_ID)
    seg = stage["entry_route"].strip("/")
    target = web_app_dir / seg / "page.tsx" if seg else web_app_dir / "page.tsx"
    assert target.exists(), (
        f"W1 entry route {stage['entry_route']} needs {target.relative_to(web_app_dir.parent)}"
    )


@pytest.mark.parametrize("router_file", ["providers.py", "models.py"])
def test_write_routes_exist(routers_dir: Path, router_file: str) -> None:
    src = (routers_dir / router_file).read_text(encoding="utf-8")
    assert WRITE_VERB.search(src), (
        f"W1 precondition broken: {router_file} has no write verbs "
        f"(bootstrap requires creating providers + models via REST)"
    )


def test_bootstrap_meta_tools_registered(walkthrough_plan, meta_tools_dir: Path) -> None:
    stage = _stage(walkthrough_plan, STAGE_ID)
    joined = "\n".join(p.read_text(encoding="utf-8") for p in meta_tools_dir.glob("*_tools.py"))
    for tool in stage["required_meta_tools"]:
        assert tool in joined, (
            f"W1 bootstrap tool '{tool}' not found in any meta/*_tools.py — "
            f"Lead Agent cannot Do The Thing via chat (Tool-First breach)"
        )
