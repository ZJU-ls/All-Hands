"""FastAPI dependency providers."""

from __future__ import annotations

import asyncio
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import Depends
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 — runtime-needed for FastAPI Depends resolution
)

from allhands.config import get_settings
from allhands.execution.gate import BaseGate, PersistentConfirmationGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry, seed_skills
from allhands.execution.tools import discover_builtin_tools
from allhands.persistence.db import get_sessionmaker
from allhands.persistence.sql_repos import (
    SqlConfirmationRepo,
    SqlConversationRepo,
    SqlEmployeeRepo,
    SqlLLMModelRepo,
    SqlLLMProviderRepo,
    SqlSkillRepo,
)
from allhands.services.chat_service import ChatService
from allhands.services.confirmation_service import ConfirmationService
from allhands.services.employee_service import EmployeeService
from allhands.services.skill_service import SkillService

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from allhands.services.model_service import LLMModelService
    from allhands.services.provider_service import LLMProviderService


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
        provider_repo=SqlLLMProviderRepo(session),
    )


async def get_provider_service(session: AsyncSession) -> LLMProviderService:
    from allhands.services.provider_service import LLMProviderService

    return LLMProviderService(SqlLLMProviderRepo(session))


async def get_model_service(session: AsyncSession) -> LLMModelService:
    from allhands.services.model_service import LLMModelService

    return LLMModelService(SqlLLMModelRepo(session), SqlLLMProviderRepo(session))


async def get_skill_service(session: AsyncSession = Depends(get_session)) -> SkillService:
    settings = get_settings()
    data_dir = Path(settings.data_dir)
    return SkillService(
        repo=SqlSkillRepo(session),
        install_root=data_dir / "skills",
        market_file=data_dir / "skills-market.json",
    )
