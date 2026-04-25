"""ADR 0019 C3 · UserInputDeferred + ask_user_question integration tests."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from allhands.core import UserInput, UserInputQuestion, UserInputStatus
from allhands.execution.tools.builtin.ask_user_question import TOOL, execute
from allhands.execution.user_input_deferred import UserInputDeferred


class _FakeUserInputRepo:
    def __init__(self) -> None:
        self.rows: dict[str, UserInput] = {}

    async def get(self, ui_id: str) -> UserInput | None:
        return self.rows.get(ui_id)

    async def list_pending(self) -> list[UserInput]:
        return [r for r in self.rows.values() if r.status == UserInputStatus.PENDING]

    async def save(self, ui: UserInput) -> None:
        self.rows[ui.id] = ui

    async def update_status_with_answers(
        self,
        ui_id: str,
        status: UserInputStatus,
        answers: dict[str, str],
    ) -> None:
        existing = self.rows.get(ui_id)
        if existing is None:
            return
        self.rows[ui_id] = existing.model_copy(update={"status": status, "answers": dict(answers)})

    async def update_status(self, ui_id: str, status: UserInputStatus) -> None:
        existing = self.rows.get(ui_id)
        if existing is None:
            return
        self.rows[ui_id] = existing.model_copy(update={"status": status})


@pytest.mark.asyncio
async def test_publish_writes_pending_row_with_questions() -> None:
    repo = _FakeUserInputRepo()
    signal = UserInputDeferred(repo, ttl_seconds=600, poll_interval_s=0.02)
    req = await signal.publish(
        tool_use_id="tc-1",
        questions=[
            {"label": "tone", "description": "Formal or casual?"},
            {"label": "length", "description": "Short or long?", "preview": "..."},
        ],
    )
    assert req.confirmation_id is not None
    row = repo.rows[req.confirmation_id]
    assert row.status == UserInputStatus.PENDING
    assert row.tool_call_id == "tc-1"
    assert len(row.questions) == 2
    assert row.questions[0].label == "tone"
    delta = (row.expires_at - row.created_at).total_seconds()
    assert 599 <= delta <= 601


@pytest.mark.asyncio
async def test_publish_accepts_pydantic_question_objects() -> None:
    repo = _FakeUserInputRepo()
    signal = UserInputDeferred(repo, ttl_seconds=60, poll_interval_s=0.02)
    req = await signal.publish(
        tool_use_id="tc-2",
        questions=[UserInputQuestion(label="x", description="y")],
    )
    assert req.confirmation_id is not None
    assert repo.rows[req.confirmation_id].questions[0].label == "x"


@pytest.mark.asyncio
async def test_wait_resolves_on_answered() -> None:
    repo = _FakeUserInputRepo()
    signal = UserInputDeferred(repo, ttl_seconds=60, poll_interval_s=0.02)
    req = await signal.publish(
        tool_use_id="tc-1",
        questions=[{"label": "x", "description": "y"}],
    )

    async def answer_after_delay() -> None:
        await asyncio.sleep(0.05)
        assert req.confirmation_id is not None
        await repo.update_status_with_answers(
            req.confirmation_id, UserInputStatus.ANSWERED, {"x": "yes"}
        )

    waiter = asyncio.create_task(signal.wait(req))
    flipper = asyncio.create_task(answer_after_delay())
    outcome = await asyncio.wait_for(waiter, timeout=2.0)
    await flipper

    assert outcome.kind == "answered"
    assert outcome.payload == {"x": "yes"}


@pytest.mark.asyncio
async def test_wait_expires_when_ttl_elapses() -> None:
    repo = _FakeUserInputRepo()
    signal = UserInputDeferred(repo, ttl_seconds=0.1, poll_interval_s=0.02)
    req = await signal.publish(
        tool_use_id="tc-1",
        questions=[{"label": "x", "description": "y"}],
    )

    outcome = await asyncio.wait_for(signal.wait(req), timeout=2.0)
    assert outcome.kind == "expired"
    assert req.confirmation_id is not None
    assert repo.rows[req.confirmation_id].status == UserInputStatus.EXPIRED


@pytest.mark.asyncio
async def test_wait_returns_expired_when_row_missing() -> None:
    repo = _FakeUserInputRepo()
    signal = UserInputDeferred(repo, ttl_seconds=60, poll_interval_s=0.02)
    req = await signal.publish(
        tool_use_id="tc-1",
        questions=[{"label": "x", "description": "y"}],
    )
    assert req.confirmation_id is not None
    del repo.rows[req.confirmation_id]
    outcome = await asyncio.wait_for(signal.wait(req), timeout=2.0)
    assert outcome.kind == "expired"


@pytest.mark.asyncio
async def test_resolves_immediately_if_already_answered() -> None:
    repo = _FakeUserInputRepo()
    signal = UserInputDeferred(repo, ttl_seconds=60, poll_interval_s=0.02)
    req = await signal.publish(
        tool_use_id="tc-1",
        questions=[{"label": "x", "description": "y"}],
    )
    assert req.confirmation_id is not None
    await repo.update_status_with_answers(req.confirmation_id, UserInputStatus.ANSWERED, {"x": "y"})
    started = datetime.now(UTC)
    outcome = await asyncio.wait_for(signal.wait(req), timeout=1.0)
    assert outcome.kind == "answered"
    assert datetime.now(UTC) - started < timedelta(seconds=0.3)


def test_tool_metadata() -> None:
    assert TOOL.requires_user_input is True
    assert TOOL.requires_confirmation is False
    assert TOOL.name == "ask_user_question"


@pytest.mark.asyncio
async def test_executor_echoes_answers_payload() -> None:
    questions = [{"label": "tone", "description": "?"}]
    out = await execute(questions=questions, answers={"tone": "formal"})
    assert out == {"answers": {"tone": "formal"}, "questions": questions}


@pytest.mark.asyncio
async def test_executor_handles_missing_answers() -> None:
    out = await execute(questions=[{"label": "x", "description": "y"}])
    assert out["answers"] == {}
