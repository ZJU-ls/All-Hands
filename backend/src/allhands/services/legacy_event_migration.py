"""ADR 0017 · one-time migration from MessageRepo-only conversations to
the conversation_events log.

Any conversation created before ADR 0017 landed has messages rows but
no events rows. On startup we scan for those and replay their Message
entries as USER / ASSISTANT / TOOL events so ``build_llm_context`` has
something to project. Message.id becomes the event id so projection
cache and event log stay aligned.

Idempotent: re-running is a no-op — we skip any conversation that
already has at least one event row.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from allhands.core import (
    ConversationEvent,
    EventKind,
)

if TYPE_CHECKING:
    from allhands.persistence.repositories import (
        ConversationEventRepo,
        ConversationRepo,
    )

log = logging.getLogger(__name__)


_ROLE_TO_KIND: dict[str, EventKind] = {
    "user": EventKind.USER,
    "assistant": EventKind.ASSISTANT,
    # Legacy summary-compact rows were stored as role="system" in
    # MessageRepo; replay them as SUMMARY so context_builder wraps them
    # correctly.
    "system": EventKind.SUMMARY,
}


async def replay_messages_into_events(
    *,
    conversation_repo: ConversationRepo,
    event_repo: ConversationEventRepo,
    conversation_id: str,
) -> int:
    """Replay all messages for a single conversation into the event log.

    Returns the number of events appended. If the conversation already has
    any events, return 0 (idempotent no-op).
    """
    existing = await event_repo.list_by_conversation(conversation_id)
    if existing:
        return 0

    msgs = await conversation_repo.list_messages(conversation_id)
    count = 0
    for msg in msgs:
        role = msg.role
        kind = _ROLE_TO_KIND.get(role)
        if kind is None:
            # Unknown role — skip; conservative choice: legacy rows we
            # can't interpret don't pollute the event log.
            continue
        content_json: dict[str, object] = {"content": msg.content}
        if kind == EventKind.ASSISTANT:
            if msg.tool_calls:
                content_json["tool_calls"] = [tc.model_dump() for tc in msg.tool_calls]
            if msg.render_payloads:
                content_json["render_payloads"] = [rp.model_dump() for rp in msg.render_payloads]
            if msg.reasoning:
                content_json["reasoning"] = msg.reasoning
        if kind == EventKind.SUMMARY:
            # The legacy summary shape stored the compressed prose in
            # content; adopt it so context_builder can wrap it.
            content_json = {"summary_text": msg.content}

        await event_repo.append(
            ConversationEvent(
                id=msg.id,
                conversation_id=conversation_id,
                parent_id=None,
                sequence=await event_repo.next_sequence(conversation_id),
                kind=kind,
                content_json=content_json,
                subagent_id=None,
                turn_id=None,
                idempotency_key=None,
                is_compacted=False,
                created_at=msg.created_at,
            )
        )
        count += 1
    return count


async def replay_all_legacy_conversations(
    *,
    conversation_repo: ConversationRepo,
    event_repo: ConversationEventRepo,
) -> tuple[int, int]:
    """Walk every conversation and replay if needed. Returns
    ``(conversations_migrated, events_written)``. Run on lifespan startup.

    Exceptions inside a single conversation's replay are logged and
    skipped so one bad row doesn't block boot.
    """
    convos = await conversation_repo.list_all()
    conv_count = 0
    event_count = 0
    cutoff = datetime.now(UTC)
    for conv in convos:
        try:
            written = await replay_messages_into_events(
                conversation_repo=conversation_repo,
                event_repo=event_repo,
                conversation_id=conv.id,
            )
            if written > 0:
                conv_count += 1
                event_count += written
        except Exception:
            log.exception(
                "legacy_migration.replay.failed",
                extra={"conversation_id": conv.id, "cutoff": cutoff.isoformat()},
            )
    return conv_count, event_count
