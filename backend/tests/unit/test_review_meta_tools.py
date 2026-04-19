"""Review family meta tools — self-review / walkthrough-acceptance / harness-review.

Specs:
- docs/specs/agent-design/2026-04-18-self-review.md
- docs/specs/agent-design/2026-04-18-walkthrough-acceptance.md
- docs/specs/agent-design/2026-04-18-harness-review.md

These are orchestration tools (no agent-managed resource CRUD), so L01 REST parity
doesn't apply. But each must: be META kind, declare WRITE scope, require confirmation
(they take 30min-2h wall clock and write to docs/), and have WHEN TO USE / WHEN NOT
TO USE blocks in description.
"""

from __future__ import annotations

from allhands.core import ToolKind, ToolScope


def test_all_review_meta_tools_exported() -> None:
    from allhands.execution.tools.meta.review_tools import ALL_REVIEW_META_TOOLS

    ids = {t.id for t in ALL_REVIEW_META_TOOLS}
    assert "allhands.meta.cockpit.run_self_review" in ids
    assert "allhands.meta.cockpit.run_walkthrough_acceptance" in ids
    assert "allhands.meta.cockpit.run_harness_review" in ids


def test_review_tools_are_meta_write_gated() -> None:
    from allhands.execution.tools.meta.review_tools import ALL_REVIEW_META_TOOLS

    for t in ALL_REVIEW_META_TOOLS:
        assert t.kind == ToolKind.META, f"{t.id} must be META kind"
        assert t.scope == ToolScope.WRITE, (
            f"{t.id} writes to docs/review · docs/harness-review · plans/ · "
            f"must be WRITE scope so Lead's Tool agents go through ConfirmationGate"
        )
        assert t.requires_confirmation is True, (
            f"{t.id} takes 30min-2h wall clock and burns tokens — Lead must be "
            f"prevented from casually triggering it without the user signing off"
        )


def test_review_tool_descriptions_have_when_markers() -> None:
    """Per V04 TodoWrite idiom: description must teach when to use / NOT to use."""
    from allhands.execution.tools.meta.review_tools import ALL_REVIEW_META_TOOLS

    for t in ALL_REVIEW_META_TOOLS:
        desc = t.description.upper()
        assert "WHEN TO USE" in desc, (
            f"{t.id} description missing 'WHEN TO USE' block · Lead can't route "
            f"without this (V04 three-part description idiom)"
        )
        assert "WHEN NOT TO USE" in desc, (
            f"{t.id} description missing 'WHEN NOT TO USE' block · this is the "
            f"cost-control half of the idiom — budget/prereq guardrails live here"
        )


def test_self_review_schema_has_rounds() -> None:
    from allhands.execution.tools.meta.review_tools import (
        COCKPIT_RUN_SELF_REVIEW_TOOL,
    )

    props = COCKPIT_RUN_SELF_REVIEW_TOOL.input_schema["properties"]
    assert "rounds" in props
    assert props["rounds"]["items"]["enum"] == [1, 2, 3]


def test_walkthrough_schema_has_loop_params() -> None:
    """Spec § 3.7.5 requires loop_until_green / max_iterations / auto_fix_* params."""
    from allhands.execution.tools.meta.review_tools import (
        COCKPIT_RUN_WALKTHROUGH_ACCEPTANCE_TOOL,
    )

    props = COCKPIT_RUN_WALKTHROUGH_ACCEPTANCE_TOOL.input_schema["properties"]
    for required_param in [
        "paths",
        "loop_until_green",
        "max_iterations",
        "auto_fix_p0",
        "auto_fix_p1_threshold",
        "user_ack_remaining",
    ]:
        assert required_param in props, (
            f"walkthrough-acceptance § 3.7.5 requires '{required_param}' param — "
            f"missing means the fix-reeval loop can't be configured"
        )
    assert props["paths"]["items"]["enum"] == ["W1", "W2", "W3", "W4", "W5", "W6", "W7"]
    assert props["max_iterations"]["maximum"] == 5, (
        "§ 3.7.3 budget clause: ≤ 5 iterations, then blocker report"
    )


def test_harness_review_schema_has_cool_down() -> None:
    """Spec § 2.3 + 4: cool-down is load-bearing; 7-day default."""
    from allhands.execution.tools.meta.review_tools import (
        COCKPIT_RUN_HARNESS_REVIEW_TOOL,
    )

    props = COCKPIT_RUN_HARNESS_REVIEW_TOOL.input_schema["properties"]
    assert "cool_down_days" in props
    assert props["cool_down_days"]["default"] == 7
    assert props["steps"]["items"]["enum"] == [1, 2, 3]


def test_registered_in_discover_builtin_tools() -> None:
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.tools import discover_builtin_tools

    reg = ToolRegistry()
    discover_builtin_tools(reg)

    registered_ids = {t.id for t in reg.list_all()}
    for tool_id in [
        "allhands.meta.cockpit.run_self_review",
        "allhands.meta.cockpit.run_walkthrough_acceptance",
        "allhands.meta.cockpit.run_harness_review",
    ]:
        assert tool_id in registered_ids, (
            f"{tool_id} not registered — add ALL_REVIEW_META_TOOLS to "
            f"discover_builtin_tools() in execution/tools/__init__.py"
        )
