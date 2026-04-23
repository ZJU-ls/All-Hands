"""ADR 0014 R3 · ChatService `_has_checkpoint_state` gate regression.

Unit-level coverage of the branch that picks between delta-send (hot turn)
and bootstrap (cold start). A fake checkpointer stands in for LangGraph's
``AsyncSqliteSaver`` so we can pin the boolean outcome without spinning up
a real graph.

Why this matters: if ``_has_checkpoint_state`` wrongly returns True on a
cold conversation, the runner gets an empty messages payload and the model
answers without context. If it wrongly returns False on a hot conversation,
the runner re-sends full history and graph state grows quadratically —
the exact E26 regression R3 is closing.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import pytest

from allhands.execution.gate import AutoApproveGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry
from allhands.services.chat_service import ChatService


class _FakeCheckpointer:
    """Minimum protocol ChatService._has_checkpoint_state expects.

    ``state_by_thread`` is the canonical fake — a dict from thread_id to the
    ``messages`` list the channel_values would hold. An empty list means the
    thread exists but no messages have been persisted yet (treated as cold
    per the current contract). Missing keys mean aget_tuple returns None.
    """

    def __init__(self, state_by_thread: dict[str, list[Any]] | None = None) -> None:
        self._state = state_by_thread or {}
        self.should_raise: Exception | None = None

    async def aget_tuple(self, config: dict[str, Any]) -> Any:
        if self.should_raise is not None:
            raise self.should_raise
        thread_id = config["configurable"]["thread_id"]
        if thread_id not in self._state:
            return None
        channel_values = {"messages": self._state[thread_id]}
        return SimpleNamespace(checkpoint={"channel_values": channel_values})


@pytest.fixture
def svc_factory() -> AsyncIterator[Any]:
    def _factory(checkpointer: Any = None) -> ChatService:
        return ChatService(
            employee_repo=object(),  # type: ignore[arg-type]
            conversation_repo=object(),  # type: ignore[arg-type]
            tool_registry=ToolRegistry(),
            skill_registry=SkillRegistry(),
            gate=AutoApproveGate(),
            checkpointer=checkpointer,
        )

    return _factory  # type: ignore[return-value]


@pytest.mark.asyncio
async def test_no_checkpointer_reports_no_state(svc_factory: Any) -> None:
    """Tests and legacy deployments construct ChatService with
    checkpointer=None. `_has_checkpoint_state` must cleanly say False
    so bootstrap path runs — there's nothing for delta-send to lean on.
    """
    svc = svc_factory(checkpointer=None)
    assert await svc._has_checkpoint_state("any-conv") is False


@pytest.mark.asyncio
async def test_missing_thread_reports_no_state(svc_factory: Any) -> None:
    """Fresh conversation: the thread_id has no checkpoint row yet.
    aget_tuple returns None. Cold path kicks in.
    """
    ck = _FakeCheckpointer({})
    svc = svc_factory(checkpointer=ck)
    assert await svc._has_checkpoint_state("new-conv") is False


@pytest.mark.asyncio
async def test_empty_messages_channel_reports_no_state(svc_factory: Any) -> None:
    """Edge case: a checkpoint row exists but its messages channel is
    empty (e.g. the graph was instantiated but crashed before model
    writes). Treat it as cold so we don't send an empty payload that the
    model has nothing to respond to.
    """
    ck = _FakeCheckpointer({"stale-conv": []})
    svc = svc_factory(checkpointer=ck)
    assert await svc._has_checkpoint_state("stale-conv") is False


@pytest.mark.asyncio
async def test_populated_messages_channel_reports_state(svc_factory: Any) -> None:
    """Hot path: prior turn left at least one message in state. Delta-send
    kicks in and only the new user turn goes over the wire.
    """
    ck = _FakeCheckpointer({"hot-conv": ["some-prior-message"]})
    svc = svc_factory(checkpointer=ck)
    assert await svc._has_checkpoint_state("hot-conv") is True


@pytest.mark.asyncio
async def test_checkpointer_exception_degrades_to_no_state(svc_factory: Any) -> None:
    """Disk-full / SQLite-locked / any checkpointer glitch must degrade to
    the bootstrap path — correct but wasteful, never worse than pre-R3.
    Silence here is wrong; the chat turn must still succeed.
    """
    ck = _FakeCheckpointer({})
    ck.should_raise = RuntimeError("disk full")
    svc = svc_factory(checkpointer=ck)
    assert await svc._has_checkpoint_state("any-conv") is False
