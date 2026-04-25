"""Conversation lifecycle meta tools (L01 · Tool First).

The history panel exposes ``DELETE /api/conversations/{id}``. This file
mirrors that surface as a Meta Tool so the Lead Agent can do the same via
chat (e.g. "clean up the scratch threads from yesterday"). Read surfaces
ride the general REST path; only the destructive write needs a tool.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from allhands.core import Tool, ToolKind, ToolScope
from allhands.persistence.sql_repos import SqlConversationRepo

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    ToolExecutor = Callable[..., Awaitable[Any]]


DELETE_CONVERSATION_TOOL = Tool(
    id="allhands.meta.delete_conversation",
    kind=ToolKind.META,
    name="delete_conversation",
    description=(
        "Permanently remove a conversation and everything under it — messages, "
        "tool-call rows, event log, skill runtime state. Artifacts produced "
        "during the conversation are preserved (they're workspace-scoped).\n\n"
        "**Use when** the user explicitly asks to delete a chat ('remove that "
        "thread', 'delete the test conversation'). **Do NOT use** to clear "
        "temporary context — use the /compact surface for that, it keeps the "
        "conversation shell intact.\n\n"
        "Params: conversation_id."
    ),
    input_schema={
        "type": "object",
        "properties": {"conversation_id": {"type": "string", "minLength": 1}},
        "required": ["conversation_id"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "conversation_id": {"type": "string"},
            "deleted": {"type": "boolean"},
        },
    },
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)


ALL_CONVERSATION_META_TOOLS: tuple[Tool, ...] = (DELETE_CONVERSATION_TOOL,)


def make_delete_conversation_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(conversation_id: str, **_: Any) -> dict[str, Any]:
        session = maker()
        try:
            await session.begin()
            deleted = await SqlConversationRepo(session).delete(conversation_id)
            if deleted:
                await session.commit()
            else:
                await session.rollback()
        finally:
            await session.close()
        if not deleted:
            return {
                "conversation_id": conversation_id,
                "deleted": False,
                "error": f"conversation {conversation_id!r} not found",
            }
        return {"conversation_id": conversation_id, "deleted": True}

    return _exec
