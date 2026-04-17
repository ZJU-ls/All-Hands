"""Tests for BootstrapService."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from allhands.core import Employee
from allhands.services.bootstrap_service import ensure_lead_agent


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
async def test_ensure_lead_agent_noop_if_exists() -> None:
    existing = Employee(
        id="e1",
        name="LeadAgent",
        description="existing",
        system_prompt="x",
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
