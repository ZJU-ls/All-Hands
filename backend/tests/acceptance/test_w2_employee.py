"""W2 · Self-build an employee (chat only).

Sign-of-life assertions (structural preconditions for the live W2 path):

1. /employees list route exists.
2. ``create_employee`` meta tool present + declared WRITE + gated
   (Tool-First redemption + CLAUDE.md §3.3).
3. An ``EmployeeCard`` render component is registered — without it, Lead's
   ``create_employee`` result cannot render inline in chat so the user has to
   leave /chat to see what got built (N1 breach).

(3) is the **open blocker** (issue I-0008); it stays ``xfail`` with the issue
ID until Track B ships the EmployeeCard component. When that lands, this test
flips to ``XPASS`` and the xfail should be removed.
"""

from __future__ import annotations

from pathlib import Path

import pytest

STAGE_ID = "W2"


def _stage(plan: dict, stage_id: str) -> dict:
    return next(s for s in plan["stages"] if s["id"] == stage_id)


def test_employees_list_route_exists(web_app_dir: Path) -> None:
    assert (web_app_dir / "employees" / "page.tsx").exists(), (
        "W2 expects /employees list route to exist"
    )


def test_create_employee_meta_tool_present(walkthrough_plan, meta_tools_dir: Path) -> None:
    stage = _stage(walkthrough_plan, STAGE_ID)
    joined = "\n".join(p.read_text(encoding="utf-8") for p in meta_tools_dir.glob("*_tools.py"))
    for tool in stage["required_meta_tools"]:
        assert tool in joined, (
            f"W2 chat-only CRUD requires meta tool '{tool}'. "
            f"Without it, the user must leave chat to build an employee — N1 breach."
        )


def test_create_employee_is_gated(meta_tools_dir: Path) -> None:
    """WRITE scope + requires_confirmation=True on create_employee.

    Without a gate, Lead can create employees silently — P0 red per spec §3.7.2.
    """
    path = meta_tools_dir / "employee_tools.py"
    text = path.read_text(encoding="utf-8")
    marker = 'name="create_employee"'
    assert marker in text, "create_employee Meta Tool missing from employee_tools.py"
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
        "create_employee must be WRITE-scope"
    )
    assert "requires_confirmation=True" in block, (
        "create_employee must declare requires_confirmation=True (CLAUDE.md §3.3; spec §3.7.2 P0)"
    )


def test_render_card_for_employee_registered(repo_root: Path) -> None:
    """W2 expects an Employee-shaped render component.

    This currently xfails: the registry has MarkdownCard / PlanTimeline /
    Viz.* / Artifact.Preview but no EmployeeCard. See issue I-0008
    (audited gap from docs/specs/agent-design/2026-04-18-employee-chat.md).
    Flip to ``assert`` once the issue is closed.
    """
    registry = repo_root / "web" / "lib" / "component-registry.ts"
    if not registry.exists():
        pytest.xfail("component-registry.ts not present")
    text = registry.read_text(encoding="utf-8")
    if "Employee" not in text:
        pytest.xfail(
            "W2 audit gap (I-0008 · blocker declared in walkthrough_plan.json): "
            "employee-chat spec ships /employees list + create_employee meta tool, "
            "but no EmployeeCard render component is registered — Lead's "
            "create_employee result cannot render inline in chat"
        )
