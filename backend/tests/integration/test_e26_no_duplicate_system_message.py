"""E26 regression: multi-turn chat through AgentRunner with a real
checkpointer must NOT accumulate duplicate/non-consecutive SystemMessages
in graph state.

Root cause we guard: runner used to prepend ``SystemMessage(content=...)``
to ``lc_messages`` on every turn and pass the full list as ``astream``
input. With a checkpointer on and ``add_messages`` as the reducer, LangGraph
appended the input to persisted state, producing state like:

    [Sys_turn1, User1, Ast1, Sys_turn2, User1, Ast1, User2]

— two non-consecutive SystemMessages at positions 0 and 3. Providers that
validate message order (Qwen / Anthropic / OpenAI-compatible) reject with
``Received multiple non-consecutive system messages`` and the whole chat
turn fails ``RUN_ERROR``.

Fix: use ``create_react_agent(prompt=...)`` — LangGraph-idiomatic channel
for system prompt. It prepends at model-call time and never stores in the
``messages`` channel, so the checkpointer can't duplicate it.

The test drives N turns through a real ``AsyncSqliteSaver`` and then reads
back the persisted state, asserting SystemMessages never appear in the
``messages`` channel regardless of how many turns have fired.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, SystemMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from allhands.core import Employee
from allhands.execution.gate import AutoApproveGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.runner import AgentRunner


def _make_emp() -> Employee:
    return Employee(
        id="emp-e26",
        name="e26-regression",
        description="",
        system_prompt="You are a helpful assistant. STABLE_SYSTEM_MARKER_FOR_E26.",
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
async def test_multi_turn_does_not_duplicate_system_message_in_graph_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Three consecutive turns through the same thread_id must never leave a
    SystemMessage in the persisted messages channel. The runner's fix routes
    the system prompt through ``create_react_agent(prompt=...)`` so it
    lives outside the reducer-managed state.
    """
    db_path = tmp_path / "e26-multiturn.db"
    thread_id = f"conv-{uuid.uuid4().hex[:8]}"

    # Fake LLM returns three distinct AIMessages across three turns so each
    # turn actually appends a user→assistant pair to state.
    model = FakeMessagesListChatModel(
        responses=[
            AIMessage(content="turn-1-ack"),
            AIMessage(content="turn-2-ack"),
            AIMessage(content="turn-3-ack"),
        ]
    )

    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        runner = AgentRunner(
            employee=_make_emp(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
            checkpointer=saver,
        )
        # Monkey-patch model factory so AgentRunner uses our fake model
        # instead of hitting a real provider. The runner's _build_model
        # would normally require env config.
        # Runner calls module-level _build_model with a real provider; for
        # the test we intercept it via monkeypatch so no API keys are needed
        # and state observations exercise the real LangGraph path.
        import allhands.execution.runner as runner_mod

        monkeypatch.setattr(runner_mod, "_build_model", lambda *a, **kw: model)

        # Drive three turns. We simulate chat_service's behavior: each turn
        # the caller passes the growing history. Without the fix, turn 2
        # would write [Sys, User1, Ast1, Sys, User2, Ast2] into state,
        # non-consecutive.
        history: list[dict[str, object]] = []
        for i in range(1, 4):
            history.append({"role": "user", "content": f"hi turn {i}"})
            async for _evt in runner.stream(messages=history, thread_id=thread_id):
                pass
            history.append({"role": "assistant", "content": f"turn-{i}-ack"})

        # Read back the persisted state from the same saver and assert no
        # SystemMessage leaked into the messages channel.
        cfg = {"configurable": {"thread_id": thread_id}}
        tuple_ = await saver.aget_tuple(cfg)
        assert tuple_ is not None, "checkpointer did not persist the thread"
        channel_values = tuple_.checkpoint.get("channel_values", {})
        msgs = channel_values.get("messages", [])
        assert len(msgs) >= 2, (
            f"expected user+assistant messages in state, got {len(msgs)}: "
            f"{[type(m).__name__ for m in msgs]}"
        )
        system_positions = [i for i, m in enumerate(msgs) if isinstance(m, SystemMessage)]
        assert system_positions == [], (
            "E26 regression: SystemMessage found in graph state at positions "
            f"{system_positions}; `prompt=` routing should keep system messages "
            "out of the messages channel entirely. Saw message sequence: "
            f"{[type(m).__name__ for m in msgs]}"
        )


@pytest.mark.asyncio
async def test_system_prompt_still_reaches_model_via_prompt_param(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Companion guarantee: the fix moves the system prompt OUT of graph state,
    but the LLM must still see it. Capture the model input on first call and
    assert our stable marker shows up prepended to the user message.
    """
    db_path = tmp_path / "e26-sysprompt.db"
    thread_id = f"conv-{uuid.uuid4().hex[:8]}"

    captured_inputs: list[list[object]] = []

    class _CapturingFakeModel(FakeMessagesListChatModel):
        def invoke(self, inputs, config=None, **kwargs):  # type: ignore[override]
            captured_inputs.append(list(inputs))
            return super().invoke(inputs, config=config, **kwargs)

        async def ainvoke(self, inputs, config=None, **kwargs):  # type: ignore[override]
            captured_inputs.append(list(inputs))
            return await super().ainvoke(inputs, config=config, **kwargs)

    model = _CapturingFakeModel(responses=[AIMessage(content="ok")])

    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        runner = AgentRunner(
            employee=_make_emp(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
            checkpointer=saver,
        )
        # Runner calls module-level _build_model with a real provider; for
        # the test we intercept it via monkeypatch so no API keys are needed
        # and state observations exercise the real LangGraph path.
        import allhands.execution.runner as runner_mod

        monkeypatch.setattr(runner_mod, "_build_model", lambda *a, **kw: model)

        async for _evt in runner.stream(
            messages=[{"role": "user", "content": "hello"}],
            thread_id=thread_id,
        ):
            pass

    assert captured_inputs, "model was never invoked"
    first_call = captured_inputs[0]
    system_like = [
        m
        for m in first_call
        if (
            isinstance(m, SystemMessage)
            or (isinstance(m, dict) and m.get("role") == "system")
            or (hasattr(m, "type") and getattr(m, "type", "") == "system")
        )
    ]
    assert system_like, (
        f"system prompt never reached the model: {[type(m).__name__ for m in first_call]}"
    )
    rendered = "".join(
        getattr(m, "content", None) or (m.get("content", "") if isinstance(m, dict) else "")
        for m in system_like
    )
    assert "STABLE_SYSTEM_MARKER_FOR_E26" in rendered, (
        f"expected marker in system prompt content, saw {rendered[:200]!r}"
    )
