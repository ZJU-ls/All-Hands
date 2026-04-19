"""Inbound webhook → ChatService bridge (spec § 8).

Lives in the services layer because it orchestrates two services
(``ChannelService`` + ``ChatService``). The factory returns a callable the
ChannelService treats as an opaque hook, so layer isolation in ``execution``
is preserved.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from allhands.core.conversation import Conversation

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from allhands.core.channel import Channel, InboundMessage
    from allhands.persistence.channel_repos import ChannelMessageRepo
    from allhands.persistence.repositories import ConversationRepo, EmployeeRepo
    from allhands.services.chat_service import ChatService

    InboundHandler = Callable[[InboundMessage, Channel], Awaitable[str | None]]

logger = logging.getLogger(__name__)


async def _find_or_create_conversation(
    inbound: InboundMessage,
    channel: Channel,
    *,
    conversations: ConversationRepo,
    employees: EmployeeRepo,
    messages_repo: ChannelMessageRepo,
) -> str:
    """Return the conversation id bound to ``(channel, external_user_ref)``.

    v0 uses the lead-agent default employee (or any employee if no lead
    exists yet). The first inbound message for a given ``(channel_id,
    external_user_ref)`` pair creates a new conversation; subsequent
    messages reuse it by scanning prior ``channel_messages`` rows.
    """
    existing = await messages_repo.find_conversation_for_inbound(
        channel.id, inbound.external_user_ref
    )
    if existing is not None:
        return existing
    employee = await employees.get_lead()
    if employee is None:
        employees_all = await employees.list_all()
        if not employees_all:
            raise RuntimeError(
                "no employee available to own inbound conversations — create one first"
            )
        employee = employees_all[0]
    conv = Conversation(
        id=f"conv_{uuid.uuid4().hex[:16]}",
        employee_id=employee.id,
        title=f"{channel.kind.value} · {inbound.external_user_ref}",
        created_at=datetime.now(UTC),
        metadata={
            "source": "channel.inbound",
            "channel_id": channel.id,
            "external_user_ref": inbound.external_user_ref,
        },
    )
    await conversations.create(conv)
    return conv.id


def build_inbound_handler(
    *,
    chat_service: ChatService,
    conversations: ConversationRepo,
    employees: EmployeeRepo,
    messages_repo: ChannelMessageRepo,
) -> InboundHandler:
    """Factory; returns a handler that routes inbound text through ChatService."""

    async def _handler(inbound: InboundMessage, channel: Channel) -> str | None:
        try:
            conv_id = await _find_or_create_conversation(
                inbound,
                channel,
                conversations=conversations,
                employees=employees,
                messages_repo=messages_repo,
            )
        except RuntimeError:
            logger.exception("channels.inbound.no_employee", extra={"channel_id": channel.id})
            return None
        stream = await chat_service.send_message(conv_id, inbound.text)

        async def _drain() -> None:
            try:
                async for _ in stream:
                    pass
            except Exception:  # pragma: no cover — log and move on
                logger.exception(
                    "channels.inbound.stream_failed",
                    extra={"conversation_id": conv_id, "channel_id": channel.id},
                )

        asyncio.create_task(_drain())  # noqa: RUF006 — fire-and-forget is intentional
        return conv_id

    return _handler


__all__ = ["build_inbound_handler"]
