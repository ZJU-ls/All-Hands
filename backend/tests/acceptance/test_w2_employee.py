"""W2 · Self-build an employee (chat only).

Sign-of-life assertions:
1. /employees list route exists.
2. ``create_employee`` meta tool present (Tool-First redemption).
3. An ``EmployeeCard`` render component or equivalent is registered.
"""

from __future__ import annotations

from pathlib import Path

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


def test_render_card_for_employee_registered(repo_root: Path) -> None:
    """W2 expects an Employee-shaped render component.

    This currently xfails: the registry has MarkdownCard / PlanTimeline /
    Viz.* / Artifact.Preview but no EmployeeCard. See issue I-0004
    (audited gap from docs/specs/agent-design/2026-04-18-employee-chat.md).
    Flip to ``assert`` once the issue is closed.
    """
    import pytest

    registry = repo_root / "web" / "lib" / "component-registry.ts"
    if not registry.exists():
        pytest.xfail("component-registry.ts not present")
    text = registry.read_text(encoding="utf-8")
    if "Employee" not in text:
        pytest.xfail(
            "W2 audit gap (I-0004): employee-chat spec ships /employees list + "
            "create_employee meta tool, but no EmployeeCard render component is "
            "registered — Lead's create_employee result cannot render inline in chat"
        )
