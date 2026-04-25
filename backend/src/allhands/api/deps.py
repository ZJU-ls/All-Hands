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
from allhands.execution.gate import (
    BaseGate,
    PersistentConfirmationGate,
)
from allhands.execution.mcp.adapter import RealMCPAdapter
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry, seed_skills
from allhands.execution.tools import discover_builtin_tools
from allhands.execution.user_input_deferred import UserInputDeferred
from allhands.persistence.db import get_sessionmaker
from allhands.persistence.sql_repos import (
    SqlAgentPlanRepo,
    SqlArtifactRepo,
    SqlConfirmationRepo,
    SqlConversationEventRepo,
    SqlConversationRepo,
    SqlEmployeeRepo,
    SqlEventRepo,
    SqlLLMModelRepo,
    SqlLLMProviderRepo,
    SqlMCPServerRepo,
    SqlObservabilityConfigRepo,
    SqlSkillRepo,
    SqlSkillRuntimeRepo,
    SqlTaskRepo,
    SqlTriggerFireRepo,
    SqlTriggerRepo,
    SqlUserInputRepo,
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
    # E21: pass the sessionmaker so READ meta tools (list_* / get_*) get
    # real executors that read the DB. Without it they'd fall back to the
    # no-op stub and return {} — which is exactly the "Lead 查不到已配置
    # 的东西" bug the user reported.
    #
    # extra_executors: wire Lead-Agent-driven skill management (install /
    # update / delete / market browse). These factories live in ``api/``
    # because they close over SkillService; the execution layer is
    # forbidden from importing services/ by the import-linter contract.
    from allhands.api.skill_executors import build_skill_management_executors

    maker = get_sessionmaker()
    reg = ToolRegistry()
    discover_builtin_tools(
        reg,
        session_maker=maker,
        extra_executors=build_skill_management_executors(maker),
    )
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


async def get_conversation_event_repo(session: AsyncSession) -> SqlConversationEventRepo:
    return SqlConversationEventRepo(session)


async def get_confirmation_service(session: AsyncSession) -> ConfirmationService:
    return ConfirmationService(SqlConfirmationRepo(session))


async def get_gate(session: AsyncSession) -> BaseGate:
    """Return the polling confirmation gate (ADR 0018).

    The InterruptConfirmationGate (LangGraph-based) was removed —
    suspension flows through DeferredSignal in the tool pipeline, which
    polls ConfirmationRepo. This factory now has a single implementation.
    """
    queue = get_confirmation_queue()
    return PersistentConfirmationGate(
        confirmation_repo=SqlConfirmationRepo(session),
        event_queue=queue,
    )


async def get_chat_service(
    session: AsyncSession,
    request: Request | None = None,
) -> ChatService:
    # Pull the EventBus off the trigger runtime so chat turns surface in the
    # cockpit activity feed. When there's no Request (CLI / tests), skip — the
    # service still works, just without the cockpit beat.
    bus = None
    checkpointer = None
    if request is not None:
        runtime = getattr(request.app.state, "trigger_runtime", None)
        bus = getattr(runtime, "bus", None) if runtime is not None else None
        # ADR 0014 · process-singleton checkpointer lives on app.state. None
        # when startup failed — runner falls back to v0 pure-function path.
        checkpointer = getattr(request.app.state, "checkpointer", None)

    # ADR 0018: single polling gate · suspend lives in DeferredSignal,
    # not LangGraph interrupt().
    gate = await get_gate(session)

    # ADR 0019 C3 · clarification (ask_user_question) signal — polled by
    # AgentLoop via tool_pipeline's Defer branch.
    user_input_signal = UserInputDeferred(SqlUserInputRepo(session))

    return ChatService(
        employee_repo=SqlEmployeeRepo(session),
        conversation_repo=SqlConversationRepo(session),
        tool_registry=get_tool_registry(),
        skill_registry=get_skill_registry(),
        gate=gate,
        provider_repo=SqlLLMProviderRepo(session),
        model_repo=SqlLLMModelRepo(session),
        bus=bus,
        skill_runtime_repo=SqlSkillRuntimeRepo(session),
        mcp_repo=SqlMCPServerRepo(session),
        checkpointer=checkpointer,
        confirmation_repo=SqlConfirmationRepo(session),
        # ADR 0017 · wire the event log so ChatService writes USER /
        # ASSISTANT / TURN_ABORTED events and build_llm_context reads
        # from it. Unset → fall back to pre-ADR-0017 MessageRepo path.
        event_repo=SqlConversationEventRepo(session),
        # ADR 0019 C1 · per-conversation plan persistence so plan_create
        # / plan_view / plan_update_step actually save & render.
        plan_repo=SqlAgentPlanRepo(session),
        user_input_signal=user_input_signal,
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
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> ArtifactService:
    settings = get_settings()
    data_dir = Path(settings.data_dir)
    runtime = getattr(request.app.state, "trigger_runtime", None)
    bus = getattr(runtime, "bus", None) if runtime is not None else None
    return ArtifactService(SqlArtifactRepo(session), data_dir, bus=bus)


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
        conversation_repo=SqlConversationRepo(session),
        task_repo=SqlTaskRepo(session),
    )


async def get_cockpit_service(
    session: AsyncSession = Depends(get_session),
    pause_switch: PauseSwitch = Depends(get_pause_switch),
) -> CockpitService:
    # token_stats_provider is intentionally not wired here — usage metrics
    # require a schema change (MessageRow.usage_json or a dedicated run_stats
    # table) plus runner instrumentation to capture LLM response metadata,
    # neither of which exist yet. Until that lands, the cockpit KPI for
    # tokens/cost renders 0; all other panels work off real data.
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
