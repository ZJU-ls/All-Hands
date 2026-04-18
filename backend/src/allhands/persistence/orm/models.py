"""ORM row types, one per core aggregate. Kept minimal for v0 MVP.

Rows are thin storage shapes — the mapping to/from core domain objects happens in
repositories. That keeps ORM leakage out of core/ and lets us evolve the schema
without touching domain types.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from allhands.persistence.orm.base import Base


class EmployeeRow(Base):
    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(2000))
    system_prompt: Mapped[str] = mapped_column(String(20000))
    model_ref: Mapped[str] = mapped_column(String(128))
    tool_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    skill_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    max_iterations: Mapped[int] = mapped_column(Integer, default=10)
    is_lead_agent: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    extra_metadata: Mapped[dict[str, object]] = mapped_column("metadata", JSON, default=dict)

    # The "only one lead agent" invariant is enforced by a partial unique
    # index created in alembic migration 0001 (SQLite-specific syntax). Kept
    # out of the ORM so declarative metadata stays portable.


class SkillRow(Base):
    __tablename__ = "skills"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    description: Mapped[str] = mapped_column(String(2000))
    tool_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    prompt_fragment: Mapped[str] = mapped_column(String(8000))
    version: Mapped[str] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(32), default="builtin")
    source_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    installed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    path: Mapped[str | None] = mapped_column(String(512), nullable=True)


class MCPServerRow(Base):
    __tablename__ = "mcp_servers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    transport: Mapped[str] = mapped_column(String(16))
    config: Mapped[dict[str, object]] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    exposed_tool_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    last_handshake_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    health: Mapped[str] = mapped_column(String(32), default="unknown")


class AgentPlanRow(Base):
    __tablename__ = "agent_plans"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        index=True,
    )
    run_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    owner_employee_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(512))
    steps: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)


class ConversationRow(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str | None] = mapped_column(String(256), nullable=True)
    employee_id: Mapped[str] = mapped_column(String(64), ForeignKey("employees.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    extra_metadata: Mapped[dict[str, object]] = mapped_column("metadata", JSON, default=dict)

    messages: Mapped[list[MessageRow]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="MessageRow.created_at",
    )


class MessageRow(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("conversations.id"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(String)
    tool_calls: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    tool_call_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    render_payloads: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    trace_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    parent_run_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)

    conversation: Mapped[ConversationRow] = relationship(back_populates="messages")


class ToolCallRow(Base):
    __tablename__ = "tool_calls"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    message_id: Mapped[str] = mapped_column(String(64), ForeignKey("messages.id"), index=True)
    tool_id: Mapped[str] = mapped_column(String(128), index=True)
    args: Mapped[dict[str, object]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), index=True)
    result: Mapped[object | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ConfirmationRow(Base):
    __tablename__ = "confirmations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tool_call_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tool_calls.id"), unique=True, index=True
    )
    rationale: Mapped[str] = mapped_column(String(4000))
    summary: Mapped[str] = mapped_column(String(4000))
    diff: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class LLMProviderRow(Base):
    __tablename__ = "llm_providers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    base_url: Mapped[str] = mapped_column(String(512))
    api_key: Mapped[str] = mapped_column(String(512), default="")
    default_model: Mapped[str] = mapped_column(String(128), default="gpt-4o-mini")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class LLMModelRow(Base):
    __tablename__ = "llm_models"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("llm_providers.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(128), index=True)
    display_name: Mapped[str] = mapped_column(String(128), default="")
    context_window: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class TriggerRow(Base):
    __tablename__ = "triggers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16), index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    timer: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    event: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    action: Mapped[dict[str, object]] = mapped_column(JSON)
    min_interval_seconds: Mapped[int] = mapped_column(Integer, default=300)
    fires_total: Mapped[int] = mapped_column(Integer, default=0)
    fires_failed_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_fired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    auto_disabled_reason: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    created_by: Mapped[str] = mapped_column(String(64))


class TriggerFireRow(Base):
    __tablename__ = "trigger_fires"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    trigger_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("triggers.id", ondelete="CASCADE"), index=True
    )
    fired_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    source: Mapped[str] = mapped_column(String(16))
    event_payload: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    action_snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    rendered_task: Mapped[str | None] = mapped_column(String(8000), nullable=True)
    run_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(String(2000), nullable=True)


class EventRow(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(128), index=True)
    payload: Mapped[dict[str, object]] = mapped_column(JSON)
    published_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    trigger_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
