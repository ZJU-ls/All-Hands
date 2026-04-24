"""ADR 0017 · P3.B — branch / regenerate for event-sourced conversations.

A branch is a fresh conversation seeded with a copy of another
conversation's event log up to a chosen fork point. It's the
event-sourcing answer to "let me go back to message N and try a
different path" — the original conversation is untouched, the branch
continues from the same state.

Regenerate is a tiny cousin of branch: fork from the last USER event
so the assistant gets a clean second attempt without polluting the
original conversation's timeline (which keeps the old assistant
answer + a CONVERSATION_FORKED marker for discoverability).

Both are *projection-safe*: the source conversation's events stay as
they were, so audit / compact / undo / other branches still work.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from allhands.core import (
    Conversation,
    ConversationEvent,
    EventKind,
)

if TYPE_CHECKING:
    from allhands.persistence.repositories import (
        ConversationEventRepo,
        ConversationRepo,
    )


log = logging.getLogger(__name__)


async def branch_from_event(
    *,
    source_conversation_id: str,
    from_event_id: str,
    new_title: str | None,
    conversation_repo: ConversationRepo,
    event_repo: ConversationEventRepo,
) -> Conversation:
    """Create a new conversation whose event log is a prefix copy of the
    source up through ``from_event_id`` (inclusive).

    The new conversation inherits ``employee_id`` and
    ``model_ref_override`` from the source so subsequent turns use the
    same assistant identity. A ``CONVERSATION_FORKED`` event is appended
    to both the source (as a discoverability marker — "a branch was
    created here") and the new conversation (as its genesis record).
    """
    source = await conversation_repo.get(source_conversation_id)
    if source is None:
        raise ValueError(f"Source conversation {source_conversation_id!r} not found")

    # Locate the fork point to validate the caller's request.
    fork_event = await event_repo.get(from_event_id)
    if fork_event is None or fork_event.conversation_id != source_conversation_id:
        raise ValueError(f"Event {from_event_id!r} does not belong to source conversation")

    # Materialize the new conversation shell.
    new_conv = Conversation(
        id=f"conv-{uuid.uuid4().hex}",
        employee_id=source.employee_id,
        title=new_title or f"{source.title or 'Conversation'} (branch)",
        model_ref_override=source.model_ref_override,
        created_at=datetime.now(UTC),
        metadata={
            **(source.metadata or {}),
            "branched_from": source_conversation_id,
            "branched_from_event": from_event_id,
        },
    )
    await conversation_repo.create(new_conv)

    # Copy events up through fork_event.sequence into the new
    # conversation's log, preserving kind + content_json but remapping
    # sequence / id / turn_id so nothing collides.
    source_events = await event_repo.list_by_conversation(
        source_conversation_id, include_compacted=True
    )
    for evt in source_events:
        if evt.sequence > fork_event.sequence:
            break
        if evt.kind == EventKind.CONVERSATION_FORKED:
            # Don't chain past-fork markers into the new branch; a branch's
            # own fork event is the one we append below.
            continue
        await event_repo.append(
            ConversationEvent(
                id=str(uuid.uuid4()),  # new id — new conversation
                conversation_id=new_conv.id,
                parent_id=evt.id,  # reference the original event for audit
                sequence=await event_repo.next_sequence(new_conv.id),
                kind=evt.kind,
                content_json=dict(evt.content_json),
                subagent_id=evt.subagent_id,
                turn_id=evt.turn_id,
                idempotency_key=None,
                is_compacted=evt.is_compacted,
                created_at=datetime.now(UTC),
            )
        )

    # Mark the genesis in the new conversation.
    await event_repo.append(
        ConversationEvent(
            id=str(uuid.uuid4()),
            conversation_id=new_conv.id,
            parent_id=from_event_id,
            sequence=await event_repo.next_sequence(new_conv.id),
            kind=EventKind.CONVERSATION_FORKED,
            content_json={
                "source_conversation_id": source_conversation_id,
                "source_event_id": from_event_id,
                "reason": "branch",
            },
            created_at=datetime.now(UTC),
        )
    )

    # Mark the fork on the source so the UI can show "a branch started here".
    try:
        await event_repo.append(
            ConversationEvent(
                id=str(uuid.uuid4()),
                conversation_id=source_conversation_id,
                parent_id=from_event_id,
                sequence=await event_repo.next_sequence(source_conversation_id),
                kind=EventKind.CONVERSATION_FORKED,
                content_json={
                    "new_conversation_id": new_conv.id,
                    "source_event_id": from_event_id,
                    "reason": "branch",
                },
                created_at=datetime.now(UTC),
            )
        )
    except Exception:
        log.exception(
            "branch.source_marker.failed",
            extra={"source_conversation_id": source_conversation_id},
        )

    return new_conv


async def regenerate_last_turn(
    *,
    conversation_id: str,
    conversation_repo: ConversationRepo,
    event_repo: ConversationEventRepo,
) -> Conversation:
    """Create a branch that forks from the last USER event on the source.
    The new conversation is ready to accept a new send_message call
    which will prompt the model to re-answer the same user question.
    """
    events = await event_repo.list_by_conversation(conversation_id, include_compacted=True)
    last_user = next((e for e in reversed(events) if e.kind == EventKind.USER), None)
    if last_user is None:
        raise ValueError(f"Conversation {conversation_id!r} has no user message to regenerate from")
    return await branch_from_event(
        source_conversation_id=conversation_id,
        from_event_id=last_user.id,
        new_title=None,
        conversation_repo=conversation_repo,
        event_repo=event_repo,
    )
