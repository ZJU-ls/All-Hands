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
    """
    repo = AsyncMock()
    repo.get_lead = AsyncMock(return_value=None)
    captured: list[Employee] = []

    async def upsert(emp: Employee) -> Employee:
        captured.append(emp)
        return emp

    repo.upsert = upsert
    lead = await ensure_lead_agent(repo)
    missing = LEAD_ADMIN_TOOL_IDS_EXPECTED - set(lead.tool_ids)
    assert not missing, f"Lead Agent bootstrap missing admin tools: {sorted(missing)}"
