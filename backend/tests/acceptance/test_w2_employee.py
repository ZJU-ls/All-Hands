"""W2 · Self-build an employee (chat only).

Sign-of-life assertions (structural preconditions for the live W2 path):

1. /employees list route exists.
2. ``create_employee`` meta tool present + declared WRITE + gated
   (Tool-First redemption + CLAUDE.md §3.3).
3. An ``EmployeeCard`` render component is registered + ``create_employee``
   returns a render envelope so Lead's result renders inline in chat
   (N1 Tool-First redemption).

I-0008 closed 2026-04-19 (Track H): EmployeeCard component + registry entry +
render envelope executor landed. The previous ``xfail`` block is now a hard
assert — regressions fail loudly.
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

    I-0008 closed 2026-04-19: EmployeeCard is registered in
    web/lib/component-registry.ts so Lead's create_employee result renders
    inline in chat. Regression check — keep the assert hard.
    """
    registry = repo_root / "web" / "lib" / "component-registry.ts"
    assert registry.exists(), "component-registry.ts missing — required by W2"
    text = registry.read_text(encoding="utf-8")
    assert "EmployeeCard" in text, (
        "W2 regression (I-0008): EmployeeCard must stay registered in "
        "component-registry.ts so create_employee renders inline in chat"
    )
    component_file = repo_root / "web" / "components" / "render" / "EmployeeCard.tsx"
    assert component_file.exists(), (
        "W2 regression (I-0008): web/components/render/EmployeeCard.tsx missing"
    )


def test_create_employee_returns_render_envelope() -> None:
    """W2 · create_employee meta tool wraps its result as a render envelope.

    I-0008 closed 2026-04-19 (Track H): execute_create_employee returns
    ``{component: "EmployeeCard", props}`` so the Lead chat surface renders
    the new employee inline (no navigation to /employees required).
    """
    import asyncio

    from allhands.execution.tools.meta.employee_tools import execute_create_employee

    envelope = asyncio.run(
        execute_create_employee(
            name="Researcher",
            description="desk research",
            system_prompt="Cite sources.",
            model_ref="openai/gpt-4o-mini",
            tool_ids=[],
            skill_ids=["allhands.render"],
        )
    )
    assert envelope["component"] == "EmployeeCard"
    assert envelope["props"]["name"] == "Researcher"
    assert envelope["props"]["model"]["provider"] == "openai"
