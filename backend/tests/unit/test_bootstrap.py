"""Tests for BootstrapService."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from allhands.core import Employee
from allhands.services.bootstrap_service import ensure_lead_agent

# L01 admin surface (B03): Lead must be able to run CRUD on every platform
# resource via conversation, mirroring the UI's buttons. These are the
# representative tool_ids we pin — spec changes that drop any of them break
# the Tool First contract.
LEAD_ADMIN_TOOL_IDS_EXPECTED = {
    # employees
    "allhands.meta.list_employees",
    "allhands.meta.create_employee",
    "allhands.meta.update_employee",
    "allhands.meta.delete_employee",
    "allhands.meta.dispatch_employee",
    # skills
    "allhands.meta.list_skills",
    "allhands.meta.install_skill_from_github",
    "allhands.meta.delete_skill",
    # MCP
    "allhands.meta.list_mcp_servers",
    "allhands.meta.add_mcp_server",
    "allhands.meta.delete_mcp_server",
    # providers
    "allhands.meta.list_providers",
    "allhands.meta.create_provider",
    "allhands.meta.delete_provider",
    # models
    "allhands.meta.list_models",
    "allhands.meta.create_model",
    "allhands.meta.chat_test_model",
    # planning
    "allhands.meta.plan_create",
    # cockpit / workspace
    "allhands.meta.cockpit.get_workspace_summary",
    "allhands.meta.cockpit.pause_all_runs",
}


@pytest.mark.asyncio
async def test_ensure_lead_agent_creates_if_none() -> None:
    repo = AsyncMock()
    repo.get_lead = AsyncMock(return_value=None)
    created: list[Employee] = []

    async def upsert(emp: Employee) -> Employee:
        created.append(emp)
        return emp

    repo.upsert = upsert
    lead = await ensure_lead_agent(repo)
    assert lead.is_lead_agent is True
    assert lead.name == "LeadAgent"
    assert len(created) == 1


@pytest.mark.asyncio
async def test_ensure_lead_agent_noop_if_prompt_already_in_sync() -> None:
    """If the Lead exists AND its prompt already matches the file on disk,
    boot is a pure no-op — no upsert, no refresh."""
    from allhands.services.bootstrap_service import load_lead_prompt

    existing = Employee(
        id="e1",
        name="LeadAgent",
        description="existing",
        system_prompt=load_lead_prompt(),
        model_ref="openai/gpt-4o-mini",
        tool_ids=["allhands.meta.list_employees"],
        is_lead_agent=True,
        created_by="system",
        created_at=datetime.now(UTC),
    )
    repo = AsyncMock()
    repo.get_lead = AsyncMock(return_value=existing)
    repo.upsert = AsyncMock()

    lead = await ensure_lead_agent(repo)
    assert lead.id == "e1"
    repo.upsert.assert_not_called()


@pytest.mark.asyncio
async def test_ensure_lead_agent_resyncs_prompt_from_file() -> None:
    """If the Lead exists but its prompt drifted from the file (prompt edits
    after first boot — see L06), boot must refresh the record so the live
    LLM sees the current file. Other fields (tool_ids, skill_ids) stay put.
    """
    from allhands.services.bootstrap_service import load_lead_prompt

    existing = Employee(
        id="e1",
        name="LeadAgent",
        description="existing",
        system_prompt="stale prompt from last week",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["allhands.meta.list_employees"],
        skill_ids=["custom-skill-id"],
        is_lead_agent=True,
        created_by="system",
        created_at=datetime.now(UTC),
    )
    captured: list[Employee] = []

    async def upsert(emp: Employee) -> Employee:
        captured.append(emp)
        return emp

    repo = AsyncMock()
    repo.get_lead = AsyncMock(return_value=existing)
    repo.upsert = upsert

    lead = await ensure_lead_agent(repo)

    assert len(captured) == 1
    assert captured[0].system_prompt == load_lead_prompt()
    assert captured[0].tool_ids == ["allhands.meta.list_employees"]
    assert captured[0].skill_ids == ["custom-skill-id"]
    assert lead.id == "e1"


@pytest.mark.asyncio
async def test_ensure_lead_agent_ships_full_admin_surface() -> None:
    """B03 regression · the Lead must be able to drive every agent-managed
    resource from conversation alone (CLAUDE.md §3.1 L01 扩展). Dropping any
    admin tool from bootstrap silently regresses the "对话驱动全平台" promise.

    E22 refresh · after the skill-pack split, admin tools reach the Lead via
    TWO routes:
      1. directly on ``lead.tool_ids`` (always-hot READ + orchestration),
      2. packed into one of the 5 built-in management skills on
         ``lead.skill_ids`` (unpacked at runtime via eager bootstrap for
         Lead · see ``bootstrap_employee_runtime``).
    The "full admin surface" invariant is that every expected tool is
    reachable by one of those two routes — the LangGraph agent at turn 0
    ends up with the union of both. Checking only ``tool_ids`` would let a
    regression where a skill pack drops a tool slip through.
    """
    from pathlib import Path

    import yaml

    repo = AsyncMock()
    repo.get_lead = AsyncMock(return_value=None)
    captured: list[Employee] = []

    async def upsert(emp: Employee) -> Employee:
        captured.append(emp)
        return emp

    repo.upsert = upsert
    lead = await ensure_lead_agent(repo)

    # Walk the 5 Lead skill packs under backend/skills/builtin/<id>/SKILL.yaml
    # and fold their tool_ids into the reachable set. No subprocess / DB —
    # just YAML read, same as the skill registry's loader.
    skills_root = Path(__file__).resolve().parents[2] / "skills" / "builtin"
    reachable: set[str] = set(lead.tool_ids)
    for sid in lead.skill_ids:
        manifest = skills_root / sid.replace("allhands.", "").replace(".", "_") / "SKILL.yaml"
        # Directory name convention varies — try a small set of plausible
        # mappings before giving up.
        candidates = [
            skills_root / sid / "SKILL.yaml",
            skills_root / sid.split(".")[-1] / "SKILL.yaml",
            manifest,
        ]
        for p in candidates:
            if p.exists():
                data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
                reachable.update(str(t) for t in data.get("tool_ids", []))
                break

    missing = LEAD_ADMIN_TOOL_IDS_EXPECTED - reachable
    assert not missing, (
        f"Lead Agent bootstrap missing admin tools: {sorted(missing)} "
        f"(checked tool_ids + 5 skill packs)"
    )


# ---- L16 regression · render is always-hot on Lead · 2026-04-22 -------------


EXPECTED_RENDER_TOOLS_ALWAYS_HOT = {
    # The 3 chart tools are the smoking gun of E23 — if any of them falls
    # off the always-hot set, the user will see "已激活 render 技能" then
    # emoji markdown instead of actual SVG again.
    "allhands.render.line_chart",
    "allhands.render.bar_chart",
    "allhands.render.pie_chart",
    # Callout is in the same bucket; it's the "note/warning/error" chip we
    # want to stop losing to emoji prose.
    "allhands.render.callout",
    # Structured display primitives — same argument.
    "allhands.render.table",
    "allhands.render.cards",
    "allhands.render.stat",
    "allhands.render.kv",
    "allhands.render.timeline",
    "allhands.render.steps",
    "allhands.render.code",
    "allhands.render.diff",
    "allhands.render.link_card",
    "allhands.render.markdown_card",
}


def test_default_lead_tool_ids_makes_render_always_hot() -> None:
    """L16 · E23 regression. Render tools must land on Lead's ``tool_ids``
    directly, NOT only reachable via the ``allhands.render`` skill. The
    skill-gate was the reason weaker models hallucinated "已激活 render
    技能" + emoji markdown with ``tool_calls == []`` — see E23. Lead has
    to see the render tools in its bare toolset so the LLM can call
    ``render_line_chart`` without a pretend resolve_skill round-trip.
    """
    from allhands.services.bootstrap_service import default_lead_tool_ids

    defaults = set(default_lead_tool_ids())
    missing = EXPECTED_RENDER_TOOLS_ALWAYS_HOT - defaults
    assert not missing, (
        f"Lead default tool_ids dropped render tools (re-gated?): {sorted(missing)}. "
        "Render is an OUTPUT CHANNEL, not a capability pack — see L16."
    )


@pytest.mark.asyncio
async def test_lead_on_e22_baseline_gets_render_tools_on_boot() -> None:
    """L16 auto-migration. A Lead bootstrapped before 2026-04-22 has
    exactly the 18 E22-baseline tool ids and no render tools. On the
    next boot we detect that exact match and upgrade in place — no
    user customisation to preserve, no opt-in needed.
    """
    from allhands.services.bootstrap_service import (
        _LEAD_BASELINE_PRE_RENDER_HOT,
        default_lead_tool_ids,
        load_lead_prompt,
    )

    existing = Employee(
        id="lead-old",
        name="LeadAgent",
        description="migrated",
        system_prompt=load_lead_prompt(),
        model_ref="openai/gpt-4o-mini",
        tool_ids=list(_LEAD_BASELINE_PRE_RENDER_HOT),
        skill_ids=["allhands.render", "allhands.artifacts"],
        is_lead_agent=True,
        created_by="system",
        created_at=datetime.now(UTC),
    )
    captured: list[Employee] = []

    async def upsert(emp: Employee) -> Employee:
        captured.append(emp)
        return emp

    repo = AsyncMock()
    repo.get_lead = AsyncMock(return_value=existing)
    repo.upsert = upsert

    lead = await ensure_lead_agent(repo)

    assert len(captured) == 1, "must upsert so the DB record actually picks up"
    assert set(captured[0].tool_ids) == set(default_lead_tool_ids())
    assert {
        "allhands.render.line_chart",
        "allhands.render.bar_chart",
        "allhands.render.pie_chart",
    }.issubset(set(captured[0].tool_ids))
    assert lead.id == "lead-old"


@pytest.mark.asyncio
async def test_user_customised_lead_is_not_forced_to_render_hot() -> None:
    """Don't touch Leads the user has customised. If the tool_ids
    don't exactly match the old baseline, we leave them alone — we'd
    rather miss the upgrade than blow away a deliberate trim.
    """
    from allhands.services.bootstrap_service import (
        _LEAD_BASELINE_PRE_RENDER_HOT,
        load_lead_prompt,
    )

    custom_tools = list(_LEAD_BASELINE_PRE_RENDER_HOT)
    custom_tools.append("some.custom.extra_tool")  # user added this
    existing = Employee(
        id="lead-custom",
        name="LeadAgent",
        description="customised",
        system_prompt=load_lead_prompt(),
        model_ref="openai/gpt-4o-mini",
        tool_ids=custom_tools,
        skill_ids=["allhands.render", "allhands.artifacts"],
        is_lead_agent=True,
        created_by="system",
        created_at=datetime.now(UTC),
    )
    repo = AsyncMock()
    repo.get_lead = AsyncMock(return_value=existing)
    repo.upsert = AsyncMock()

    await ensure_lead_agent(repo)

    # No upsert because prompt already matches + tool_ids is not exact baseline
    # (has the extra user-added tool) → guard falls through.
    repo.upsert.assert_not_called()
