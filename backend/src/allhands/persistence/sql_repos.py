"""Concrete SQLAlchemy repository implementations."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

from sqlalchemy import delete, func, or_, select, update

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

from allhands.core import (
    ACTIVE_STATUSES,
    AgentPlan,
    Artifact,
    ArtifactKind,
    ArtifactVersion,
    Confirmation,
    ConfirmationStatus,
    Conversation,
    ConversationEvent,
    Employee,
    EventEnvelope,
    EventKind,
    InteractionSpec,
    LLMModel,
    LLMProvider,
    MCPHealth,
    MCPServer,
    MCPTransport,
    Message,
    ObservabilityConfig,
    PlanStep,
    RenderPayload,
    Skill,
    SkillRuntime,
    SkillSource,
    StepStatus,
    Task,
    TaskSource,
    TaskStatus,
    ToolCall,
    ToolCallStatus,
    Trigger,
    TriggerAction,
    TriggerFire,
    TriggerFireSource,
    TriggerFireStatus,
    TriggerKind,
)
from allhands.persistence.orm.models import (
    AgentPlanRow,
    ArtifactRow,
    ArtifactVersionRow,
    ConfirmationRow,
    ConversationEventRow,
    ConversationRow,
    EmployeeRow,
    EventRow,
    LLMModelRow,
    LLMProviderRow,
    MCPServerRow,
    MessageRow,
    ObservabilityConfigRow,
    SkillRow,
    SkillRuntimeRow,
    TaskRow,
    TriggerFireRow,
    TriggerRow,
)


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def _naive(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None)


def _row_to_employee(row: EmployeeRow) -> Employee:
    return Employee(
        id=row.id,
        name=row.name,
        description=row.description,
        system_prompt=row.system_prompt,
        model_ref=row.model_ref,
        tool_ids=list(row.tool_ids),
        skill_ids=list(row.skill_ids),
        max_iterations=row.max_iterations,
        is_lead_agent=row.is_lead_agent,
        status=row.status if row.status in ("draft", "published") else "published",  # type: ignore[arg-type]
        created_by=row.created_by,
        created_at=_utc(row.created_at),
        published_at=_utc(row.published_at) if row.published_at else None,
        metadata=dict(row.extra_metadata),
    )


def _employee_to_row(emp: Employee) -> EmployeeRow:
    return EmployeeRow(
        id=emp.id,
        name=emp.name,
        description=emp.description,
        system_prompt=emp.system_prompt,
        model_ref=emp.model_ref,
        tool_ids=list(emp.tool_ids),
        skill_ids=list(emp.skill_ids),
        max_iterations=emp.max_iterations,
        is_lead_agent=emp.is_lead_agent,
        status=emp.status,
        created_by=emp.created_by,
        created_at=_naive(emp.created_at),
        published_at=_naive(emp.published_at) if emp.published_at else None,
        extra_metadata=dict(emp.metadata),
    )


def _row_to_conversation(row: ConversationRow) -> Conversation:
    return Conversation(
        id=row.id,
        title=row.title,
        employee_id=row.employee_id,
        created_at=_utc(row.created_at),
        model_ref_override=row.model_ref_override,
        metadata=dict(row.extra_metadata),
    )


def _row_to_message(row: MessageRow) -> Message:
    tool_calls = [
        ToolCall(
            id=cast("str", tc["id"]),
            tool_id=cast("str", tc["tool_id"]),
            args=cast("dict[str, object]", tc.get("args", {})),
            status=ToolCallStatus(cast("str", tc["status"])),
            result=tc.get("result"),
            error=cast("str | None", tc.get("error")),
        )
        for tc in (row.tool_calls or [])
    ]
    render_payloads = [
        RenderPayload(
            component=cast("str", rp["component"]),
            props=cast("dict[str, object]", rp.get("props", {})),
            interactions=[
                InteractionSpec.model_validate(i)
                for i in cast("list[object]", rp.get("interactions", []))
            ],
        )
        for rp in (row.render_payloads or [])
    ]
    return Message(
        id=row.id,
        conversation_id=row.conversation_id,
        role=row.role,  # type: ignore[arg-type]
        content=row.content,
        tool_calls=tool_calls,
        tool_call_id=row.tool_call_id,
        render_payloads=render_payloads,
        trace_ref=row.trace_ref,
        parent_run_id=row.parent_run_id,
        reasoning=row.reasoning,
        interrupted=row.interrupted,
        created_at=_utc(row.created_at),
    )


def _row_to_confirmation(row: ConfirmationRow) -> Confirmation:
    return Confirmation(
        id=row.id,
        tool_call_id=row.tool_call_id,
        rationale=row.rationale,
        summary=row.summary,
        diff=row.diff,
        status=ConfirmationStatus(row.status),
        created_at=_utc(row.created_at),
        resolved_at=_utc(row.resolved_at) if row.resolved_at else None,
        expires_at=_utc(row.expires_at),
    )


def _row_to_skill(row: SkillRow) -> Skill:
    return Skill(
        id=row.id,
        name=row.name,
        description=row.description,
        tool_ids=list(row.tool_ids),
        prompt_fragment=row.prompt_fragment or None,
        version=row.version,
        source=SkillSource(row.source),
        source_url=row.source_url,
        installed_at=_utc(row.installed_at) if row.installed_at else None,
        path=row.path,
    )


def _row_to_mcp_server(row: MCPServerRow) -> MCPServer:
    return MCPServer(
        id=row.id,
        name=row.name,
        transport=MCPTransport(row.transport),
        config=dict(row.config),
        enabled=row.enabled,
        exposed_tool_ids=list(row.exposed_tool_ids),
        last_handshake_at=_utc(row.last_handshake_at) if row.last_handshake_at else None,
        health=MCPHealth(row.health),
    )


class SqlEmployeeRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, employee_id: str) -> Employee | None:
        row = await self._s.get(EmployeeRow, employee_id)
        return _row_to_employee(row) if row else None

    async def get_by_name(self, name: str) -> Employee | None:
        result = await self._s.execute(select(EmployeeRow).where(EmployeeRow.name == name))
        row = result.scalar_one_or_none()
        return _row_to_employee(row) if row else None

    async def get_lead(self) -> Employee | None:
        result = await self._s.execute(
            select(EmployeeRow).where(EmployeeRow.is_lead_agent.is_(True))
        )
        row = result.scalar_one_or_none()
        return _row_to_employee(row) if row else None

    async def list_all(self, *, status: str | None = None) -> list[Employee]:
        stmt = select(EmployeeRow)
        if status is not None:
            stmt = stmt.where(EmployeeRow.status == status)
        result = await self._s.execute(stmt)
        return [_row_to_employee(r) for r in result.scalars().all()]

    async def upsert(self, employee: Employee) -> Employee:
        existing = await self._s.get(EmployeeRow, employee.id)
        if existing:
            existing.name = employee.name
            existing.description = employee.description
            existing.system_prompt = employee.system_prompt
            existing.model_ref = employee.model_ref
            existing.tool_ids = list(employee.tool_ids)
            existing.skill_ids = list(employee.skill_ids)
            existing.max_iterations = employee.max_iterations
            existing.is_lead_agent = employee.is_lead_agent
            existing.status = employee.status
            existing.published_at = _naive(employee.published_at) if employee.published_at else None
            existing.extra_metadata = dict(employee.metadata)
        else:
            self._s.add(_employee_to_row(employee))
        await self._s.flush()
        return employee

    async def delete(self, employee_id: str) -> None:
        row = await self._s.get(EmployeeRow, employee_id)
        if row:
            await self._s.delete(row)
            await self._s.flush()


class SqlConversationRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, conversation_id: str) -> Conversation | None:
        row = await self._s.get(ConversationRow, conversation_id)
        return _row_to_conversation(row) if row else None

    async def create(self, conversation: Conversation) -> Conversation:
        row = ConversationRow(
            id=conversation.id,
            title=conversation.title,
            employee_id=conversation.employee_id,
            created_at=_naive(conversation.created_at),
            model_ref_override=conversation.model_ref_override,
            extra_metadata=dict(conversation.metadata),
        )
        self._s.add(row)
        await self._s.flush()
        return conversation

    async def update(self, conversation: Conversation) -> Conversation:
        row = await self._s.get(ConversationRow, conversation.id)
        if row is None:
            raise KeyError(f"Conversation {conversation.id!r} not found.")
        row.title = conversation.title
        row.model_ref_override = conversation.model_ref_override
        row.extra_metadata = dict(conversation.metadata)
        await self._s.flush()
        return conversation

    async def list_for_employee(self, employee_id: str) -> list[Conversation]:
        result = await self._s.execute(
            select(ConversationRow)
            .where(ConversationRow.employee_id == employee_id)
            .order_by(ConversationRow.created_at.desc())
        )
        return [_row_to_conversation(r) for r in result.scalars().all()]

    async def list_all(self) -> list[Conversation]:
        result = await self._s.execute(
            select(ConversationRow).order_by(ConversationRow.created_at.desc())
        )
        return [_row_to_conversation(r) for r in result.scalars().all()]

    async def list_messages(self, conversation_id: str) -> list[Message]:
        result = await self._s.execute(
            select(MessageRow)
            .where(MessageRow.conversation_id == conversation_id)
            .order_by(MessageRow.created_at)
        )
        return [_row_to_message(r) for r in result.scalars().all()]

    async def list_messages_by_run_id(self, run_id: str) -> list[Message]:
        result = await self._s.execute(
            select(MessageRow)
            .where(MessageRow.parent_run_id == run_id)
            .order_by(MessageRow.created_at)
        )
        return [_row_to_message(r) for r in result.scalars().all()]

    async def append_message(self, message: Message) -> Message:
        row = MessageRow(
            id=message.id,
            conversation_id=message.conversation_id,
            role=message.role,
            content=message.content,
            tool_calls=[tc.model_dump(mode="json") for tc in message.tool_calls],
            tool_call_id=message.tool_call_id,
            render_payloads=[rp.model_dump(mode="json") for rp in message.render_payloads],
            trace_ref=message.trace_ref,
            parent_run_id=message.parent_run_id,
            reasoning=message.reasoning,
            interrupted=message.interrupted,
            created_at=_naive(message.created_at),
        )
        self._s.add(row)
        await self._s.flush()
        return message

    async def delete_messages(self, message_ids: list[str]) -> int:
        if not message_ids:
            return 0
        await self._s.execute(delete(MessageRow).where(MessageRow.id.in_(message_ids)))
        await self._s.flush()
        return len(message_ids)

    async def delete(self, conversation_id: str) -> bool:
        """Cascade-aware conversation delete.

        Messages + tool_calls go through ``cascade="all, delete-orphan"``,
        agent_plans through ``ondelete=CASCADE``. The standalone tables that
        reference ``conversation_id`` without a FK — ``conversation_events``
        (ADR 0017) and ``skill_runtimes`` — are wiped explicitly. Artifacts
        and tasks intentionally keep their conversation_id.
        """
        row = await self._s.get(ConversationRow, conversation_id)
        if row is None:
            return False
        await self._s.delete(row)
        await self._s.execute(
            delete(ConversationEventRow).where(
                ConversationEventRow.conversation_id == conversation_id
            )
        )
        await self._s.execute(
            delete(SkillRuntimeRow).where(SkillRuntimeRow.conversation_id == conversation_id)
        )
        await self._s.flush()
        return True

    async def count_messages(self, conversation_ids: list[str]) -> dict[str, int]:
        if not conversation_ids:
            return {}
        stmt = (
            select(MessageRow.conversation_id, func.count(MessageRow.id))
            .where(MessageRow.conversation_id.in_(conversation_ids))
            .group_by(MessageRow.conversation_id)
        )
        rows = await self._s.execute(stmt)
        counts: dict[str, int] = dict.fromkeys(conversation_ids, 0)
        for conv_id, n in rows.all():
            counts[conv_id] = int(n)
        return counts


class SqlConfirmationRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, confirmation_id: str) -> Confirmation | None:
        row = await self._s.get(ConfirmationRow, confirmation_id)
        return _row_to_confirmation(row) if row else None

    async def get_by_tool_call(self, tool_call_id: str) -> Confirmation | None:
        result = await self._s.execute(
            select(ConfirmationRow).where(ConfirmationRow.tool_call_id == tool_call_id)
        )
        row = result.scalar_one_or_none()
        return _row_to_confirmation(row) if row else None

    async def list_pending(self) -> list[Confirmation]:
        result = await self._s.execute(
            select(ConfirmationRow).where(
                ConfirmationRow.status == ConfirmationStatus.PENDING.value
            )
        )
        return [_row_to_confirmation(r) for r in result.scalars().all()]

    async def save(self, confirmation: Confirmation) -> None:
        row = ConfirmationRow(
            id=confirmation.id,
            tool_call_id=confirmation.tool_call_id,
            rationale=confirmation.rationale,
            summary=confirmation.summary,
            diff=confirmation.diff,
            status=confirmation.status.value,
            created_at=_naive(confirmation.created_at),
            resolved_at=_naive(confirmation.resolved_at) if confirmation.resolved_at else None,
            expires_at=_naive(confirmation.expires_at),
        )
        self._s.add(row)
        await self._s.flush()

    async def update_status(self, confirmation_id: str, status: ConfirmationStatus) -> None:
        row = await self._s.get(ConfirmationRow, confirmation_id)
        if row:
            row.status = status.value
            if status in (ConfirmationStatus.APPROVED, ConfirmationStatus.REJECTED):
                row.resolved_at = _naive(datetime.now(UTC))
            await self._s.flush()


class SqlSkillRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, skill_id: str) -> Skill | None:
        row = await self._s.get(SkillRow, skill_id)
        return _row_to_skill(row) if row else None

    async def list_all(self) -> list[Skill]:
        result = await self._s.execute(select(SkillRow))
        return [_row_to_skill(r) for r in result.scalars().all()]

    async def upsert(self, skill: Skill) -> None:
        existing = await self._s.get(SkillRow, skill.id)
        installed_at_naive = _naive(skill.installed_at) if skill.installed_at else None
        if existing:
            existing.name = skill.name
            existing.description = skill.description
            existing.tool_ids = list(skill.tool_ids)
            existing.prompt_fragment = skill.prompt_fragment or ""
            existing.version = skill.version
            existing.source = skill.source.value
            existing.source_url = skill.source_url
            existing.installed_at = installed_at_naive
            existing.path = skill.path
        else:
            self._s.add(
                SkillRow(
                    id=skill.id,
                    name=skill.name,
                    description=skill.description,
                    tool_ids=list(skill.tool_ids),
                    prompt_fragment=skill.prompt_fragment or "",
                    version=skill.version,
                    source=skill.source.value,
                    source_url=skill.source_url,
                    installed_at=installed_at_naive,
                    path=skill.path,
                )
            )
        await self._s.flush()

    async def delete(self, skill_id: str) -> None:
        row = await self._s.get(SkillRow, skill_id)
        if row:
            await self._s.delete(row)
            await self._s.flush()


class SqlMCPServerRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, server_id: str) -> MCPServer | None:
        row = await self._s.get(MCPServerRow, server_id)
        return _row_to_mcp_server(row) if row else None

    async def list_all(self) -> list[MCPServer]:
        result = await self._s.execute(select(MCPServerRow))
        return [_row_to_mcp_server(r) for r in result.scalars().all()]

    async def upsert(self, server: MCPServer) -> None:
        existing = await self._s.get(MCPServerRow, server.id)
        if existing:
            existing.name = server.name
            existing.transport = server.transport.value
            existing.config = dict(server.config)
            existing.enabled = server.enabled
            existing.exposed_tool_ids = list(server.exposed_tool_ids)
            existing.last_handshake_at = (
                _naive(server.last_handshake_at) if server.last_handshake_at else None
            )
            existing.health = server.health.value
        else:
            self._s.add(
                MCPServerRow(
                    id=server.id,
                    name=server.name,
                    transport=server.transport.value,
                    config=dict(server.config),
                    enabled=server.enabled,
                    exposed_tool_ids=list(server.exposed_tool_ids),
                    last_handshake_at=(
                        _naive(server.last_handshake_at) if server.last_handshake_at else None
                    ),
                    health=server.health.value,
                )
            )
        await self._s.flush()

    async def delete(self, server_id: str) -> None:
        row = await self._s.get(MCPServerRow, server_id)
        if row:
            await self._s.delete(row)
            await self._s.flush()


def _row_to_plan(row: AgentPlanRow) -> AgentPlan:
    steps = [
        PlanStep(
            index=cast("int", s.get("index", 0)),
            title=cast("str", s.get("title", "")),
            status=StepStatus(cast("str", s.get("status", "pending"))),
            note=cast("str | None", s.get("note")),
        )
        for s in (row.steps or [])
    ]
    return AgentPlan(
        id=row.id,
        conversation_id=row.conversation_id,
        run_id=row.run_id,
        owner_employee_id=row.owner_employee_id,
        title=row.title,
        steps=steps,
        created_at=_utc(row.created_at),
        updated_at=_utc(row.updated_at),
    )


class SqlAgentPlanRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, plan_id: str) -> AgentPlan | None:
        row = await self._s.get(AgentPlanRow, plan_id)
        return _row_to_plan(row) if row else None

    async def get_latest_for_conversation(self, conversation_id: str) -> AgentPlan | None:
        result = await self._s.execute(
            select(AgentPlanRow)
            .where(AgentPlanRow.conversation_id == conversation_id)
            .order_by(AgentPlanRow.updated_at.desc())
        )
        row = result.scalars().first()
        return _row_to_plan(row) if row else None

    async def list_for_conversation(self, conversation_id: str) -> list[AgentPlan]:
        result = await self._s.execute(
            select(AgentPlanRow)
            .where(AgentPlanRow.conversation_id == conversation_id)
            .order_by(AgentPlanRow.created_at.desc())
        )
        return [_row_to_plan(r) for r in result.scalars().all()]

    async def upsert(self, plan: AgentPlan) -> AgentPlan:
        existing = await self._s.get(AgentPlanRow, plan.id)
        step_rows = [s.model_dump(mode="json") for s in plan.steps]
        if existing:
            existing.conversation_id = plan.conversation_id
            existing.run_id = plan.run_id
            existing.owner_employee_id = plan.owner_employee_id
            existing.title = plan.title
            existing.steps = step_rows
            existing.updated_at = _naive(plan.updated_at)
        else:
            self._s.add(
                AgentPlanRow(
                    id=plan.id,
                    conversation_id=plan.conversation_id,
                    run_id=plan.run_id,
                    owner_employee_id=plan.owner_employee_id,
                    title=plan.title,
                    steps=step_rows,
                    created_at=_naive(plan.created_at),
                    updated_at=_naive(plan.updated_at),
                )
            )
        await self._s.flush()
        return plan

    async def delete(self, plan_id: str) -> None:
        row = await self._s.get(AgentPlanRow, plan_id)
        if row:
            await self._s.delete(row)
            await self._s.flush()


def _row_to_provider(row: LLMProviderRow) -> LLMProvider:
    kind = row.kind if row.kind in ("openai", "anthropic", "aliyun") else "openai"
    return LLMProvider(
        id=row.id,
        name=row.name,
        kind=kind,  # type: ignore[arg-type]
        base_url=row.base_url,
        api_key=row.api_key,
        default_model=row.default_model,
        is_default=row.is_default,
        enabled=row.enabled,
    )


class SqlLLMProviderRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, provider_id: str) -> LLMProvider | None:
        row = await self._s.get(LLMProviderRow, provider_id)
        return _row_to_provider(row) if row else None

    async def get_default(self) -> LLMProvider | None:
        result = await self._s.execute(
            select(LLMProviderRow).where(
                LLMProviderRow.is_default.is_(True), LLMProviderRow.enabled.is_(True)
            )
        )
        row = result.scalar_one_or_none()
        return _row_to_provider(row) if row else None

    async def list_all(self) -> list[LLMProvider]:
        result = await self._s.execute(select(LLMProviderRow))
        return [_row_to_provider(r) for r in result.scalars().all()]

    async def upsert(self, provider: LLMProvider) -> LLMProvider:
        existing = await self._s.get(LLMProviderRow, provider.id)
        if existing:
            existing.name = provider.name
            existing.kind = provider.kind
            existing.base_url = provider.base_url
            existing.api_key = provider.api_key
            existing.default_model = provider.default_model
            existing.is_default = provider.is_default
            existing.enabled = provider.enabled
        else:
            self._s.add(
                LLMProviderRow(
                    id=provider.id,
                    name=provider.name,
                    kind=provider.kind,
                    base_url=provider.base_url,
                    api_key=provider.api_key,
                    default_model=provider.default_model,
                    is_default=provider.is_default,
                    enabled=provider.enabled,
                )
            )
        await self._s.flush()
        return provider

    async def delete(self, provider_id: str) -> None:
        row = await self._s.get(LLMProviderRow, provider_id)
        if row:
            await self._s.delete(row)
            await self._s.flush()

    async def set_default(self, provider_id: str) -> None:
        await self._s.execute(update(LLMProviderRow).values(is_default=False))
        row = await self._s.get(LLMProviderRow, provider_id)
        if row:
            row.is_default = True
        await self._s.flush()


def _row_to_model(row: LLMModelRow) -> LLMModel:
    return LLMModel(
        id=row.id,
        provider_id=row.provider_id,
        name=row.name,
        display_name=row.display_name,
        context_window=row.context_window,
        enabled=row.enabled,
    )


class SqlLLMModelRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, model_id: str) -> LLMModel | None:
        row = await self._s.get(LLMModelRow, model_id)
        return _row_to_model(row) if row else None

    async def list_all(self) -> list[LLMModel]:
        result = await self._s.execute(select(LLMModelRow))
        return [_row_to_model(r) for r in result.scalars().all()]

    async def list_for_provider(self, provider_id: str) -> list[LLMModel]:
        result = await self._s.execute(
            select(LLMModelRow).where(LLMModelRow.provider_id == provider_id)
        )
        return [_row_to_model(r) for r in result.scalars().all()]

    async def upsert(self, model: LLMModel) -> LLMModel:
        existing = await self._s.get(LLMModelRow, model.id)
        if existing:
            existing.provider_id = model.provider_id
            existing.name = model.name
            existing.display_name = model.display_name
            existing.context_window = model.context_window
            existing.enabled = model.enabled
        else:
            self._s.add(
                LLMModelRow(
                    id=model.id,
                    provider_id=model.provider_id,
                    name=model.name,
                    display_name=model.display_name,
                    context_window=model.context_window,
                    enabled=model.enabled,
                )
            )
        await self._s.flush()
        return model

    async def delete(self, model_id: str) -> None:
        row = await self._s.get(LLMModelRow, model_id)
        if row:
            await self._s.delete(row)
            await self._s.flush()


# ---- Trigger repos (Wave B.3) ----


def _trigger_to_row_kwargs(trigger: Trigger) -> dict[str, object]:
    return {
        "id": trigger.id,
        "name": trigger.name,
        "kind": trigger.kind.value,
        "enabled": trigger.enabled,
        "timer": trigger.timer.model_dump(mode="json") if trigger.timer else None,
        "event": trigger.event.model_dump(mode="json") if trigger.event else None,
        "action": trigger.action.model_dump(mode="json"),
        "min_interval_seconds": trigger.min_interval_seconds,
        "fires_total": trigger.fires_total,
        "fires_failed_streak": trigger.fires_failed_streak,
        "last_fired_at": _naive(trigger.last_fired_at) if trigger.last_fired_at else None,
        "auto_disabled_reason": trigger.auto_disabled_reason,
        "created_at": _naive(trigger.created_at),
        "created_by": trigger.created_by,
    }


def _row_to_trigger(row: TriggerRow) -> Trigger:
    from allhands.core import EventPattern, TimerSpec

    return Trigger(
        id=row.id,
        name=row.name,
        kind=TriggerKind(row.kind),
        enabled=row.enabled,
        timer=TimerSpec.model_validate(row.timer) if row.timer else None,
        event=EventPattern.model_validate(row.event) if row.event else None,
        action=TriggerAction.model_validate(row.action),
        min_interval_seconds=row.min_interval_seconds,
        fires_total=row.fires_total,
        fires_failed_streak=row.fires_failed_streak,
        last_fired_at=_utc(row.last_fired_at) if row.last_fired_at else None,
        auto_disabled_reason=row.auto_disabled_reason,
        created_at=_utc(row.created_at),
        created_by=row.created_by,
    )


class SqlTriggerRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, trigger_id: str) -> Trigger | None:
        row = await self._s.get(TriggerRow, trigger_id)
        return _row_to_trigger(row) if row else None

    async def list_all(self) -> list[Trigger]:
        result = await self._s.execute(select(TriggerRow).order_by(TriggerRow.created_at.desc()))
        return [_row_to_trigger(r) for r in result.scalars().all()]

    async def list_by_kind(self, kind: str, enabled_only: bool = False) -> list[Trigger]:
        stmt = select(TriggerRow).where(TriggerRow.kind == kind)
        if enabled_only:
            stmt = stmt.where(TriggerRow.enabled.is_(True))
        result = await self._s.execute(stmt)
        return [_row_to_trigger(r) for r in result.scalars().all()]

    async def upsert(self, trigger: Trigger) -> Trigger:
        existing = await self._s.get(TriggerRow, trigger.id)
        fields = _trigger_to_row_kwargs(trigger)
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
        else:
            self._s.add(TriggerRow(**fields))
        await self._s.flush()
        return trigger

    async def delete(self, trigger_id: str) -> None:
        row = await self._s.get(TriggerRow, trigger_id)
        if row:
            await self._s.delete(row)
            await self._s.flush()


def _row_to_trigger_fire(row: TriggerFireRow) -> TriggerFire:
    return TriggerFire(
        id=row.id,
        trigger_id=row.trigger_id,
        fired_at=_utc(row.fired_at),
        source=TriggerFireSource(row.source),
        event_payload=row.event_payload,
        action_snapshot=TriggerAction.model_validate(row.action_snapshot),
        rendered_task=row.rendered_task,
        run_id=row.run_id,
        status=TriggerFireStatus(row.status),
        error_code=row.error_code,
        error_detail=row.error_detail,
    )


class SqlTriggerFireRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, fire_id: str) -> TriggerFire | None:
        row = await self._s.get(TriggerFireRow, fire_id)
        return _row_to_trigger_fire(row) if row else None

    async def list_for_trigger(self, trigger_id: str, limit: int = 50) -> list[TriggerFire]:
        stmt = (
            select(TriggerFireRow)
            .where(TriggerFireRow.trigger_id == trigger_id)
            .order_by(TriggerFireRow.fired_at.desc())
            .limit(limit)
        )
        result = await self._s.execute(stmt)
        return [_row_to_trigger_fire(r) for r in result.scalars().all()]

    async def upsert(self, fire: TriggerFire) -> TriggerFire:
        existing = await self._s.get(TriggerFireRow, fire.id)
        fields: dict[str, object] = {
            "id": fire.id,
            "trigger_id": fire.trigger_id,
            "fired_at": _naive(fire.fired_at),
            "source": fire.source.value,
            "event_payload": fire.event_payload,
            "action_snapshot": fire.action_snapshot.model_dump(mode="json"),
            "rendered_task": fire.rendered_task,
            "run_id": fire.run_id,
            "status": fire.status.value,
            "error_code": fire.error_code,
            "error_detail": fire.error_detail,
        }
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
        else:
            self._s.add(TriggerFireRow(**fields))
        await self._s.flush()
        return fire

    async def count_in_window(self, seconds: int) -> int:
        from datetime import timedelta

        cutoff = _naive(datetime.now(UTC)) - timedelta(seconds=seconds)
        stmt = select(TriggerFireRow).where(TriggerFireRow.fired_at >= cutoff)
        result = await self._s.execute(stmt)
        return len(result.scalars().all())


def _row_to_artifact(row: ArtifactRow) -> Artifact:
    return Artifact(
        id=row.id,
        workspace_id=row.workspace_id,
        name=row.name,
        kind=ArtifactKind(row.kind),
        mime_type=row.mime_type,
        file_path=row.file_path,
        size_bytes=row.size_bytes,
        version=row.version,
        pinned=row.pinned,
        deleted_at=_utc(row.deleted_at) if row.deleted_at else None,
        created_by_run_id=row.created_by_run_id,
        created_by_employee_id=row.created_by_employee_id,
        conversation_id=row.conversation_id,
        created_at=_utc(row.created_at),
        updated_at=_utc(row.updated_at),
        extra_metadata=dict(row.extra_metadata or {}),
    )


def _row_to_artifact_version(row: ArtifactVersionRow) -> ArtifactVersion:
    return ArtifactVersion(
        id=row.id,
        artifact_id=row.artifact_id,
        version=row.version,
        file_path=row.file_path,
        diff_from_prev=row.diff_from_prev,
        created_at=_utc(row.created_at),
    )


class SqlArtifactRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, artifact_id: str) -> Artifact | None:
        row = await self._s.get(ArtifactRow, artifact_id)
        return _row_to_artifact(row) if row else None

    async def list_for_workspace(
        self,
        workspace_id: str,
        *,
        kind: str | None = None,
        name_prefix: str | None = None,
        pinned_only: bool = False,
        include_deleted: bool = False,
        limit: int = 100,
    ) -> list[Artifact]:
        stmt = select(ArtifactRow).where(ArtifactRow.workspace_id == workspace_id)
        if not include_deleted:
            stmt = stmt.where(ArtifactRow.deleted_at.is_(None))
        if kind is not None:
            stmt = stmt.where(ArtifactRow.kind == kind)
        if name_prefix:
            stmt = stmt.where(ArtifactRow.name.like(f"{name_prefix}%"))
        if pinned_only:
            stmt = stmt.where(ArtifactRow.pinned.is_(True))
        stmt = stmt.order_by(
            ArtifactRow.pinned.desc(),
            ArtifactRow.updated_at.desc(),
        ).limit(limit)
        result = await self._s.execute(stmt)
        return [_row_to_artifact(r) for r in result.scalars().all()]

    async def search(self, workspace_id: str, query: str, limit: int = 50) -> list[Artifact]:
        # Content moved off-DB (2026-04-25); search is name-only now. A
        # full-text index over disk content can be re-added later if users
        # actually rely on body search — for now nobody does, and grepping
        # 1MB blobs in SQLite was the slow path anyway.
        like = f"%{query}%"
        stmt = (
            select(ArtifactRow)
            .where(ArtifactRow.workspace_id == workspace_id)
            .where(ArtifactRow.deleted_at.is_(None))
            .where(ArtifactRow.name.like(like))
            .order_by(ArtifactRow.updated_at.desc())
            .limit(limit)
        )
        result = await self._s.execute(stmt)
        return [_row_to_artifact(r) for r in result.scalars().all()]

    async def upsert(self, artifact: Artifact) -> Artifact:
        existing = await self._s.get(ArtifactRow, artifact.id)
        if existing:
            existing.workspace_id = artifact.workspace_id
            existing.name = artifact.name
            existing.kind = artifact.kind.value
            existing.mime_type = artifact.mime_type
            existing.file_path = artifact.file_path
            existing.size_bytes = artifact.size_bytes
            existing.version = artifact.version
            existing.pinned = artifact.pinned
            existing.deleted_at = _naive(artifact.deleted_at) if artifact.deleted_at else None
            existing.created_by_run_id = artifact.created_by_run_id
            existing.created_by_employee_id = artifact.created_by_employee_id
            existing.conversation_id = artifact.conversation_id
            existing.updated_at = _naive(artifact.updated_at)
            existing.extra_metadata = dict(artifact.extra_metadata)
        else:
            self._s.add(
                ArtifactRow(
                    id=artifact.id,
                    workspace_id=artifact.workspace_id,
                    name=artifact.name,
                    kind=artifact.kind.value,
                    mime_type=artifact.mime_type,
                    file_path=artifact.file_path,
                    size_bytes=artifact.size_bytes,
                    version=artifact.version,
                    pinned=artifact.pinned,
                    deleted_at=_naive(artifact.deleted_at) if artifact.deleted_at else None,
                    created_by_run_id=artifact.created_by_run_id,
                    created_by_employee_id=artifact.created_by_employee_id,
                    conversation_id=artifact.conversation_id,
                    created_at=_naive(artifact.created_at),
                    updated_at=_naive(artifact.updated_at),
                    extra_metadata=dict(artifact.extra_metadata),
                )
            )
        await self._s.flush()
        return artifact

    async def soft_delete(self, artifact_id: str, deleted_at: datetime) -> None:
        await self._s.execute(
            update(ArtifactRow)
            .where(ArtifactRow.id == artifact_id)
            .values(deleted_at=_naive(deleted_at), updated_at=_naive(deleted_at))
        )

    async def list_versions(self, artifact_id: str) -> list[ArtifactVersion]:
        stmt = (
            select(ArtifactVersionRow)
            .where(ArtifactVersionRow.artifact_id == artifact_id)
            .order_by(ArtifactVersionRow.version.desc())
        )
        result = await self._s.execute(stmt)
        return [_row_to_artifact_version(r) for r in result.scalars().all()]

    async def get_version(self, artifact_id: str, version: int) -> ArtifactVersion | None:
        stmt = (
            select(ArtifactVersionRow)
            .where(ArtifactVersionRow.artifact_id == artifact_id)
            .where(ArtifactVersionRow.version == version)
        )
        result = await self._s.execute(stmt)
        row = result.scalars().first()
        return _row_to_artifact_version(row) if row else None

    async def save_version(self, version: ArtifactVersion) -> None:
        self._s.add(
            ArtifactVersionRow(
                id=version.id,
                artifact_id=version.artifact_id,
                version=version.version,
                file_path=version.file_path,
                diff_from_prev=version.diff_from_prev,
                created_at=_naive(version.created_at),
            )
        )
        await self._s.flush()


def _row_to_event(row: EventRow) -> EventEnvelope:
    return EventEnvelope(
        id=row.id,
        kind=row.kind,
        payload=row.payload,
        published_at=_utc(row.published_at),
        trigger_id=row.trigger_id,
        actor=row.actor,
        subject=row.subject,
        severity=row.severity,
        link=row.link,
        workspace_id=row.workspace_id,
    )


class SqlEventRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def save(self, event: EventEnvelope) -> None:
        self._s.add(
            EventRow(
                id=event.id,
                kind=event.kind,
                payload=event.payload,
                published_at=_naive(event.published_at),
                trigger_id=event.trigger_id,
                actor=event.actor,
                subject=event.subject,
                severity=event.severity,
                link=event.link,
                workspace_id=event.workspace_id,
            )
        )
        await self._s.flush()

    async def list_recent(
        self,
        limit: int = 100,
        *,
        workspace_id: str | None = None,
        kind_prefixes: list[str] | None = None,
        since: datetime | None = None,
    ) -> list[EventEnvelope]:
        stmt = select(EventRow)
        if workspace_id is not None:
            stmt = stmt.where(EventRow.workspace_id == workspace_id)
        if kind_prefixes:
            stmt = stmt.where(or_(*(EventRow.kind.startswith(p) for p in kind_prefixes)))
        if since is not None:
            stmt = stmt.where(EventRow.published_at >= _naive(since))
        stmt = stmt.order_by(EventRow.published_at.desc()).limit(limit)
        result = await self._s.execute(stmt)
        return [_row_to_event(r) for r in result.scalars().all()]

    async def count_since(
        self,
        since: datetime,
        *,
        workspace_id: str | None = None,
        kind_prefixes: list[str] | None = None,
    ) -> int:
        stmt = (
            select(func.count()).select_from(EventRow).where(EventRow.published_at >= _naive(since))
        )
        if workspace_id is not None:
            stmt = stmt.where(EventRow.workspace_id == workspace_id)
        if kind_prefixes:
            stmt = stmt.where(or_(*(EventRow.kind.startswith(p) for p in kind_prefixes)))
        result = await self._s.execute(stmt)
        return int(result.scalar_one())


def _row_to_task(row: TaskRow) -> Task:
    return Task(
        id=row.id,
        workspace_id=row.workspace_id,
        title=row.title,
        goal=row.goal,
        dod=row.dod,
        assignee_id=row.assignee_id,
        status=TaskStatus(row.status),
        source=TaskSource(row.source),
        created_by=row.created_by,
        parent_task_id=row.parent_task_id,
        run_ids=list(row.run_ids or []),
        artifact_ids=list(row.artifact_ids or []),
        conversation_id=row.conversation_id,
        result_summary=row.result_summary,
        error_summary=row.error_summary,
        pending_input_question=row.pending_input_question,
        pending_approval_payload=dict(row.pending_approval_payload)
        if row.pending_approval_payload
        else None,
        token_budget=row.token_budget,
        tokens_used=row.tokens_used,
        created_at=_utc(row.created_at),
        updated_at=_utc(row.updated_at),
        completed_at=_utc(row.completed_at) if row.completed_at else None,
    )


class SqlTaskRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, task_id: str) -> Task | None:
        row = await self._s.get(TaskRow, task_id)
        return _row_to_task(row) if row else None

    async def get_by_run_id(self, run_id: str) -> Task | None:
        """Return the first task whose ``run_ids`` JSON array contains ``run_id``.

        v0 MVP: JSON array scans live in Python, not SQL — cross-dialect
        JSON containment (SQLite / Postgres) is a pain to parametrise and
        task counts are tiny at this stage. If task fan-out grows, move to a
        normalised ``task_runs`` table.
        """
        rows = await self._s.execute(select(TaskRow))
        for row in rows.scalars():
            if run_id in (row.run_ids or []):
                return _row_to_task(row)
        return None

    async def list_all(
        self,
        *,
        workspace_id: str = "default",
        statuses: list[TaskStatus] | None = None,
        assignee_id: str | None = None,
        limit: int = 100,
    ) -> list[Task]:
        stmt = select(TaskRow).where(TaskRow.workspace_id == workspace_id)
        if statuses:
            stmt = stmt.where(TaskRow.status.in_([s.value for s in statuses]))
        if assignee_id:
            stmt = stmt.where(TaskRow.assignee_id == assignee_id)
        stmt = stmt.order_by(TaskRow.updated_at.desc()).limit(limit)
        result = await self._s.execute(stmt)
        return [_row_to_task(r) for r in result.scalars().all()]

    async def count_active(self, workspace_id: str = "default") -> int:
        active_values = [s.value for s in ACTIVE_STATUSES]
        stmt = (
            select(func.count())
            .select_from(TaskRow)
            .where(TaskRow.workspace_id == workspace_id)
            .where(TaskRow.status.in_(active_values))
        )
        result = await self._s.execute(stmt)
        return int(result.scalar_one())

    async def upsert(self, task: Task) -> Task:
        existing = await self._s.get(TaskRow, task.id)
        if existing is None:
            self._s.add(
                TaskRow(
                    id=task.id,
                    workspace_id=task.workspace_id,
                    title=task.title,
                    goal=task.goal,
                    dod=task.dod,
                    assignee_id=task.assignee_id,
                    status=task.status.value,
                    source=task.source.value,
                    created_by=task.created_by,
                    parent_task_id=task.parent_task_id,
                    run_ids=list(task.run_ids),
                    artifact_ids=list(task.artifact_ids),
                    conversation_id=task.conversation_id,
                    result_summary=task.result_summary,
                    error_summary=task.error_summary,
                    pending_input_question=task.pending_input_question,
                    pending_approval_payload=dict(task.pending_approval_payload)
                    if task.pending_approval_payload
                    else None,
                    token_budget=task.token_budget,
                    tokens_used=task.tokens_used,
                    created_at=_naive(task.created_at),
                    updated_at=_naive(task.updated_at),
                    completed_at=_naive(task.completed_at) if task.completed_at else None,
                )
            )
        else:
            existing.workspace_id = task.workspace_id
            existing.title = task.title
            existing.goal = task.goal
            existing.dod = task.dod
            existing.assignee_id = task.assignee_id
            existing.status = task.status.value
            existing.source = task.source.value
            existing.created_by = task.created_by
            existing.parent_task_id = task.parent_task_id
            existing.run_ids = list(task.run_ids)
            existing.artifact_ids = list(task.artifact_ids)
            existing.conversation_id = task.conversation_id
            existing.result_summary = task.result_summary
            existing.error_summary = task.error_summary
            existing.pending_input_question = task.pending_input_question
            existing.pending_approval_payload = (
                dict(task.pending_approval_payload) if task.pending_approval_payload else None
            )
            existing.token_budget = task.token_budget
            existing.tokens_used = task.tokens_used
            existing.updated_at = _naive(task.updated_at)
            existing.completed_at = _naive(task.completed_at) if task.completed_at else None
        await self._s.flush()
        return task


class SqlObservabilityConfigRepo:
    """Single-row observability_config repo (spec § 4.1).

    The id=1 row is seeded by migration 0012; `load()` materialises it even if
    a caller hits the DB before the seed has landed (fresh SQLite in tests).
    """

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def load(self) -> ObservabilityConfig:
        from allhands.core import BootstrapStatus

        row = await self._s.get(ObservabilityConfigRow, 1)
        if row is None:
            row = ObservabilityConfigRow(
                id=1, bootstrap_status="pending", updated_at=datetime.now(UTC).replace(tzinfo=None)
            )
            self._s.add(row)
            await self._s.flush()
        return ObservabilityConfig(
            public_key=row.public_key,
            secret_key=row.secret_key,
            host=row.host,
            org_id=row.org_id,
            project_id=row.project_id,
            admin_email=row.admin_email,
            admin_password=row.admin_password,
            bootstrap_status=BootstrapStatus(row.bootstrap_status),
            bootstrap_error=row.bootstrap_error,
            bootstrapped_at=_utc(row.bootstrapped_at) if row.bootstrapped_at else None,
            updated_at=_utc(row.updated_at) if row.updated_at else None,
        )

    async def save(self, config: ObservabilityConfig) -> ObservabilityConfig:
        row = await self._s.get(ObservabilityConfigRow, 1)
        now = datetime.now(UTC).replace(tzinfo=None)
        if row is None:
            row = ObservabilityConfigRow(
                id=1, bootstrap_status=config.bootstrap_status.value, updated_at=now
            )
            self._s.add(row)
        row.public_key = config.public_key
        row.secret_key = config.secret_key
        row.host = config.host
        row.org_id = config.org_id
        row.project_id = config.project_id
        row.admin_email = config.admin_email
        row.admin_password = config.admin_password
        row.bootstrap_status = config.bootstrap_status.value
        row.bootstrap_error = config.bootstrap_error
        row.bootstrapped_at = _naive(config.bootstrapped_at) if config.bootstrapped_at else None
        row.updated_at = now
        await self._s.flush()
        return config


class SqlSkillRuntimeRepo:
    """Per-conversation SkillRuntime checkpoint (ADR 0011 · 原则 7).

    Body is ``SkillRuntime.model_dump()`` — a plain dict, stored in the JSON
    column — so adding a new field on the domain model (with a Pydantic
    default) doesn't require a migration. ``load()`` runs
    ``SkillRuntime.model_validate()`` which enforces the current schema and
    supplies defaults for any older row that pre-dates a field.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def load(self, conversation_id: str) -> SkillRuntime | None:
        row = await self._s.get(SkillRuntimeRow, conversation_id)
        if row is None:
            return None
        return SkillRuntime.model_validate(row.body)

    async def save(self, conversation_id: str, runtime: SkillRuntime) -> None:
        now = datetime.now(UTC).replace(tzinfo=None)
        row = await self._s.get(SkillRuntimeRow, conversation_id)
        body = runtime.model_dump()
        if row is None:
            self._s.add(
                SkillRuntimeRow(
                    conversation_id=conversation_id,
                    body=body,
                    updated_at=now,
                )
            )
        else:
            row.body = body
            row.updated_at = now
        await self._s.flush()

    async def delete(self, conversation_id: str) -> None:
        row = await self._s.get(SkillRuntimeRow, conversation_id)
        if row is not None:
            await self._s.delete(row)
            await self._s.flush()


def _row_to_conversation_event(row: ConversationEventRow) -> ConversationEvent:
    return ConversationEvent(
        id=row.id,
        conversation_id=row.conversation_id,
        parent_id=row.parent_id,
        sequence=row.sequence,
        kind=EventKind(row.kind),
        content_json=dict(row.content_json),
        subagent_id=row.subagent_id,
        turn_id=row.turn_id,
        idempotency_key=row.idempotency_key,
        is_compacted=row.is_compacted,
        created_at=_utc(row.created_at),
    )


class SqlConversationEventRepo:
    """ADR 0017 · append-only event log (Claude Code ``{sessionId}.jsonl`` equivalent).

    All reads go through ``sequence``-ordered queries; writes use
    ``next_sequence`` atomically within the caller's transaction. Idempotency
    is enforced by the partial unique index on
    ``(conversation_id, idempotency_key)``; callers that send the same
    idempotency_key twice can either swallow the IntegrityError or look up
    via ``get_by_idempotency_key`` first — we prefer the latter so the
    original event surfaces cleanly.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def next_sequence(self, conversation_id: str) -> int:
        stmt = select(func.coalesce(func.max(ConversationEventRow.sequence), 0)).where(
            ConversationEventRow.conversation_id == conversation_id,
        )
        current = await self._s.scalar(stmt)
        return int(current or 0) + 1

    async def append(self, event: ConversationEvent) -> ConversationEvent:
        row = ConversationEventRow(
            id=event.id,
            conversation_id=event.conversation_id,
            parent_id=event.parent_id,
            sequence=event.sequence,
            kind=event.kind.value,
            content_json=dict(event.content_json),
            subagent_id=event.subagent_id,
            turn_id=event.turn_id,
            idempotency_key=event.idempotency_key,
            is_compacted=event.is_compacted,
            created_at=_naive(_utc(event.created_at)),
        )
        self._s.add(row)
        await self._s.flush()
        return event

    async def list_by_conversation(
        self,
        conversation_id: str,
        *,
        include_compacted: bool = True,
        subagent_id: str | None = None,
    ) -> list[ConversationEvent]:
        stmt = select(ConversationEventRow).where(
            ConversationEventRow.conversation_id == conversation_id,
        )
        if not include_compacted:
            stmt = stmt.where(ConversationEventRow.is_compacted.is_(False))
        if subagent_id is None:
            stmt = stmt.where(ConversationEventRow.subagent_id.is_(None))
        elif subagent_id != "*":
            stmt = stmt.where(ConversationEventRow.subagent_id == subagent_id)
        stmt = stmt.order_by(ConversationEventRow.sequence.asc())
        rows = (await self._s.scalars(stmt)).all()
        return [_row_to_conversation_event(r) for r in rows]

    async def get(self, event_id: str) -> ConversationEvent | None:
        row = await self._s.get(ConversationEventRow, event_id)
        return _row_to_conversation_event(row) if row is not None else None

    async def get_by_idempotency_key(
        self, conversation_id: str, idempotency_key: str
    ) -> ConversationEvent | None:
        stmt = select(ConversationEventRow).where(
            ConversationEventRow.conversation_id == conversation_id,
            ConversationEventRow.idempotency_key == idempotency_key,
        )
        row = await self._s.scalar(stmt)
        return _row_to_conversation_event(row) if row is not None else None

    async def find_orphan_turns(self, conversation_id: str) -> list[str]:
        """Return turn_ids that have TURN_STARTED but no
        TURN_COMPLETED / TURN_ABORTED. Used at startup for crash recovery.
        """
        started_stmt = select(ConversationEventRow.turn_id).where(
            ConversationEventRow.conversation_id == conversation_id,
            ConversationEventRow.kind == EventKind.TURN_STARTED.value,
            ConversationEventRow.turn_id.is_not(None),
        )
        closed_stmt = select(ConversationEventRow.turn_id).where(
            ConversationEventRow.conversation_id == conversation_id,
            ConversationEventRow.kind.in_(
                [EventKind.TURN_COMPLETED.value, EventKind.TURN_ABORTED.value]
            ),
            ConversationEventRow.turn_id.is_not(None),
        )
        started = {tid for tid in (await self._s.scalars(started_stmt)).all() if tid}
        closed = {tid for tid in (await self._s.scalars(closed_stmt)).all() if tid}
        return sorted(started - closed)

    async def mark_compacted(self, event_ids: list[str]) -> None:
        if not event_ids:
            return
        stmt = (
            update(ConversationEventRow)
            .where(ConversationEventRow.id.in_(event_ids))
            .values(is_compacted=True)
        )
        await self._s.execute(stmt)
        await self._s.flush()
