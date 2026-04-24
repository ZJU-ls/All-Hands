"""ADR 0014 R3 regression: dual-SoT delta-send + stable message ids.

Guards three behaviors:

1. **Hot turn**: when the checkpointer already holds graph state for the
   thread_id, chat_service sends ONLY the new user message. Graph state
   does not accumulate duplicates across turns.

2. **Cold start**: when no prior state exists (fresh conversation, or legacy
   from before ADR 0014 landed), chat_service seeds the graph with the
   full MessageRepo history so the first turn has context.

3. **Stable ids fallback**: a runner.stream call whose messages omit ``id``
   (dispatch / subagent bootstrap / tests) must not crash. LangChain
   assigns a fresh UUID in that case, which is safe because those turns
   don't rely on cross-turn dedup.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from allhands.core import Employee
from allhands.execution.gate import AutoApproveGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.runner import AgentRunner


def _make_emp() -> Employee:
    return Employee(
        id="emp-adr0014-r3",
        name="r3-regression",
        description="",
        system_prompt="r3-stable-ids",
        model_ref="default",
        tool_ids=[],
        skill_ids=[],
        max_iterations=2,
        is_lead_agent=False,
        created_by="system",
        created_at=datetime.now(UTC),
        metadata={},
    )


@pytest.mark.asyncio
async def test_delta_send_keeps_graph_state_linear_not_quadratic(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hot-path contract: chat_service sends only the new user message per
    turn. After three turns, graph state holds exactly 3 user + 3 assistant
    messages, not the 2 + 4 + 6 = 12 naive full-history resends produce.
    """
    db_path = tmp_path / "r3-delta.db"
    thread_id = f"conv-{uuid.uuid4().hex[:8]}"

    model = FakeMessagesListChatModel(
        responses=[
            AIMessage(content="ack-1"),
            AIMessage(content="ack-2"),
            AIMessage(content="ack-3"),
        ]
    )

    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        runner = AgentRunner(
            employee=_make_emp(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
            checkpointer=saver,
        )
        import allhands.execution.runner as runner_mod

        monkeypatch.setattr(runner_mod, "_build_model", lambda *a, **kw: model)

        for turn in range(1, 4):
            async for _evt in runner.stream(
                messages=[{"role": "user", "content": f"u{turn}", "id": f"user-{turn}"}],
                thread_id=thread_id,
            ):
                pass

        cfg = {"configurable": {"thread_id": thread_id}}
        tup = await saver.aget_tuple(cfg)
        assert tup is not None
        msgs = tup.checkpoint.get("channel_values", {}).get("messages", [])
        counted = [m for m in msgs if isinstance(m, (HumanMessage, AIMessage))]
        assert len(counted) == 6, (
            f"delta-send broke: state has {len(counted)} messages, expected 6. "
            f"Seq: {[(type(m).__name__, m.content) for m in counted]}"
        )
        contents = [m.content for m in counted]
        assert contents == ["u1", "ack-1", "u2", "ack-2", "u3", "ack-3"]


@pytest.mark.asyncio
async def test_cold_start_seeds_full_history_into_graph_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cold-start contract: when a conversation has MessageRepo history but
    no checkpointer state, the first turn sends the whole history so the
    graph can bootstrap. Subsequent turns switch to delta-send automatically
    because ``_has_checkpoint_state`` flips to True once any checkpoint row
    exists.
    """
    db_path = tmp_path / "r3-coldstart.db"
    thread_id = f"conv-{uuid.uuid4().hex[:8]}"

    model = FakeMessagesListChatModel(responses=[AIMessage(content="ack")])

    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        runner = AgentRunner(
            employee=_make_emp(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
            checkpointer=saver,
        )
        import allhands.execution.runner as runner_mod

        monkeypatch.setattr(runner_mod, "_build_model", lambda *a, **kw: model)

        bootstrap_history = [
            {"role": "user", "content": "legacy-u1", "id": "legacy-u1"},
            {"role": "assistant", "content": "legacy-a1", "id": "legacy-a1"},
            {"role": "user", "content": "legacy-u2", "id": "legacy-u2"},
        ]
        async for _evt in runner.stream(messages=bootstrap_history, thread_id=thread_id):
            pass

        cfg = {"configurable": {"thread_id": thread_id}}
        tup = await saver.aget_tuple(cfg)
        assert tup is not None
        msgs = tup.checkpoint.get("channel_values", {}).get("messages", [])
        contents = [m.content for m in msgs if isinstance(m, (HumanMessage, AIMessage))]
        assert contents == ["legacy-u1", "legacy-a1", "legacy-u2", "ack"]


@pytest.mark.asyncio
async def test_missing_ids_fall_back_gracefully(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Callers that construct message dicts without MessageRepo ids must
    still stream without crashing. LangChain assigns a UUID; dedup is
    moot because these turns are one-shot.
    """
    db_path = tmp_path / "r3-fallback.db"
    thread_id = f"conv-{uuid.uuid4().hex[:8]}"

    model = FakeMessagesListChatModel(responses=[AIMessage(content="ok")])

    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        runner = AgentRunner(
            employee=_make_emp(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
            checkpointer=saver,
        )
        import allhands.execution.runner as runner_mod

        monkeypatch.setattr(runner_mod, "_build_model", lambda *a, **kw: model)

        async for _evt in runner.stream(
            messages=[{"role": "user", "content": "hi"}],
            thread_id=thread_id,
        ):
            pass

        cfg = {"configurable": {"thread_id": thread_id}}
        tup = await saver.aget_tuple(cfg)
        assert tup is not None
        msgs = tup.checkpoint.get("channel_values", {}).get("messages", [])
        assert len(msgs) >= 2
