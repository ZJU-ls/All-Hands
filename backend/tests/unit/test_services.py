"""Tests for EmployeeService and ConfirmationService."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from allhands.core import (
    Confirmation,
    ConfirmationStatus,
    Employee,
    InvariantViolation,
)
from allhands.services.confirmation_service import ConfirmationService
from allhands.services.employee_service import EmployeeService


def _make_mock_employee_repo() -> AsyncMock:
    repo = AsyncMock()
    repo.list_all = AsyncMock(return_value=[])
    repo.get_lead = AsyncMock(return_value=None)
    repo.get_by_name = AsyncMock(return_value=None)
    repo.upsert = AsyncMock(side_effect=lambda emp: emp)
    repo.delete = AsyncMock()
    return repo


async def test_employee_service_create_sets_id_and_timestamp() -> None:
    repo = _make_mock_employee_repo()
    svc = EmployeeService(repo)
    emp = await svc.create(
        name="Researcher",
        description="A researcher",
        system_prompt="You research things.",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["allhands.builtin.fetch_url"],
    )
    assert emp.id != ""
    assert emp.name == "Researcher"
    assert emp.created_by == "user"
    repo.upsert.assert_called_once()


async def test_employee_service_create_rejects_no_capability() -> None:
    repo = _make_mock_employee_repo()
    svc = EmployeeService(repo)
    with pytest.raises(ValueError, match="capability"):
        await svc.create(
            name="Empty",
            description="no tools",
            system_prompt="x",
            model_ref="openai/gpt-4o-mini",
            tool_ids=[],
            skill_ids=[],
        )


async def test_employee_service_list() -> None:
    repo = _make_mock_employee_repo()
    repo.list_all = AsyncMock(
        return_value=[
            Employee(
                id="e1",
                name="Alice",
                description="",
                system_prompt="x",
                model_ref="openai/gpt-4o-mini",
                tool_ids=["t1"],
                created_by="user",
                created_at=datetime.now(UTC),
            )
        ]
    )
    svc = EmployeeService(repo)
    employees = await svc.list_all()
    assert len(employees) == 1


async def test_employee_service_create_defaults_to_draft() -> None:
    repo = _make_mock_employee_repo()
    svc = EmployeeService(repo)
    emp = await svc.create(
        name="Drafter",
        description="d",
        system_prompt="x",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["allhands.builtin.fetch_url"],
    )
    assert emp.status == "draft"
    assert emp.published_at is None


async def test_employee_service_publish_flips_status() -> None:
    repo = _make_mock_employee_repo()
    draft = Employee(
        id="e1",
        name="Drafty",
        description="",
        system_prompt="x",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["t1"],
        status="draft",
        created_by="user",
        created_at=datetime.now(UTC),
    )
    repo.get = AsyncMock(return_value=draft)
    svc = EmployeeService(repo)
    published = await svc.publish("e1")
    assert published.status == "published"
    assert published.published_at is not None


async def test_employee_service_publish_is_idempotent() -> None:
    repo = _make_mock_employee_repo()
    now = datetime.now(UTC)
    already = Employee(
        id="e1",
        name="OnRoster",
        description="",
        system_prompt="x",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["t1"],
        status="published",
        created_by="user",
        created_at=now,
        published_at=now,
    )
    repo.get = AsyncMock(return_value=already)
    svc = EmployeeService(repo)
    out = await svc.publish("e1")
    assert out.published_at == now
    # published_at must NOT advance on re-publish; upsert should not run either
    repo.upsert.assert_not_called()


async def test_employee_service_list_passes_status_filter() -> None:
    repo = _make_mock_employee_repo()
    svc = EmployeeService(repo)
    await svc.list_all(status="published")
    repo.list_all.assert_called_once_with(status="published", include_archived=False)


async def test_employee_service_delete_default_is_soft() -> None:
    """Default ``delete()`` archives the employee · row stays · status flips
    to ``archived``. Hard delete must be opt-in (§ employee-crud-overhaul v3)."""
    repo = _make_mock_employee_repo()
    emp = Employee(
        id="e1",
        name="Alice",
        description="",
        system_prompt="x",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["t1"],
        status="published",
        created_by="user",
        created_at=datetime.now(UTC),
    )
    repo.get = AsyncMock(return_value=emp)
    svc = EmployeeService(repo)
    await svc.delete("e1")
    repo.delete.assert_not_called()
    # archive flow → upsert with status=archived
    repo.upsert.assert_called_once()
    upserted = repo.upsert.call_args.args[0]
    assert upserted.status == "archived"


async def test_employee_service_hard_delete_drops_row() -> None:
    repo = _make_mock_employee_repo()
    emp = Employee(
        id="e1",
        name="Alice",
        description="",
        system_prompt="x",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["t1"],
        created_by="user",
        created_at=datetime.now(UTC),
    )
    repo.get = AsyncMock(return_value=emp)
    svc = EmployeeService(repo)
    await svc.delete("e1", hard=True)
    repo.delete.assert_called_once_with("e1")


async def test_employee_service_archive_lead_blocked() -> None:
    """Lead Agent cannot be archived — invariant violation."""
    repo = _make_mock_employee_repo()
    lead = Employee(
        id="lead-1",
        name="Lead",
        description="",
        system_prompt="x",
        model_ref="openai/gpt-4o-mini",
        tool_ids=[
            "allhands.meta.dispatch_employee",
            "allhands.meta.list_employees",
            "allhands.meta.get_employee_detail",
        ],
        is_lead_agent=True,
        created_by="system",
        created_at=datetime.now(UTC),
    )
    repo.get = AsyncMock(return_value=lead)
    svc = EmployeeService(repo)
    with pytest.raises(InvariantViolation):
        await svc.archive("lead-1")
    repo.upsert.assert_not_called()
    repo.delete.assert_not_called()


async def test_employee_service_restore_flips_archived_to_published() -> None:
    repo = _make_mock_employee_repo()
    archived = Employee(
        id="e1",
        name="Alice",
        description="",
        system_prompt="x",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["t1"],
        status="archived",
        created_by="user",
        created_at=datetime.now(UTC),
    )
    repo.get = AsyncMock(return_value=archived)
    svc = EmployeeService(repo)
    out = await svc.restore("e1")
    assert out.status == "published"
    assert out.published_at is not None
    repo.upsert.assert_called_once()


async def test_employee_service_restore_idempotent_for_published() -> None:
    repo = _make_mock_employee_repo()
    pub = Employee(
        id="e1",
        name="Alice",
        description="",
        system_prompt="x",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["t1"],
        status="published",
        created_by="user",
        created_at=datetime.now(UTC),
    )
    repo.get = AsyncMock(return_value=pub)
    svc = EmployeeService(repo)
    out = await svc.restore("e1")
    assert out.status == "published"
    repo.upsert.assert_not_called()


async def test_confirmation_service_approve() -> None:
    repo = AsyncMock()
    now = datetime.now(UTC)
    conf = Confirmation(
        id="cf1",
        tool_call_id="tc1",
        rationale="test",
        summary="test",
        status=ConfirmationStatus.PENDING,
        created_at=now,
        expires_at=now + timedelta(minutes=5),
    )
    repo.get = AsyncMock(return_value=conf)
    repo.update_status = AsyncMock()

    svc = ConfirmationService(repo)
    await svc.approve("cf1")
    repo.update_status.assert_called_once_with("cf1", ConfirmationStatus.APPROVED)


async def test_confirmation_service_reject() -> None:
    repo = AsyncMock()
    now = datetime.now(UTC)
    conf = Confirmation(
        id="cf1",
        tool_call_id="tc1",
        rationale="test",
        summary="test",
        status=ConfirmationStatus.PENDING,
        created_at=now,
        expires_at=now + timedelta(minutes=5),
    )
    repo.get = AsyncMock(return_value=conf)
    repo.update_status = AsyncMock()

    svc = ConfirmationService(repo)
    await svc.reject("cf1")
    repo.update_status.assert_called_once_with("cf1", ConfirmationStatus.REJECTED)
