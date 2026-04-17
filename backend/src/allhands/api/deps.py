"""FastAPI dependency providers."""

from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import TYPE_CHECKING

from allhands.execution.gate import BaseGate, PersistentConfirmationGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry, seed_skills
from allhands.execution.tools import discover_builtin_tools
from allhands.persistence.db import get_sessionmaker
from allhands.persistence.sql_repos import (
    SqlConfirmationRepo,
    SqlConversationRepo,
    SqlEmployeeRepo,
)
from allhands.services.chat_service import ChatService
from allhands.services.confirmation_service import ConfirmationService
from allhands.services.employee_service import EmployeeService

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncSession


@lru_cache(maxsize=1)
def get_tool_registry() -> ToolRegistry:
    reg = ToolRegistry()
    discover_builtin_tools(reg)
    return reg


@lru_cache(maxsize=1)
def get_skill_registry() -> SkillRegistry:
    reg = SkillRegistry()
    seed_skills(reg)
    return reg


_confirmation_queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()


def get_confirmation_queue() -> asyncio.Queue[dict[str, object]]:
    return _confirmation_queue


async def get_session() -> AsyncIterator[AsyncSession]:
    maker = get_sessionmaker()
    async with maker() as session, session.begin():
        yield session


async def get_employee_service(session: AsyncSession) -> EmployeeService:
    return EmployeeService(SqlEmployeeRepo(session))


async def get_conversation_repo(session: AsyncSession) -> SqlConversationRepo:
    return SqlConversationRepo(session)


async def get_confirmation_service(session: AsyncSession) -> ConfirmationService:
    return ConfirmationService(SqlConfirmationRepo(session))


async def get_gate(session: AsyncSession) -> BaseGate:
    queue = get_confirmation_queue()
    return PersistentConfirmationGate(
        confirmation_repo=SqlConfirmationRepo(session),
        event_queue=queue,
    )


async def get_chat_service(session: AsyncSession) -> ChatService:
    gate = await get_gate(session)
    return ChatService(
        employee_repo=SqlEmployeeRepo(session),
        conversation_repo=SqlConversationRepo(session),
        tool_registry=get_tool_registry(),
        skill_registry=get_skill_registry(),
        gate=gate,
    )
