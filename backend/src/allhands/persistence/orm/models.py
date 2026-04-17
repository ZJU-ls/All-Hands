"""ORM row types, one per core aggregate. Kept minimal for v0 MVP.

Rows are thin storage shapes — the mapping to/from core domain objects happens in
repositories. That keeps ORM leakage out of core/ and lets us evolve the schema
without touching domain types.
"""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — SQLAlchemy evaluates Mapped[] at runtime

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
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(2000))
    tool_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    prompt_fragment: Mapped[str] = mapped_column(String(8000))
    version: Mapped[str] = mapped_column(String(32))


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
