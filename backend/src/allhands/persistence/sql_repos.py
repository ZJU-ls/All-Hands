"""Concrete SQLAlchemy repository implementations."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

from sqlalchemy import select, update

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

from allhands.core import (
    Confirmation,
    ConfirmationStatus,
    Conversation,
    Employee,
    InteractionSpec,
    LLMProvider,
    MCPHealth,
    MCPServer,
    MCPTransport,
    Message,
    RenderPayload,
    Skill,
    ToolCall,
    ToolCallStatus,
)
from allhands.persistence.orm.models import (
    ConfirmationRow,
    ConversationRow,
    EmployeeRow,
    LLMProviderRow,
    MCPServerRow,
    MessageRow,
    SkillRow,
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
        created_by=row.created_by,
        created_at=_utc(row.created_at),
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
        created_by=emp.created_by,
        created_at=_naive(emp.created_at),
        extra_metadata=dict(emp.metadata),
    )


def _row_to_conversation(row: ConversationRow) -> Conversation:
    return Conversation(
        id=row.id,
        title=row.title,
        employee_id=row.employee_id,
        created_at=_utc(row.created_at),
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

    async def list_all(self) -> list[Employee]:
        result = await self._s.execute(select(EmployeeRow))
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
            extra_metadata=dict(conversation.metadata),
        )
        self._s.add(row)
        await self._s.flush()
        return conversation

    async def list_for_employee(self, employee_id: str) -> list[Conversation]:
        result = await self._s.execute(
            select(ConversationRow)
            .where(ConversationRow.employee_id == employee_id)
            .order_by(ConversationRow.created_at.desc())
        )
        return [_row_to_conversation(r) for r in result.scalars().all()]

    async def list_messages(self, conversation_id: str) -> list[Message]:
        result = await self._s.execute(
            select(MessageRow)
            .where(MessageRow.conversation_id == conversation_id)
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
            created_at=_naive(message.created_at),
        )
        self._s.add(row)
        await self._s.flush()
        return message


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
        if existing:
            existing.name = skill.name
            existing.description = skill.description
            existing.tool_ids = list(skill.tool_ids)
            existing.prompt_fragment = skill.prompt_fragment or ""
            existing.version = skill.version
        else:
            self._s.add(
                SkillRow(
                    id=skill.id,
                    name=skill.name,
                    description=skill.description,
                    tool_ids=list(skill.tool_ids),
                    prompt_fragment=skill.prompt_fragment or "",
                    version=skill.version,
                )
            )
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


def _row_to_provider(row: LLMProviderRow) -> LLMProvider:
    return LLMProvider(
        id=row.id,
        name=row.name,
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
