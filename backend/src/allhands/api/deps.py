"""FastAPI dependency providers."""

from __future__ import annotations

import asyncio
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 — runtime-needed for FastAPI Depends resolution
)

from allhands.config import get_settings
from allhands.execution.gate import BaseGate, PersistentConfirmationGate
from allhands.execution.mcp.adapter import RealMCPAdapter
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry, seed_skills
from allhands.execution.tools import discover_builtin_tools
from allhands.persistence.db import get_sessionmaker
from allhands.persistence.sql_repos import (
    SqlArtifactRepo,
    SqlConfirmationRepo,
    SqlConversationRepo,
    SqlEmployeeRepo,
    SqlEventRepo,
    SqlLLMModelRepo,
    SqlLLMProviderRepo,
    SqlMCPServerRepo,
    SqlObservabilityConfigRepo,
    SqlSkillRepo,
    SqlTaskRepo,
    SqlTriggerFireRepo,
    SqlTriggerRepo,
)
from allhands.services.artifact_service import ArtifactService
from allhands.services.chat_service import ChatService
from allhands.services.cockpit_service import CockpitService
from allhands.services.confirmation_service import ConfirmationService
from allhands.services.employee_service import EmployeeService
from allhands.services.github_market import AnthropicsSkillsMarket, GithubSkillMarket
from allhands.services.mcp_service import MCPService
from allhands.services.pause_state import PauseSwitch
from allhands.services.skill_service import SkillService
from allhands.services.trigger_service import TriggerService

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from allhands.services.model_service import LLMModelService
    from allhands.services.observatory_service import ObservatoryService
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


@lru_cache(maxsize=1)
def get_skill_market() -> GithubSkillMarket:
    settings = get_settings()
    return AnthropicsSkillsMarket(
        owner=settings.skill_market_owner,
        repo=settings.skill_market_repo,
        branch=settings.skill_market_branch,
        path_prefix=settings.skill_market_path_prefix,
        cache_ttl_seconds=settings.skill_market_cache_ttl_seconds,
        token=settings.github_token,
    )


async def get_skill_service(session: AsyncSession = Depends(get_session)) -> SkillService:
    settings = get_settings()
    data_dir = Path(settings.data_dir)
    return SkillService(
        repo=SqlSkillRepo(session),
        install_root=data_dir / "skills",
        market=get_skill_market(),
    )


@lru_cache(maxsize=1)
def _get_mcp_adapter() -> RealMCPAdapter:
    return RealMCPAdapter()


async def get_mcp_service(session: AsyncSession = Depends(get_session)) -> MCPService:
    return MCPService(repo=SqlMCPServerRepo(session), adapter=_get_mcp_adapter())


async def get_artifact_service(
    session: AsyncSession = Depends(get_session),
) -> ArtifactService:
    settings = get_settings()
    data_dir = Path(settings.data_dir)
    return ArtifactService(SqlArtifactRepo(session), data_dir)


async def get_trigger_service(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TriggerService:
    runtime = getattr(request.app.state, "trigger_runtime", None)
    handlers = runtime.handlers if runtime is not None else None
    return TriggerService(
        trigger_repo=SqlTriggerRepo(session),
        fire_repo=SqlTriggerFireRepo(session),
        action_handlers=handlers,
    )


@lru_cache(maxsize=1)
def get_pause_switch() -> PauseSwitch:
    return PauseSwitch()


async def get_observatory_service(
    session: AsyncSession = Depends(get_session),
) -> ObservatoryService:
    from allhands.services.observatory_service import ObservatoryService

    return ObservatoryService(
        event_repo=SqlEventRepo(session),
        employee_repo=SqlEmployeeRepo(session),
        config_repo=SqlObservabilityConfigRepo(session),
    )


async def get_cockpit_service(
    session: AsyncSession = Depends(get_session),
    pause_switch: PauseSwitch = Depends(get_pause_switch),
) -> CockpitService:
    return CockpitService(
        event_repo=SqlEventRepo(session),
        confirmation_repo=SqlConfirmationRepo(session),
        employee_repo=SqlEmployeeRepo(session),
        conversation_repo=SqlConversationRepo(session),
        trigger_repo=SqlTriggerRepo(session),
        artifact_repo=SqlArtifactRepo(session),
        task_repo=SqlTaskRepo(session),
        pause_state_provider=pause_switch.snapshot,
    )
