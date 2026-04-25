"""Tests for DeferredSignal · ConfirmationDeferred (ADR 0018 · Task 4)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import get_args

import pytest

from allhands.core import Confirmation, ConfirmationStatus
from allhands.execution.deferred import (
    ConfirmationDeferred,
    DeferredOutcome,
    DeferredOutcomeKind,
    DeferredRequest,
    DeferredSignal,
)


class _FakeConfirmationRepo:
    """In-memory ConfirmationRepo · matches the Protocol shape used by the gate."""

    def __init__(self) -> None:
        self.rows: dict[str, Confirmation] = {}

    async def get(self, confirmation_id: str) -> Confirmation | None:
        return self.rows.get(confirmation_id)

    async def get_by_tool_call(self, tool_call_id: str) -> Confirmation | None:
        for c in self.rows.values():
            if c.tool_call_id == tool_call_id:
                return c
        return None

    async def list_pending(self) -> list[Confirmation]:
        return [c for c in self.rows.values() if c.status == ConfirmationStatus.PENDING]

    async def save(self, confirmation: Confirmation) -> None:
        self.rows[confirmation.id] = confirmation

    async def update_status(self, confirmation_id: str, status: ConfirmationStatus) -> None:
        existing = self.rows.get(confirmation_id)
        if existing is None:
            return
        self.rows[confirmation_id] = existing.model_copy(update={"status": status})


@pytest.mark.asyncio
async def test_confirmation_deferred_publish_writes_pending_row() -> None:
    repo = _FakeConfirmationRepo()
    signal = ConfirmationDeferred(repo, ttl_seconds=60, poll_interval_s=0.05)

    req = await signal.publish(
        tool_use_id="tc-1",
        summary="delete employee 42",
        rationale="scope=WRITE",
        diff={"id": "42"},
    )

    assert isinstance(req, DeferredRequest)
    assert req.confirmation_id is not None
    assert req.request_id == req.confirmation_id

    row = repo.rows[req.confirmation_id]
    assert row.status == ConfirmationStatus.PENDING
    assert row.tool_call_id == "tc-1"
    assert row.summary == "delete employee 42"
    assert row.rationale == "scope=WRITE"
    assert row.diff == {"id": "42"}
    # ttl honored
    delta = (row.expires_at - row.created_at).total_seconds()
    assert 59 <= delta <= 61


@pytest.mark.asyncio
async def test_confirmation_deferred_resolves_on_approve() -> None:
    repo = _FakeConfirmationRepo()
    signal = ConfirmationDeferred(repo, ttl_seconds=60, poll_interval_s=0.05)
    req = await signal.publish(tool_use_id="tc-1", summary="s", rationale="r")

    async def approve_after_delay() -> None:
        await asyncio.sleep(0.1)
        assert req.confirmation_id is not None
        await repo.update_status(req.confirmation_id, ConfirmationStatus.APPROVED)

    waiter = asyncio.create_task(signal.wait(req))
    flipper = asyncio.create_task(approve_after_delay())
    outcome = await asyncio.wait_for(waiter, timeout=2.0)
    await flipper

    assert outcome.kind == "approved"


@pytest.mark.asyncio
async def test_confirmation_deferred_resolves_on_reject() -> None:
    repo = _FakeConfirmationRepo()
    signal = ConfirmationDeferred(repo, ttl_seconds=60, poll_interval_s=0.05)
    req = await signal.publish(tool_use_id="tc-1", summary="s", rationale="r")

    async def reject_after_delay() -> None:
        await asyncio.sleep(0.1)
        assert req.confirmation_id is not None
        await repo.update_status(req.confirmation_id, ConfirmationStatus.REJECTED)

    waiter = asyncio.create_task(signal.wait(req))
    flipper = asyncio.create_task(reject_after_delay())
    outcome = await asyncio.wait_for(waiter, timeout=2.0)
    await flipper

    assert outcome.kind == "rejected"


@pytest.mark.asyncio
async def test_confirmation_deferred_expires_when_ttl_elapses() -> None:
    repo = _FakeConfirmationRepo()
    # Sub-second TTL · the wait loop must flip the row to EXPIRED.
    signal = ConfirmationDeferred(repo, ttl_seconds=0.1, poll_interval_s=0.02)
    req = await signal.publish(tool_use_id="tc-1", summary="s", rationale="r")

    outcome = await asyncio.wait_for(signal.wait(req), timeout=2.0)

    assert outcome.kind == "expired"
    assert req.confirmation_id is not None
    assert repo.rows[req.confirmation_id].status == ConfirmationStatus.EXPIRED


@pytest.mark.asyncio
async def test_confirmation_deferred_returns_expired_when_row_missing() -> None:
    repo = _FakeConfirmationRepo()
    signal = ConfirmationDeferred(repo, ttl_seconds=60, poll_interval_s=0.02)
    req = await signal.publish(tool_use_id="tc-1", summary="s", rationale="r")

    # Defensive case: someone deleted the row out from under us.
    assert req.confirmation_id is not None
    del repo.rows[req.confirmation_id]

    outcome = await asyncio.wait_for(signal.wait(req), timeout=2.0)
    assert outcome.kind == "expired"


def test_deferred_request_round_trip() -> None:
    req = DeferredRequest(request_id="abc", confirmation_id="abc")
    assert req.request_id == "abc"
    assert req.confirmation_id == "abc"

    # Reconstructable from primitives — plain dataclass.
    rebuilt = DeferredRequest(request_id=req.request_id, confirmation_id=req.confirmation_id)
    assert rebuilt == req

    # confirmation_id defaults to None for non-confirmation deferred kinds.
    bare = DeferredRequest(request_id="xyz")
    assert bare.confirmation_id is None


def test_outcome_kind_literal_accepts_documented_values() -> None:
    documented = {"approved", "rejected", "expired", "answered", "completed"}
    assert set(get_args(DeferredOutcomeKind)) == documented
    for kind in documented:
        outcome = DeferredOutcome(kind=kind)  # type: ignore[arg-type]
        assert outcome.kind == kind


def test_deferred_signal_is_abstract() -> None:
    # Cannot instantiate the ABC directly.
    with pytest.raises(TypeError):
        DeferredSignal()  # type: ignore[abstract]


@pytest.mark.asyncio
async def test_confirmation_deferred_resolves_immediately_if_already_approved() -> None:
    """If the row is already APPROVED before wait() starts, return on first poll."""
    repo = _FakeConfirmationRepo()
    signal = ConfirmationDeferred(repo, ttl_seconds=60, poll_interval_s=0.05)
    req = await signal.publish(tool_use_id="tc-1", summary="s", rationale="r")
    assert req.confirmation_id is not None
    await repo.update_status(req.confirmation_id, ConfirmationStatus.APPROVED)

    started = datetime.now(UTC)
    outcome = await asyncio.wait_for(signal.wait(req), timeout=1.0)
    elapsed = datetime.now(UTC) - started

    assert outcome.kind == "approved"
    assert elapsed < timedelta(seconds=0.5)
