"""Regression: assistant replies must persist to DB on every turn.

The "AI re-answers old questions" bug root cause: the runner streams tokens
to the frontend, the SSE closes, and then nothing writes the assistant's
reply to the messages table. The next turn's ``list_messages`` returns only
the accumulated user messages → the React agent sees N prompts and 0 answers
→ it re-answers every prior user turn on top of the new one.

ChatService._persist_assistant_reply is the tap that fixes this. These tests
exercise the tap directly with fabricated AgentEvent streams so the
regression can be pinned without spinning up LangGraph.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from allhands.core import (
    Conversation,
    Employee,
    EventEnvelope,
    Message,
    RenderPayload,
    ToolCall,
    ToolCallStatus,
)
from allhands.execution.event_bus import EventBus
from allhands.execution.events import (
    AgentEvent,
    DoneEvent,
    ErrorEvent,
    RenderEvent,
    TokenEvent,
    ToolCallEndEvent,
)
from allhands.execution.gate import AutoApproveGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlConversationRepo, SqlEmployeeRepo
from allhands.services.chat_service import ChatService


def _make_emp() -> Employee:
    return Employee(
        id="emp1",
        name="persist-test",
        description="",
        system_prompt="test-employee",
        model_ref="default",
        tool_ids=[],
        skill_ids=[],
        max_iterations=10,
        is_lead_agent=False,
        created_by="system",
        created_at=datetime.now(UTC),
        metadata={},
    )


def _make_conv() -> Conversation:
    return Conversation(
        id="conv1",
        employee_id="emp1",
        title=None,
        created_at=datetime(2026, 4, 20, tzinfo=UTC),
        metadata={},
    )


@pytest.fixture
async def chat_svc() -> AsyncIterator[tuple[ChatService, SqlConversationRepo, async_sessionmaker]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async with maker() as session:
        await SqlEmployeeRepo(session).upsert(_make_emp())
        await SqlConversationRepo(session).create(_make_conv())

    # Each repo instance binds to a session; the test will open fresh sessions
    # per operation so ChatService sees the durable state.
    session = maker()
    conv_repo = SqlConversationRepo(session)
    emp_repo = SqlEmployeeRepo(session)
    svc = ChatService(
        employee_repo=emp_repo,
        conversation_repo=conv_repo,
        tool_registry=ToolRegistry(),
        skill_registry=SkillRegistry(),
        gate=AutoApproveGate(),
    )
    try:
        yield svc, conv_repo, maker
    finally:
        await session.close()
        await engine.dispose()


async def _collect(stream: AsyncIterator[AgentEvent]) -> list[AgentEvent]:
    out: list[AgentEvent] = []
    async for e in stream:
        out.append(e)
    return out


@pytest.mark.asyncio
async def test_done_event_persists_assistant_message(chat_svc: tuple) -> None:
    """Normal completion: all tokens concatenated, one assistant row written."""
    svc, conv_repo, _ = chat_svc
    msg_id = str(uuid.uuid4())

    async def fake_stream() -> AsyncIterator[AgentEvent]:
        yield TokenEvent(message_id=msg_id, delta="Hello")
        yield TokenEvent(message_id=msg_id, delta=", world.")
        yield DoneEvent(message_id=msg_id, reason="done")

    events = await _collect(svc._persist_assistant_reply("conv1", fake_stream()))
    # Pass-through guarantee — caller (router) still sees every event.
    assert [e.kind for e in events] == ["token", "token", "done"]

    msgs = await conv_repo.list_messages("conv1")
    assistants = [m for m in msgs if m.role == "assistant"]
    assert len(assistants) == 1
    assert assistants[0].content == "Hello, world."
    assert assistants[0].id == msg_id


@pytest.mark.asyncio
async def test_error_event_still_persists_partial_content(chat_svc: tuple) -> None:
    """Partial reply on error is better than nothing — next turn still sees
    that the agent attempted an answer instead of treating the user message
    as unanswered."""
    svc, conv_repo, _ = chat_svc
    msg_id = str(uuid.uuid4())

    async def fake_stream() -> AsyncIterator[AgentEvent]:
        yield TokenEvent(message_id=msg_id, delta="I started to answer")
        yield ErrorEvent(code="INTERNAL", message="upstream crash")

    await _collect(svc._persist_assistant_reply("conv1", fake_stream()))
    msgs = await conv_repo.list_messages("conv1")
    assistants = [m for m in msgs if m.role == "assistant"]
    assert len(assistants) == 1
    assert assistants[0].content == "I started to answer"


@pytest.mark.asyncio
async def test_aclose_before_done_still_persists(chat_svc: tuple) -> None:
    """Client disconnect → caller aclose()s the generator before the done
    event fires. The finally block must salvage whatever was buffered so
    history stays consistent with what the user saw on screen."""
    svc, conv_repo, _ = chat_svc
    msg_id = str(uuid.uuid4())

    async def fake_stream() -> AsyncIterator[AgentEvent]:
        yield TokenEvent(message_id=msg_id, delta="partial")
        # Simulate a long pause where the client gives up.
        yield TokenEvent(message_id=msg_id, delta=" reply")
        # Never reach DoneEvent.

    wrapped = svc._persist_assistant_reply("conv1", fake_stream())
    # Consume two tokens then abandon the stream, mimicking aclose from the
    # SSE body iterator path in routers/chat.py.
    await wrapped.__anext__()
    await wrapped.__anext__()
    await wrapped.aclose()

    msgs = await conv_repo.list_messages("conv1")
    assistants = [m for m in msgs if m.role == "assistant"]
    assert len(assistants) == 1
    assert assistants[0].content == "partial reply"


@pytest.mark.asyncio
async def test_no_tokens_means_no_empty_row(chat_svc: tuple) -> None:
    """A turn that errors out before any token must not leave a ghost
    empty-content assistant row in history — that would confuse the agent
    into thinking it answered with silence."""
    svc, conv_repo, _ = chat_svc

    async def fake_stream() -> AsyncIterator[AgentEvent]:
        yield ErrorEvent(code="INTERNAL", message="crashed before any output")

    await _collect(svc._persist_assistant_reply("conv1", fake_stream()))
    msgs = await conv_repo.list_messages("conv1")
    assert [m.role for m in msgs] == []  # no user msg seeded, no assistant ghost


@pytest.mark.asyncio
async def test_turn_completion_publishes_cockpit_event(chat_svc: tuple) -> None:
    """A successful turn fires a ``conversation.turn_completed`` event on the
    bus so the cockpit activity feed has something to show during normal chat
    use. Before this, the feed only lit up for triggers/webhooks/artifacts and
    looked empty for a user who was mostly chatting."""
    svc, _conv_repo, _ = chat_svc
    bus = EventBus()
    svc._bus = bus
    published: list[tuple[str, dict]] = []

    async def capture(env: EventEnvelope) -> None:
        published.append((env.kind, env.payload))

    bus.subscribe_all(capture)

    msg_id = str(uuid.uuid4())
    employee = _make_emp()

    async def fake_stream() -> AsyncIterator[AgentEvent]:
        yield TokenEvent(message_id=msg_id, delta="the answer is 42")
        yield DoneEvent(message_id=msg_id, reason="done")

    await _collect(svc._persist_assistant_reply("conv1", fake_stream(), employee=employee))

    # E18: publish_best_effort now spawns a persist task which then spawns
    # fan-out tasks. Need to yield enough loop cycles for both layers to
    # drain. Poll with a bounded budget — far cheaper than a fixed sleep and
    # less flaky on slow CI.
    import asyncio

    for _ in range(10):
        if any(k == "conversation.turn_completed" for k, _ in published):
            break
        await asyncio.sleep(0.01)

    kinds = [k for k, _ in published]
    assert "conversation.turn_completed" in kinds, f"expected turn_completed; got {kinds}"
    payload = next(p for k, p in published if k == "conversation.turn_completed")
    assert payload["conversation_id"] == "conv1"
    assert payload["message_id"] == msg_id
    assert payload["employee_id"] == "emp1"
    assert "persist-test" in payload["summary"]
    assert "the answer is 42" in payload["summary"]
    assert payload["link"] == "/chat/conv1"


@pytest.mark.asyncio
async def test_no_event_published_when_no_content(chat_svc: tuple) -> None:
    """Ghost-row guard extends to the bus: if nothing was persisted (no tokens
    seen), no cockpit beat should be published either. Prevents the activity
    feed from filling up with empty-reply entries on stream errors."""
    svc, _conv_repo, _ = chat_svc
    bus = EventBus()
    svc._bus = bus
    published: list[str] = []

    async def capture(env: EventEnvelope) -> None:
        published.append(env.kind)

    bus.subscribe_all(capture)

    async def fake_stream() -> AsyncIterator[AgentEvent]:
        yield ErrorEvent(code="INTERNAL", message="died early")

    await _collect(svc._persist_assistant_reply("conv1", fake_stream()))

    import asyncio

    await asyncio.sleep(0)
    assert "conversation.turn_completed" not in published


@pytest.mark.asyncio
async def test_persisted_reply_appears_in_next_turn_history(chat_svc: tuple) -> None:
    """The bug manifestation: after one turn, list_messages must contain
    both user and assistant rows so the next turn's replay doesn't re-ask
    the model to answer the last prompt again."""
    svc, _conv_repo, maker = chat_svc

    # Seed a user message (chat_service.send_message normally does this
    # before handing off to the runner).
    async with maker() as session:
        repo = SqlConversationRepo(session)
        await repo.append_message(
            Message(
                id="u1",
                conversation_id="conv1",
                role="user",
                content="hello?",
                created_at=datetime(2026, 4, 20, 10, 0, tzinfo=UTC),
            )
        )

    msg_id = str(uuid.uuid4())

    async def fake_stream() -> AsyncIterator[AgentEvent]:
        yield TokenEvent(message_id=msg_id, delta="hi!")
        yield DoneEvent(message_id=msg_id, reason="done")

    await _collect(svc._persist_assistant_reply("conv1", fake_stream()))

    # Fresh session, fresh read — emulates the next turn rebuilding history.
    async with maker() as session:
        msgs = await SqlConversationRepo(session).list_messages("conv1")
    roles = [m.role for m in msgs]
    assert roles == ["user", "assistant"], (
        "next turn would see a user message with no answer, which is the "
        "exact state that makes the React agent re-answer prior turns"
    )


@pytest.mark.asyncio
async def test_render_and_tool_call_events_persist_with_assistant_message(
    chat_svc: tuple,
) -> None:
    """Historical render rehydration: RenderEvent + ToolCallEndEvent fired during
    a turn must land on the persisted assistant row so reopening the chat shows
    charts/cards/tables instead of a silent paragraph."""
    svc, _conv_repo, maker = chat_svc
    msg_id = str(uuid.uuid4())
    tc_id = str(uuid.uuid4())

    async def fake_stream() -> AsyncIterator[AgentEvent]:
        yield TokenEvent(message_id=msg_id, delta="Here is a chart:")
        yield ToolCallEndEvent(
            tool_call=ToolCall(
                id=tc_id,
                tool_id="allhands.render.bar_chart",
                args={"title": "Tasks per employee"},
                status=ToolCallStatus.SUCCEEDED,
                result={"component": "BarChart", "props": {"bars": [1, 2, 3]}},
            )
        )
        yield RenderEvent(
            message_id=msg_id,
            payload=RenderPayload(
                component="BarChart",
                props={"bars": [1, 2, 3]},
            ),
        )
        yield DoneEvent(message_id=msg_id, reason="done")

    await _collect(svc._persist_assistant_reply("conv1", fake_stream()))

    async with maker() as session:
        msgs = await SqlConversationRepo(session).list_messages("conv1")
    assistants = [m for m in msgs if m.role == "assistant"]
    assert len(assistants) == 1
    persisted = assistants[0]

    assert len(persisted.render_payloads) == 1, (
        "RenderEvent was dropped on the floor; a page reload will show text "
        "but not the chart the agent drew"
    )
    assert persisted.render_payloads[0].component == "BarChart"
    assert persisted.render_payloads[0].props == {"bars": [1, 2, 3]}

    assert len(persisted.tool_calls) == 1, (
        "ToolCallEndEvent was dropped; the inline system-tool chip would not "
        "reappear on history reload (L14)"
    )
    assert persisted.tool_calls[0].id == tc_id
    assert persisted.tool_calls[0].tool_id == "allhands.render.bar_chart"


# ─────────────────────────────────────────────────────────────────────────────
# 2026-05-05 · multi-iteration persistence + ordering
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_assistant_committed_per_iteration_persists_separate_rows(
    chat_svc: tuple,
) -> None:
    """Multi-iteration turn must produce one Message row per iteration plus
    one tool Message row per tool call — interleaved in execution order — so
    a page reload rehydrates the same shape the live UI rendered.

    Bug repro (pre-fix): max_iterations halt would dump the entire turn into
    a single squashed assistant row (or skip persistence entirely if buffer
    happened to be empty), making tool calls cluster at the bottom of one
    bubble after reload — or vanish completely.
    """
    from allhands.execution.events import AssistantCommittedEvent, ToolCallEndEvent

    svc, _conv_repo, maker = chat_svc

    msg_a = "msg-iter-1"
    msg_b = "msg-iter-2"
    tc1_id = "tc-1"
    tc2_id = "tc-2"

    async def fake_stream() -> AsyncIterator[AgentEvent]:
        # iteration 1: text + 1 tool call
        yield TokenEvent(message_id=msg_a, delta="计划:")
        yield TokenEvent(message_id=msg_a, delta=" 先列模型")
        yield AssistantCommittedEvent(
            message_id=msg_a,
            text="计划: 先列模型",
            tool_calls=[
                ToolCall(
                    id=tc1_id,
                    tool_id="allhands.list_models",
                    args={},
                    status=ToolCallStatus.RUNNING,
                )
            ],
        )
        yield ToolCallEndEvent(
            tool_call=ToolCall(
                id=tc1_id,
                tool_id="allhands.list_models",
                args={},
                status=ToolCallStatus.SUCCEEDED,
                result={"models": ["qwen3.6-plus"]},
            )
        )
        # iteration 2: text + 1 tool call
        yield TokenEvent(message_id=msg_b, delta="再创建 glm-5")
        yield AssistantCommittedEvent(
            message_id=msg_b,
            text="再创建 glm-5",
            tool_calls=[
                ToolCall(
                    id=tc2_id,
                    tool_id="allhands.create_model",
                    args={"name": "glm-5"},
                    status=ToolCallStatus.RUNNING,
                )
            ],
        )
        yield ToolCallEndEvent(
            tool_call=ToolCall(
                id=tc2_id,
                tool_id="allhands.create_model",
                args={"name": "glm-5"},
                status=ToolCallStatus.SUCCEEDED,
                result={"id": "model-glm5"},
            )
        )
        yield DoneEvent(message_id=msg_b, reason="done")

    await _collect(svc._persist_assistant_reply("conv1", fake_stream()))

    async with maker() as session:
        msgs = await SqlConversationRepo(session).list_messages("conv1")

    # Exactly 2 assistants + 2 tools, in execution order.
    roles_order = [m.role for m in msgs]
    assert roles_order == ["assistant", "tool", "assistant", "tool"], (
        f"Expected per-iteration interleaving, got {roles_order}. "
        "Pre-fix this collapsed to one assistant row with both tool_calls at end."
    )
    asst1, tool1, asst2, tool2 = msgs
    assert asst1.id == msg_a
    assert asst1.content == "计划: 先列模型"
    assert [tc.id for tc in asst1.tool_calls] == [tc1_id]
    assert tool1.tool_call_id == tc1_id
    assert asst2.id == msg_b
    assert asst2.content == "再创建 glm-5"
    assert [tc.id for tc in asst2.tool_calls] == [tc2_id]
    assert tool2.tool_call_id == tc2_id
    # Strict monotonic timestamps · the microsecond-bump guarantee.
    ts = [m.created_at for m in msgs]
    assert ts == sorted(ts), f"created_at not monotonic: {ts}"


@pytest.mark.asyncio
async def test_max_iterations_error_preserves_earlier_iterations(
    chat_svc: tuple,
) -> None:
    """When the loop hits max_iterations and emits ErrorEvent, the iterations
    that already completed must remain in DB. Pre-fix: if the trailing
    iteration's buffer happened to be empty, flush() short-circuited and the
    entire turn vanished on reload."""
    from allhands.execution.events import AssistantCommittedEvent, ToolCallEndEvent

    svc, _conv_repo, maker = chat_svc

    async def fake_stream() -> AsyncIterator[AgentEvent]:
        # 2 successful iterations
        yield TokenEvent(message_id="m1", delta="round 1")
        yield AssistantCommittedEvent(
            message_id="m1",
            text="round 1",
            tool_calls=[
                ToolCall(
                    id="t1",
                    tool_id="allhands.x",
                    args={},
                    status=ToolCallStatus.RUNNING,
                )
            ],
        )
        yield ToolCallEndEvent(
            tool_call=ToolCall(
                id="t1",
                tool_id="allhands.x",
                args={},
                status=ToolCallStatus.SUCCEEDED,
                result={"ok": True},
            )
        )
        # max_iterations halt — no further AssistantCommitted, just error.
        yield ErrorEvent(code="MAX_ITERATIONS", message="hit per-turn ceiling")

    await _collect(svc._persist_assistant_reply("conv1", fake_stream()))

    async with maker() as session:
        msgs = await SqlConversationRepo(session).list_messages("conv1")

    roles = [m.role for m in msgs]
    assert "assistant" in roles, (
        "Earlier iteration vanished after max_iterations. "
        "User-visible symptom: long conversation 'disappears' on reload."
    )
    assistants = [m for m in msgs if m.role == "assistant"]
    assert assistants[0].content == "round 1"
    tools = [m for m in msgs if m.role == "tool"]
    assert any(t.tool_call_id == "t1" for t in tools)
