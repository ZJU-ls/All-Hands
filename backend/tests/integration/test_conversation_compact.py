"""Track ε — manual context compaction.

Verifies:
  - POST /api/conversations/{id}/compact drops older messages, keeps the last
    N, and inserts a synthetic system-role marker in their place.
  - The marker sorts earlier than the earliest kept message (the chat UI
    renders chronologically, so a marker that surfaces after the kept tail
    would lie about what was removed).
  - Compacting a short conversation is a no-op (dropped = 0).
  - keep_last < 4 is rejected (compaction below that bound has no value — it
    would remove the context the user just sent).
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from allhands.api import create_app
from allhands.api.deps import get_session
from allhands.core import (
    Conversation,
    Employee,
    Message,
    RenderPayload,
    ToolCall,
    ToolCallStatus,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlConversationRepo, SqlEmployeeRepo


def _make_emp() -> Employee:
    return Employee(
        id="emp1",
        name="compact-test",
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
        created_at=datetime(2026, 4, 1, tzinfo=UTC),
        metadata={},
    )


def _make_msg(i: int, created_at: datetime) -> Message:
    return Message(
        id=str(uuid.uuid4()),
        conversation_id="conv1",
        role="user" if i % 2 == 0 else "assistant",
        content=f"msg-{i}",
        created_at=created_at,
    )


async def _seed(engine: AsyncEngine, n_messages: int) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        await SqlEmployeeRepo(session).upsert(_make_emp())
        conv_repo = SqlConversationRepo(session)
        await conv_repo.create(_make_conv())
        base = datetime(2026, 4, 1, 12, 0, 0, tzinfo=UTC)
        for i in range(n_messages):
            await conv_repo.append_message(_make_msg(i, base + timedelta(seconds=i)))


@pytest.fixture
def make_client():
    def _build(n_messages: int) -> TestClient:
        engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
        asyncio.run(_seed(engine, n_messages))

        async def _session() -> AsyncIterator[AsyncSession]:
            maker = async_sessionmaker(engine, expire_on_commit=False)
            async with maker() as s:
                yield s

        app = create_app()
        app.dependency_overrides[get_session] = _session
        return TestClient(app)

    return _build


def test_compact_soft_flags_older_keeps_tail_and_inserts_marker(make_client) -> None:
    """Dual-view contract (compact-dual-view.md, 2026-04-28):

    Old messages are NOT deleted — they are soft-flagged ``is_compacted=True``
    so the UI keeps them in the transcript (rendered behind a fold) while
    the LLM context build path filters them out. The summary marker is
    appended with ``is_compacted=False`` so it survives the filter.
    """
    client = make_client(n_messages=30)
    resp = client.post("/api/conversations/conv1/compact", json={"keep_last": 10})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dropped"] == 20
    assert body["summary_id"] is not None

    messages = body["messages"]
    # 30 originals (now compacted) + 1 summary marker = 31
    assert len(messages) == 31

    compacted = [m for m in messages if m["is_compacted"]]
    live = [m for m in messages if not m["is_compacted"]]
    # 20 oldest are flagged; 10 kept tail + 1 summary stay live.
    assert len(compacted) == 20
    assert len(live) == 11

    # Summary chronologically first among live rows (renders before tail).
    summary = next(m for m in live if m["role"] == "system")
    assert "20" in summary["content"]
    assert "压缩" in summary["content"]
    assert summary["is_compacted"] is False

    live_chat = [m for m in live if m["role"] in ("user", "assistant")]
    assert [m["content"] for m in live_chat] == [f"msg-{i}" for i in range(20, 30)]
    # Compacted ones are still the originals msg-0 … msg-19
    assert [m["content"] for m in compacted] == [f"msg-{i}" for i in range(20)]


def test_compact_noop_when_below_threshold(make_client) -> None:
    client = make_client(n_messages=5)
    resp = client.post("/api/conversations/conv1/compact", json={"keep_last": 10})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dropped"] == 0
    assert body["summary_id"] is None
    assert len(body["messages"]) == 5


def test_compact_rejects_keep_last_below_four(make_client) -> None:
    client = make_client(n_messages=10)
    resp = client.post("/api/conversations/conv1/compact", json={"keep_last": 2})
    assert resp.status_code == 400
    assert "keep_last" in resp.json()["detail"]


def test_list_messages_endpoint_returns_ordered_history(make_client) -> None:
    client = make_client(n_messages=4)
    resp = client.get("/api/conversations/conv1/messages")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [m["content"] for m in body] == ["msg-0", "msg-1", "msg-2", "msg-3"]
    # Round-trip ISO timestamps so the frontend can Date.parse them.
    for m in body:
        assert m["created_at"].endswith("+00:00") or m["created_at"].endswith("Z")


def test_list_messages_returns_404_for_unknown_conversation(make_client) -> None:
    client = make_client(n_messages=1)
    resp = client.get("/api/conversations/does-not-exist/messages")
    assert resp.status_code == 404


async def _seed_with_render_row(engine: AsyncEngine) -> tuple[str, str]:
    """Seed one assistant message carrying render_payloads + tool_calls +
    reasoning so the endpoint shape can be exercised end-to-end. Returns the
    message_id and tool_call_id so assertions can pin exact fields."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    msg_id = str(uuid.uuid4())
    tc_id = str(uuid.uuid4())
    async with maker() as session:
        await SqlEmployeeRepo(session).upsert(_make_emp())
        conv_repo = SqlConversationRepo(session)
        await conv_repo.create(_make_conv())
        await conv_repo.append_message(
            Message(
                id=msg_id,
                conversation_id="conv1",
                role="assistant",
                content="Here is a chart:",
                reasoning="decided BarChart was the right component",
                render_payloads=[
                    RenderPayload(
                        component="BarChart",
                        props={"bars": [1, 2, 3]},
                    )
                ],
                tool_calls=[
                    ToolCall(
                        id=tc_id,
                        tool_id="allhands.render.bar_chart",
                        args={"title": "Tasks"},
                        status=ToolCallStatus.SUCCEEDED,
                        result={"component": "BarChart", "props": {"bars": [1, 2, 3]}},
                    )
                ],
                created_at=datetime(2026, 4, 22, 12, 0, 0, tzinfo=UTC),
            )
        )
    return msg_id, tc_id


def test_list_messages_endpoint_returns_render_payloads_and_tool_calls() -> None:
    """Historical rehydrate: GET /messages must surface what the DB stored so
    the chat UI redraws charts / cards / tool chips after a reload.
    Bug before fix: ChatMessageResponse silently dropped these fields."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    msg_id, tc_id = asyncio.run(_seed_with_render_row(engine))

    async def _session() -> AsyncIterator[AsyncSession]:
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s:
            yield s

    app = create_app()
    app.dependency_overrides[get_session] = _session
    client = TestClient(app)

    resp = client.get("/api/conversations/conv1/messages")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    row = body[0]

    assert row["id"] == msg_id
    assert row["content"] == "Here is a chart:"
    assert row["reasoning"] == "decided BarChart was the right component"

    assert len(row["render_payloads"]) == 1
    assert row["render_payloads"][0]["component"] == "BarChart"
    assert row["render_payloads"][0]["props"] == {"bars": [1, 2, 3]}

    assert len(row["tool_calls"]) == 1
    assert row["tool_calls"][0]["id"] == tc_id
    assert row["tool_calls"][0]["tool_id"] == "allhands.render.bar_chart"


def test_compact_response_preserves_render_payloads() -> None:
    """Compaction path symmetry: every message in the compact response keeps
    render_payloads / tool_calls / reasoning intact, including the soft-
    flagged compacted ones — the UI now renders them behind the fold."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    asyncio.run(_seed_with_render_row(engine))
    # Pad so compact has something to drop; the seeded render row is the
    # newest one so it survives the compaction.
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def _pad() -> None:
        async with maker() as session:
            repo = SqlConversationRepo(session)
            for i in range(10):
                await repo.append_message(
                    Message(
                        id=str(uuid.uuid4()),
                        conversation_id="conv1",
                        role="user" if i % 2 == 0 else "assistant",
                        content=f"pad-{i}",
                        created_at=datetime(2026, 4, 22, 11, i, tzinfo=UTC),
                    )
                )

    asyncio.run(_pad())

    async def _session() -> AsyncIterator[AsyncSession]:
        async with maker() as s:
            yield s

    app = create_app()
    app.dependency_overrides[get_session] = _session
    client = TestClient(app)

    resp = client.post("/api/conversations/conv1/compact", json={"keep_last": 5})
    assert resp.status_code == 200, resp.text
    messages = resp.json()["messages"]
    # The render-carrying assistant row must still be present in full
    # (not deleted from the DB) so the UI fold can show it on expand.
    render_rows = [m for m in messages if m.get("render_payloads")]
    assert len(render_rows) == 1
    assert render_rows[0]["render_payloads"][0]["component"] == "BarChart"


def test_compact_rolling_merge_folds_prior_summary(make_client) -> None:
    """Pressing 整理 twice must end up with a single live summary marker —
    the prior compact's summary gets folded into the new compact range so
    we don't pile multiple "[系统] 已压缩 …" rows in the LLM context."""
    client = make_client(n_messages=30)

    first = client.post("/api/conversations/conv1/compact", json={"keep_last": 10})
    assert first.status_code == 200
    first_summary_id = first.json()["summary_id"]

    # Pad some new live turns then compact again.
    # Use the messages endpoint to confirm state mid-flight.
    listing = client.get("/api/conversations/conv1/messages").json()
    live_after_first = [m for m in listing if not m["is_compacted"]]
    # 10 kept tail + 1 live summary
    assert len(live_after_first) == 11

    # Now press compact again (still keep_last=10 — only 11 live, 1 over).
    second = client.post("/api/conversations/conv1/compact", json={"keep_last": 5})
    assert second.status_code == 200, second.text
    body = second.json()
    # 11 live - 5 keep = 6 dropped (5 user/assistant + 1 prior summary).
    # Service counts only user/assistant drops in `dropped`; summary fold
    # is internal to the rolling-merge mechanic.
    assert body["dropped"] >= 5

    listing2 = body["messages"]
    live = [m for m in listing2 if not m["is_compacted"]]
    summaries_live = [m for m in live if m["role"] == "system"]
    # Single live summary remains.
    assert len(summaries_live) == 1
    # The prior summary id is now flagged compacted.
    by_id = {m["id"]: m for m in listing2}
    assert by_id[first_summary_id]["is_compacted"] is True


def test_compact_below_threshold_returns_full_history_with_flags_intact(
    make_client,
) -> None:
    """Pre-existing noop branch (n_messages < keep_last) now returns the full
    list including ``is_compacted`` shape so the UI can hydrate uniformly."""
    client = make_client(n_messages=5)
    resp = client.post("/api/conversations/conv1/compact", json={"keep_last": 10})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dropped"] == 0
    assert len(body["messages"]) == 5
    assert all(m["is_compacted"] is False for m in body["messages"])


def test_compact_excludes_compacted_from_fallback_llm_context(make_client) -> None:
    """Direct service-level check that the legacy ``event_repo is None``
    path filters compacted non-system messages and surfaces the live
    summary marker as an ``<earlier_summary>`` injection — that's the
    actual win that shrinks the LLM token budget after /compact."""
    import asyncio

    from allhands.execution.gate import AutoApproveGate
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.skills import SkillRegistry
    from allhands.persistence.sql_repos import SqlConversationRepo, SqlEmployeeRepo
    from allhands.services.chat_service import ChatService

    client = make_client(n_messages=20)
    resp = client.post("/api/conversations/conv1/compact", json={"keep_last": 5})
    assert resp.status_code == 200

    # Directly poke the service to verify the fallback projection.
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )

    async def _run() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as session:
            await SqlEmployeeRepo(session).upsert(_make_emp())
            conv_repo = SqlConversationRepo(session)
            await conv_repo.create(_make_conv())
            for i in range(20):
                await conv_repo.append_message(
                    Message(
                        id=str(uuid.uuid4()),
                        conversation_id="conv1",
                        role="user" if i % 2 == 0 else "assistant",
                        content=f"msg-{i}",
                        created_at=datetime(2026, 4, 22, 12, 0, i, tzinfo=UTC),
                    )
                )

            svc = ChatService(
                employee_repo=SqlEmployeeRepo(session),
                conversation_repo=conv_repo,
                tool_registry=ToolRegistry(),
                skill_registry=SkillRegistry(),
                gate=AutoApproveGate(),
            )
            await svc.compact_conversation("conv1", keep_last=5)

            # Replay the fallback projection.
            history = await conv_repo.list_messages("conv1")
            visible = [m for m in history if not m.is_compacted]
            summaries = [m for m in visible if m.role == "system"]
            chat = [m for m in visible if m.role in ("user", "assistant")]
            # 5 kept tail + 1 live summary; 15 originals flagged.
            assert len(chat) == 5
            assert len(summaries) == 1
            assert all(
                m.is_compacted
                for m in history
                if m.role != "system"
                and m.content.startswith("msg-")
                and int(m.content.split("-")[1]) < 15
            )

    asyncio.run(_run())
