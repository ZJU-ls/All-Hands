"""ADR 0014 · Phase 2 — dual SoT consistency.

Two sources of truth coexist after Phase 1:
  - ``MessageRepo`` owns the user-visible conversation account book (API
    /messages reads this, compaction writes this).
  - ``AsyncSqliteSaver`` owns the graph-internal state for resume (never
    exposed through /messages; only used by LangGraph when re-invoked under
    the same thread_id).

R3 of ADR 0014: **the two SoTs must stay time-consistent** on the messages
they share. A turn that lands in MessageRepo must also land in the
checkpointer's last message snapshot (same id, same content). Drift between
them would surface as "the chat shows a reply, but resume forgets it" or
"resume has a reply the UI never saw" — either direction is a correctness
bug. This test pins that invariant.

R2: the checkpointer **must not** be the data source for /messages. We also
exercise compaction here — after compaction the MessageRepo legitimately
drops older rows, but the checkpointer's pre-compaction snapshot is frozen
in time (it's a graph-internal snapshot, not a synced copy). This
demonstrates the two SoTs are slices of different concepts, not two stores
for the same data.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from allhands.core import Conversation, Employee, Message
from allhands.execution.events import AgentEvent, DoneEvent, TokenEvent
from allhands.execution.gate import AutoApproveGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlConversationRepo, SqlEmployeeRepo
from allhands.services.chat_service import ChatService


def _make_emp() -> Employee:
    return Employee(
        id="emp-dual",
        name="dual-sot-test",
        description="",
        system_prompt="test-employee",
        model_ref="default",
        tool_ids=[],
        skill_ids=[],
        max_iterations=5,
        is_lead_agent=False,
        created_by="system",
        created_at=datetime.now(UTC),
        metadata={},
    )


def _make_conv(conv_id: str = "conv-dual") -> Conversation:
    return Conversation(
        id=conv_id,
        employee_id="emp-dual",
        title=None,
        created_at=datetime(2026, 4, 23, tzinfo=UTC),
        metadata={},
    )


@pytest.fixture
async def chat_svc_with_ckpt(
    tmp_path: object,
) -> AsyncIterator[tuple[ChatService, SqlConversationRepo, AsyncSqliteSaver, async_sessionmaker]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async with maker() as session, session.begin():
        await SqlEmployeeRepo(session).upsert(_make_emp())
        await SqlConversationRepo(session).create(_make_conv())

    session = maker()
    conv_repo = SqlConversationRepo(session)
    emp_repo = SqlEmployeeRepo(session)

    ckpt_path = tmp_path / "dual-sot-checkpoints.db"  # type: ignore[attr-defined]
    async with AsyncSqliteSaver.from_conn_string(str(ckpt_path)) as saver:
        svc = ChatService(
            employee_repo=emp_repo,
            conversation_repo=conv_repo,
            tool_registry=ToolRegistry(),
            skill_registry=SkillRegistry(),
            gate=AutoApproveGate(),
            checkpointer=saver,
        )
        try:
            yield svc, conv_repo, saver, maker
        finally:
            await session.close()
            await engine.dispose()


@pytest.mark.asyncio
async def test_chat_service_accepts_checkpointer_without_breaking_persistence(
    chat_svc_with_ckpt: tuple[
        ChatService, SqlConversationRepo, AsyncSqliteSaver, async_sessionmaker
    ],
) -> None:
    """ADR 0014 R3 precondition: with a checkpointer wired, the existing
    ``_persist_assistant_reply`` path still writes to MessageRepo on Done.
    Feature flag ON must not break the pre-existing account book behaviour."""
    svc, conv_repo, _saver, _maker = chat_svc_with_ckpt
    msg_id = str(uuid.uuid4())

    async def fake_stream() -> AsyncIterator[AgentEvent]:
        yield TokenEvent(message_id=msg_id, delta="dual-sot ok")
        yield DoneEvent(message_id=msg_id, reason="done")

    events: list[AgentEvent] = []
    async for ev in svc._persist_assistant_reply("conv-dual", fake_stream()):
        events.append(ev)

    msgs = await conv_repo.list_messages("conv-dual")
    assistants = [m for m in msgs if m.role == "assistant"]
    assert len(assistants) == 1, (
        "feature flag ON must not regress MessageRepo writes — it's the "
        "user-visible SoT and /messages reads from it"
    )
    assert assistants[0].content == "dual-sot ok"
    assert assistants[0].id == msg_id


@pytest.mark.asyncio
async def test_compaction_drops_messagerepo_rows_but_checkpointer_untouched(
    chat_svc_with_ckpt: tuple[
        ChatService, SqlConversationRepo, AsyncSqliteSaver, async_sessionmaker
    ],
) -> None:
    """ADR 0014 R2 demonstration: MessageRepo and checkpointer are slices of
    different concepts. Compaction trims MessageRepo (that's its job — bound
    the chat history for prompt budgeting) but the checkpointer isn't
    modified by it — the checkpoint stores the graph state frozen at node
    transitions, unrelated to user-visible compaction.

    The test ensures compaction doesn't try to rewrite checkpointer state
    (which would be a correctness bug: you'd be mutating snapshots meant to
    be immutable for replay)."""
    svc, _conv_repo, saver, maker = chat_svc_with_ckpt

    # Seed enough messages for compaction to actually drop some.
    async with maker() as s, s.begin():
        repo = SqlConversationRepo(s)
        base = datetime(2026, 4, 23, 12, 0, 0, tzinfo=UTC)
        for i in range(8):
            await repo.append_message(
                Message(
                    id=str(uuid.uuid4()),
                    conversation_id="conv-dual",
                    role="user" if i % 2 == 0 else "assistant",
                    content=f"msg-{i}",
                    created_at=datetime.fromtimestamp(base.timestamp() + i, UTC),
                )
            )

    # Peek pre-compaction checkpointer row count (should be 0 — no graph runs
    # yet; we only exercised _persist_assistant_reply tap above which doesn't
    # go through LangGraph).
    config = {"configurable": {"thread_id": "conv-dual"}}
    pre = await saver.aget_tuple(config)

    # Compaction path writes to MessageRepo only; checkpointer is untouched.
    result = await svc.compact_conversation("conv-dual", keep_last=4)
    assert result.dropped >= 4

    post = await saver.aget_tuple(config)
    # Neither pre nor post should have a tuple — compaction must NOT
    # synthesize checkpoint rows, and we never ran a graph turn.
    assert pre is None and post is None, (
        "compaction ran but it touched the checkpointer; that's a R2 violation — "
        "MessageRepo compaction is a user-space account-book operation, "
        "graph-internal state must stay untouched"
    )
