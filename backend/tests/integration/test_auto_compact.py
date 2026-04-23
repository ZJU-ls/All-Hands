"""ADR 0017 · P2.B — auto-compaction contract tests.

Exercises the full pipeline against the real SqlConversationEventRepo
+ a fake summarizer so nothing depends on provider creds.

Contracts:
- Below threshold → no-op
- Above threshold → summary event emitted + old events marked compacted
- Circuit breaker: 3 failures → stop trying until reset
- PTL retry: recovers when summarizer rejects the biggest payload and
  succeeds after stripping 20%
- Original events are NEVER deleted (append-only invariant)
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from allhands.core import ConversationEvent, EventKind
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlConversationEventRepo
from allhands.services.auto_compact import (
    AutoCompactManager,
    CompactionConfig,
    estimate_tokens_for_events,
)


@pytest.fixture
async def event_repo() -> AsyncIterator[SqlConversationEventRepo]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    session = maker()
    try:
        yield SqlConversationEventRepo(session)
    finally:
        await session.close()
        await engine.dispose()


async def _seed_heavy_conversation(
    event_repo: SqlConversationEventRepo,
    conv_id: str,
    *,
    turns: int = 20,
    chars_per_msg: int = 2000,
) -> None:
    """Fill a conversation with chunky user/assistant messages so the
    token estimate clears the trigger threshold."""
    payload = "x" * chars_per_msg
    for i in range(turns):
        await event_repo.append(
            ConversationEvent(
                id=str(uuid.uuid4()),
                conversation_id=conv_id,
                parent_id=None,
                sequence=await event_repo.next_sequence(conv_id),
                kind=EventKind.USER,
                content_json={"content": f"u{i} {payload}"},
                created_at=datetime.now(UTC),
            )
        )
        await event_repo.append(
            ConversationEvent(
                id=str(uuid.uuid4()),
                conversation_id=conv_id,
                parent_id=None,
                sequence=await event_repo.next_sequence(conv_id),
                kind=EventKind.ASSISTANT,
                content_json={"content": f"a{i} {payload}"},
                created_at=datetime.now(UTC),
            )
        )


@pytest.mark.asyncio
async def test_below_threshold_noop(event_repo: SqlConversationEventRepo) -> None:
    mgr = AutoCompactManager(config=CompactionConfig(context_window_tokens=200_000))
    conv = "conv-1"
    await _seed_heavy_conversation(event_repo, conv, turns=2, chars_per_msg=100)

    calls: list[list[dict]] = []

    async def summarizer(msgs: list[dict]) -> str:
        calls.append(msgs)
        return "summary"

    result = await mgr.maybe_compact(conv, event_repo, summarizer)
    assert result.compacted is False
    assert calls == []
    # Events untouched
    events = await event_repo.list_by_conversation(conv)
    assert len(events) == 4
    assert all(not e.is_compacted for e in events)


@pytest.mark.asyncio
async def test_above_threshold_emits_summary_and_marks_compacted(
    event_repo: SqlConversationEventRepo,
) -> None:
    # Tight window so moderate seed trips trigger.
    cfg = CompactionConfig(
        context_window_tokens=4_000,
        summary_reserve_tokens=100,
        trigger_ratio=0.3,
    )
    mgr = AutoCompactManager(config=cfg)
    conv = "conv-compact"
    await _seed_heavy_conversation(event_repo, conv, turns=10, chars_per_msg=500)

    async def summarizer(msgs: list[dict]) -> str:
        return "compressed: earlier we discussed X"

    result = await mgr.maybe_compact(conv, event_repo, summarizer)
    assert result.compacted is True
    assert result.events_covered >= 4
    assert result.summary_event_id is not None

    events = await event_repo.list_by_conversation(conv)
    # SUMMARY event at the tail
    summaries = [e for e in events if e.kind == EventKind.SUMMARY]
    assert len(summaries) == 1
    assert summaries[0].content_json["summary_text"].startswith("compressed:")
    assert summaries[0].content_json["events_covered"] == result.events_covered

    compacted = [e for e in events if e.is_compacted]
    assert len(compacted) == result.events_covered

    # Recent half remains non-compacted (ready for next turn)
    live_non_summary = [e for e in events if not e.is_compacted and e.kind != EventKind.SUMMARY]
    assert len(live_non_summary) > 0


@pytest.mark.asyncio
async def test_circuit_breaker_after_three_failures(
    event_repo: SqlConversationEventRepo,
) -> None:
    cfg = CompactionConfig(
        context_window_tokens=4_000, summary_reserve_tokens=100, trigger_ratio=0.3
    )
    mgr = AutoCompactManager(config=cfg)
    conv = "conv-breaker"
    await _seed_heavy_conversation(event_repo, conv, turns=10, chars_per_msg=500)

    async def failing_summarizer(_: list[dict]) -> str:
        raise RuntimeError("provider down")

    for _ in range(3):
        r = await mgr.maybe_compact(conv, event_repo, failing_summarizer)
        assert r.compacted is False

    # 4th call should short-circuit without invoking summarizer
    calls: list[int] = []

    async def counting_summarizer(_: list[dict]) -> str:
        calls.append(1)
        return "ok"

    r = await mgr.maybe_compact(conv, event_repo, counting_summarizer)
    assert r.compacted is False
    assert r.circuit_open is True
    assert calls == []


@pytest.mark.asyncio
async def test_ptl_fallback_recovers_after_stripping(
    event_repo: SqlConversationEventRepo,
) -> None:
    cfg = CompactionConfig(
        context_window_tokens=4_000, summary_reserve_tokens=100, trigger_ratio=0.3
    )
    mgr = AutoCompactManager(config=cfg)
    conv = "conv-ptl"
    await _seed_heavy_conversation(event_repo, conv, turns=10, chars_per_msg=500)

    call_count = {"n": 0}

    async def ptl_then_ok(msgs: list[dict]) -> str:
        call_count["n"] += 1
        if call_count["n"] == 1:
            # First call: fake a PTL error
            raise RuntimeError("prompt too long for this model")
        # Subsequent call (post-strip) succeeds
        return f"summary of {len(msgs)} messages"

    result = await mgr.maybe_compact(conv, event_repo, ptl_then_ok)
    assert result.compacted is True
    assert call_count["n"] == 2


@pytest.mark.asyncio
async def test_original_events_never_deleted(
    event_repo: SqlConversationEventRepo,
) -> None:
    """Claude Code invariant: SUMMARY is projection-only; raw history
    stays queryable for audit / branch / debug."""
    cfg = CompactionConfig(
        context_window_tokens=4_000, summary_reserve_tokens=100, trigger_ratio=0.3
    )
    mgr = AutoCompactManager(config=cfg)
    conv = "conv-noeat"
    await _seed_heavy_conversation(event_repo, conv, turns=10, chars_per_msg=500)
    original_count = len(await event_repo.list_by_conversation(conv))

    async def summarizer(_: list[dict]) -> str:
        return "summary"

    await mgr.maybe_compact(conv, event_repo, summarizer)
    # Original + 1 summary event = original_count + 1. No deletions.
    post_count = len(await event_repo.list_by_conversation(conv, include_compacted=True))
    assert post_count == original_count + 1


def test_estimate_tokens_for_events_heuristic() -> None:
    events = [
        ConversationEvent(
            id="1",
            conversation_id="c",
            parent_id=None,
            sequence=1,
            kind=EventKind.USER,
            content_json={"content": "x" * 400},
            created_at=datetime.now(UTC),
        ),
    ]
    # 400 chars / 4 chars-per-token = 100 tokens
    assert estimate_tokens_for_events(events) == 100
