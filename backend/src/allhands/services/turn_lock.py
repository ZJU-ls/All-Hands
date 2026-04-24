"""ADR 0017 · per-conversation turn lock + crash recovery.

A single conversation can only have one active assistant turn at a time.
The user can still send a *new* user message mid-stream — that's a valid
supersede (the S1/S2 scenarios in plan §1) — but we must cancel the old
turn first and record a TURN_ABORTED event so ``build_llm_context``
synthesizes a coherent placeholder assistant message on the next
projection.

This module gives chat_service:

1. ``TurnLockManager`` — per-conversation in-memory ``asyncio.Lock`` +
   registry of currently-running turns so we can cancel them.
2. ``scan_and_close_orphan_turns`` — startup crash-recovery: find
   conversations that have a TURN_STARTED without TURN_COMPLETED /
   TURN_ABORTED and close them with reason=crash_recovery.

Postgres-friendly: once P4.A swaps to Postgres, the in-memory lock
upgrades to ``pg_advisory_xact_lock`` via ``TurnLockManager`` subclass
(P4.B); the API here stays identical.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from allhands.core import ConversationEvent, EventKind, TurnAbortReason

if TYPE_CHECKING:
    from allhands.persistence.repositories import ConversationEventRepo


log = logging.getLogger(__name__)


@dataclass
class _ActiveTurn:
    """In-flight turn bookkeeping. ``task`` is the asyncio.Task running
    the stream generator; ``cancel_event`` is set when a new user msg
    supersedes this turn so downstream code can short-circuit.
    """

    turn_id: str
    started_at: datetime
    run_id: str | None = None
    task: asyncio.Task[Any] | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    partial_content: list[str] = field(default_factory=list)


class TurnLockManager:
    """Per-conversation turn registry.

    Usage from chat_service:

        async with lock_mgr.conversation_lock(conversation_id):
            # Check for a superseded turn; write TURN_ABORTED if so.
            await lock_mgr.supersede_if_active(
                event_repo, conversation_id, reason=USER_SUPERSEDED
            )
            turn = lock_mgr.start_turn(conversation_id)
            try:
                # ... run stream, record partials via turn.partial_content.append()
                await lock_mgr.complete_turn(event_repo, conversation_id, turn)
            except Exception as exc:
                await lock_mgr.abort_turn(
                    event_repo, conversation_id, turn,
                    reason=STREAM_ERROR, error=str(exc),
                )
                raise
    """

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}
        self._active: dict[str, _ActiveTurn] = {}

    def conversation_lock(self, conversation_id: str) -> asyncio.Lock:
        """Return a per-conversation lock (lazy). Callers should ``async
        with`` this to serialize the event-log write path."""
        lock = self._locks.get(conversation_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[conversation_id] = lock
        return lock

    def start_turn(
        self,
        conversation_id: str,
        *,
        run_id: str | None = None,
        turn_id: str | None = None,
    ) -> _ActiveTurn:
        """Register a new active turn. Caller is expected to have held
        ``conversation_lock`` and called ``supersede_if_active`` first.
        """
        turn = _ActiveTurn(
            turn_id=turn_id or str(uuid.uuid4()),
            started_at=datetime.now(UTC),
            run_id=run_id,
        )
        self._active[conversation_id] = turn
        return turn

    def active_turn(self, conversation_id: str) -> _ActiveTurn | None:
        return self._active.get(conversation_id)

    def clear(self, conversation_id: str) -> None:
        self._active.pop(conversation_id, None)

    async def supersede_if_active(
        self,
        event_repo: ConversationEventRepo,
        conversation_id: str,
        *,
        reason: TurnAbortReason = TurnAbortReason.USER_SUPERSEDED,
    ) -> _ActiveTurn | None:
        """If there is an in-flight turn on this conversation, write a
        TURN_ABORTED event for it and cancel the stream task. Returns the
        superseded turn record (or None if nothing was active).
        """
        prior = self._active.pop(conversation_id, None)
        if prior is None:
            return None
        try:
            await event_repo.append(
                ConversationEvent(
                    id=str(uuid.uuid4()),
                    conversation_id=conversation_id,
                    parent_id=None,
                    sequence=await event_repo.next_sequence(conversation_id),
                    kind=EventKind.TURN_ABORTED,
                    content_json={
                        "turn_id": prior.turn_id,
                        "reason": reason.value,
                        "run_id": prior.run_id,
                        "partial_content": "".join(prior.partial_content),
                    },
                    turn_id=prior.turn_id,
                    created_at=datetime.now(UTC),
                )
            )
        except Exception:
            log.exception(
                "turn_lock.supersede.append_failed",
                extra={"conversation_id": conversation_id, "turn_id": prior.turn_id},
            )

        prior.cancel_event.set()
        if prior.task is not None and not prior.task.done():
            prior.task.cancel()
        return prior

    async def complete_turn(
        self,
        event_repo: ConversationEventRepo,
        conversation_id: str,
        turn: _ActiveTurn,
    ) -> None:
        """Write TURN_COMPLETED + clear registry. Idempotent."""
        if self._active.get(conversation_id) is turn:
            del self._active[conversation_id]
        try:
            await event_repo.append(
                ConversationEvent(
                    id=str(uuid.uuid4()),
                    conversation_id=conversation_id,
                    parent_id=None,
                    sequence=await event_repo.next_sequence(conversation_id),
                    kind=EventKind.TURN_COMPLETED,
                    content_json={
                        "turn_id": turn.turn_id,
                        "run_id": turn.run_id,
                    },
                    turn_id=turn.turn_id,
                    created_at=datetime.now(UTC),
                )
            )
        except Exception:
            log.exception(
                "turn_lock.complete.append_failed",
                extra={"conversation_id": conversation_id, "turn_id": turn.turn_id},
            )

    async def abort_turn(
        self,
        event_repo: ConversationEventRepo,
        conversation_id: str,
        turn: _ActiveTurn,
        *,
        reason: TurnAbortReason,
        error: str | None = None,
    ) -> None:
        """Write TURN_ABORTED for an in-flight turn that hit an error."""
        if self._active.get(conversation_id) is turn:
            del self._active[conversation_id]
        try:
            await event_repo.append(
                ConversationEvent(
                    id=str(uuid.uuid4()),
                    conversation_id=conversation_id,
                    parent_id=None,
                    sequence=await event_repo.next_sequence(conversation_id),
                    kind=EventKind.TURN_ABORTED,
                    content_json={
                        "turn_id": turn.turn_id,
                        "reason": reason.value,
                        "run_id": turn.run_id,
                        "partial_content": "".join(turn.partial_content),
                        "error": error,
                    },
                    turn_id=turn.turn_id,
                    created_at=datetime.now(UTC),
                )
            )
        except Exception:
            log.exception(
                "turn_lock.abort.append_failed",
                extra={"conversation_id": conversation_id, "turn_id": turn.turn_id},
            )


async def scan_and_close_orphan_turns(
    *,
    event_repo: ConversationEventRepo,
    conversation_repo: Any,
) -> int:
    """Startup crash recovery. For every conversation, find orphan turn_ids
    (TURN_STARTED without TURN_COMPLETED / TURN_ABORTED) and close each
    with reason=CRASH_RECOVERY. Returns the number of orphans closed.
    """
    convs = await conversation_repo.list_all()
    closed = 0
    for conv in convs:
        try:
            orphans = await event_repo.find_orphan_turns(conv.id)
        except Exception:
            log.exception(
                "turn_lock.orphan_scan.failed",
                extra={"conversation_id": conv.id},
            )
            continue
        for turn_id in orphans:
            try:
                await event_repo.append(
                    ConversationEvent(
                        id=str(uuid.uuid4()),
                        conversation_id=conv.id,
                        parent_id=None,
                        sequence=await event_repo.next_sequence(conv.id),
                        kind=EventKind.TURN_ABORTED,
                        content_json={
                            "turn_id": turn_id,
                            "reason": TurnAbortReason.CRASH_RECOVERY.value,
                        },
                        turn_id=turn_id,
                        created_at=datetime.now(UTC),
                    )
                )
                closed += 1
            except Exception:
                log.exception(
                    "turn_lock.orphan_close.failed",
                    extra={"conversation_id": conv.id, "turn_id": turn_id},
                )
    return closed
