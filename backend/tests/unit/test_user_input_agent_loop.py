"""ADR 0019 C3 · AgentLoop integration test for ask_user_question.

Verifies the end-to-end clarification flow:
  1. model emits a tool_use for ``ask_user_question``
  2. AgentLoop._permission_check returns Defer(signal=UserInputDeferred)
  3. tool_pipeline emits UserInputRequested + awaits signal.wait()
  4. test flips the row to ANSWERED with concrete answers
  5. pipeline merges answers into block.input → executor receives them
  6. ToolMessageCommitted carries the merged answers payload
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessageChunk

from allhands.core import Employee, UserInput, UserInputStatus
from allhands.execution.agent_loop import AgentLoop
from allhands.execution.gate import AutoApproveGate
from allhands.execution.internal_events import (
    AssistantMessageCommitted,
    LoopExited,
    ToolMessageCommitted,
    UserInputRequested,
)
from allhands.execution.registry import ToolRegistry
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


class _ScriptedModel:
    def __init__(self, scripts: list[list[AIMessageChunk]]) -> None:
        self._scripts = list(scripts)
        self._calls = 0

    def bind_tools(self, *_a: object, **_kw: object) -> Any:
        return self

    async def astream(self, *_a: object, **_kw: object) -> Any:
        chunks = self._scripts[self._calls]
        self._calls += 1
        for chunk in chunks:
            yield chunk


def _employee() -> Employee:
    return Employee(
        id="e1",
        name="t",
        description="t",
        system_prompt="You are helpful.",
        model_ref="openai/gpt-4o-mini",
        tool_ids=[TOOL.id],
        created_by="u",
        created_at=datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_ask_user_question_defers_emits_event_and_merges_answers() -> None:
    repo = _FakeUserInputRepo()
    signal = UserInputDeferred(repo, ttl_seconds=60, poll_interval_s=0.02)

    reg = ToolRegistry()
    reg.register(TOOL, execute)

    questions = [{"label": "tone", "description": "?"}]
    scripts = [
        [
            AIMessageChunk(
                content="",
                tool_calls=[
                    {
                        "id": "tu1",
                        "name": "ask_user_question",
                        "args": {"questions": questions},
                    }
                ],
            )
        ],
        [AIMessageChunk(content="thanks")],
    ]

    async def answer_when_pending() -> None:
        # poll until the row appears, then flip to ANSWERED
        while True:
            pending = await repo.list_pending()
            if pending:
                await repo.update_status_with_answers(
                    pending[0].id,
                    UserInputStatus.ANSWERED,
                    {"tone": "formal"},
                )
                return
            await asyncio.sleep(0.01)

    emp = _employee()
    with patch(
        "allhands.execution.agent_loop._build_model",
        return_value=_ScriptedModel(scripts),
    ):
        loop = AgentLoop(
            employee=emp,
            tool_registry=reg,
            gate=AutoApproveGate(),
            user_input_signal=signal,
        )
        flipper = asyncio.create_task(answer_when_pending())
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "decide"}])]
        await flipper

    requested = [ev for ev in events if isinstance(ev, UserInputRequested)]
    tool_msgs = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    assistants = [ev for ev in events if isinstance(ev, AssistantMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]

    assert len(requested) == 1
    assert requested[0].tool_use_id == "tu1"
    assert requested[0].questions == questions

    assert len(tool_msgs) == 1
    content = tool_msgs[0].message.content
    assert isinstance(content, dict)
    assert content["answers"] == {"tone": "formal"}
    assert content["questions"] == questions

    assert len(assistants) == 2
    assert exits[-1].reason == "completed"
