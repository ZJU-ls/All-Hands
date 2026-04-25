"""Phase 1 · preset → (tool_ids, skill_ids, max_iterations) expansion.

Spec: docs/specs/agent-runtime-contract.md § 4.1 + § 4.2.

User feedback (2026-04-25, post-ADR 0019):
  * execute = 10 iter (no plan, no subagent — direct work)
  * plan = 15 iter (has plan tools, no subagent — agent makes plan AND
    executes itself)
  * plan_with_subagent = 20 iter (plan + spawn_subagent — orchestrator
    role, dispatches parallel children)

The plan/plan_with_subagent presets switched from the legacy
``render_plan`` (one-shot Approve/Reject card · ADR 0014 vintage) to
the ADR 0019 C1 ``plan_create`` family (continuously-mutable todo memo
that renders PlanTimeline). The two systems are intentionally separate
products; presets pick the one that matches the preset's semantic.

Q6 signoff: UI may add/remove from preset skill defaults; service uses
the UI-provided custom_skill_ids as authoritative (no whitelist intersect).

Reference: ref-src-claude/V05 — skills are declared but not pre-loaded;
preset is a form template, not a runtime mode (CLAUDE.md § 3.2 red line).
"""

from __future__ import annotations

import pytest

from allhands.execution.modes import MODES, expand_preset


def test_modes_registry_has_three_presets() -> None:
    """Exactly three v0 presets: execute / plan / plan_with_subagent."""
    assert set(MODES.keys()) == {"execute", "plan", "plan_with_subagent"}


def test_execute_preset_defaults() -> None:
    """write_file dropped from execute preset (2026-04-25): its target dir
    (data/reports/) is invisible to the user; user-facing outputs belong
    in the Artifacts panel via allhands.artifacts skill. Keeping write_file
    here taught weak models to default to filesystem writes for "give me X"
    and skip artifact_create entirely.
    """
    tools, skills, max_it = expand_preset("execute")
    assert "allhands.builtin.fetch_url" in tools
    assert "allhands.builtin.write_file" not in tools
    assert "allhands.meta.resolve_skill" in tools
    assert skills == ["sk_research", "sk_write"]
    assert max_it == 10


def test_plan_preset_defaults() -> None:
    """plan = make plan + execute themselves · 15 iter · no subagent.

    Uses the ADR 0019 C1 plan_create family (continuously-mutable todo
    memo) instead of the legacy render_plan (one-shot Approve/Reject
    card). Includes execution tools (fetch_url + research/write skills)
    so the agent can actually execute the plan it just made.
    """
    tools, skills, max_it = expand_preset("plan")
    # New: plan_create family for ongoing todo
    assert "allhands.meta.plan_create" in tools
    assert "allhands.meta.plan_view" in tools
    assert "allhands.meta.plan_update_step" in tools
    assert "allhands.meta.plan_complete_step" in tools
    # Execution capability (must self-execute, not dispatch)
    assert "allhands.builtin.fetch_url" in tools
    # Legacy render_plan dropped from this preset
    assert "allhands.builtin.render_plan" not in tools
    # Definitively NO subagent dispatch
    assert "allhands.meta.spawn_subagent" not in tools
    assert "allhands.meta.resolve_skill" in tools
    assert set(skills) == {"sk_planner", "sk_research", "sk_write"}
    assert max_it == 15


def test_plan_with_subagent_preset_defaults() -> None:
    """plan_with_subagent = make plan + dispatch parallel subagents · 20 iter.

    Pure orchestrator role: HAS plan tools + spawn_subagent, but NO
    direct execution tools (fetch_url etc) — forces dispatch pattern.
    Uses plan_create family (ADR 0019 C1) instead of legacy render_plan.

    Q7 (2026-04-19) signed off max=15. User feedback (2026-04-25)
    raised it to 20 to match the "plan + dispatch + track" workflow's
    real iteration footprint.
    """
    tools, skills, max_it = expand_preset("plan_with_subagent")
    assert "allhands.meta.plan_create" in tools
    assert "allhands.meta.plan_view" in tools
    assert "allhands.meta.spawn_subagent" in tools
    assert "allhands.builtin.render_plan" not in tools
    # Pure orchestrator — no direct fetch/write
    assert "allhands.builtin.fetch_url" not in tools
    assert "allhands.meta.resolve_skill" in tools
    assert set(skills) == {"sk_planner", "sk_executor_spawn"}
    assert max_it == 20


def test_unknown_preset_raises() -> None:
    with pytest.raises(KeyError):
        expand_preset("nonexistent")


def test_custom_tool_ids_append_to_preset_base() -> None:
    """Custom tools append to preset base (contract § 4.2 · dedupe(base + custom))."""
    tools, _, _ = expand_preset("execute", custom_tool_ids=["allhands.meta.get_employee_detail"])
    assert "allhands.builtin.fetch_url" in tools  # base preserved
    assert "allhands.meta.get_employee_detail" in tools  # custom added


def test_custom_tool_ids_dedupe() -> None:
    """Overlapping custom with base → no duplicate."""
    tools, _, _ = expand_preset(
        "execute",
        custom_tool_ids=["allhands.builtin.fetch_url", "allhands.meta.get_employee_detail"],
    )
    assert tools.count("allhands.builtin.fetch_url") == 1


def test_q6_custom_skill_ids_fully_override_whitelist() -> None:
    """Q6 signoff: UI allows add + remove; service accepts custom list as-is.

    User can both drop preset defaults AND add skills outside the whitelist.
    Whitelist is only a UI seed, not a runtime guardrail.
    """
    # Drop default + add a skill not in whitelist.
    _, skills, _ = expand_preset("execute", custom_skill_ids=["sk_custom_outside_whitelist"])
    assert skills == ["sk_custom_outside_whitelist"]

    # Empty list is honored — "user unchecked everything".
    _, skills_empty, _ = expand_preset("execute", custom_skill_ids=[])
    assert skills_empty == []


def test_custom_max_iterations_override() -> None:
    _, _, max_it = expand_preset("plan_with_subagent", custom_max_iterations=42)
    assert max_it == 42


def test_preset_module_line_count_under_30() -> None:
    """Contract § 4.1: each preset module ≤ 30 lines (config dict, not class hierarchy)."""
    from pathlib import Path

    modes_dir = Path(__file__).resolve().parents[2] / "src" / "allhands" / "execution" / "modes"
    for slug in ("execute", "plan", "plan_with_subagent"):
        path = modes_dir / f"{slug}.py"
        line_count = sum(1 for _ in path.read_text(encoding="utf-8").splitlines())
        assert line_count <= 30, f"{slug}.py has {line_count} lines · contract caps at 30"
