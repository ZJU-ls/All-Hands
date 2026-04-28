"""ORM row types, one per core aggregate. Kept minimal for v0 MVP.

Rows are thin storage shapes — the mapping to/from core domain objects happens in
repositories. That keeps ORM leakage out of core/ and lets us evolve the schema
without touching domain types.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
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
    status: Mapped[str] = mapped_column(
        String(32), default="published", server_default="published", index=True
    )
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
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


class LocalWorkspaceRow(Base):
    __tablename__ = "local_workspaces"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    root_path: Mapped[str] = mapped_column(String(1024))
    read_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    denied_globs: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime)


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
    model_ref_override: Mapped[str | None] = mapped_column(String(256), nullable=True)
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
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    # See core.Message.interrupted — true when the LLM stream didn't
    # reach a clean done (user 中止 / transport drop / mid-stream error).
    interrupted: Mapped[bool] = mapped_column(Boolean, default=False)
    # See core.Message.is_compacted — soft flag set by manual /compact so the
    # row stays in the transcript (UI renders it behind a fold) while the LLM
    # context build path filters it out. Indexed because send_message reads
    # all messages and filters; with very long conversations this saves a
    # full table scan.
    is_compacted: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0"), index=True
    )
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
    # 2026-04-25 · ADR 0018 后 tool_calls 数据迁到 messages.tool_calls JSON,
    # 这个 FK 指向一个实际为空的旧表 · 每次 confirmation INSERT 都会触发
    # IntegrityError("FOREIGN KEY constraint failed")。FK 直接干掉,字段保
    # 留(语义层面 tool_call_id 仍然是一对一的关联键,只是不再走 DB 外键)。
    tool_call_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    rationale: Mapped[str] = mapped_column(String(4000))
    summary: Mapped[str] = mapped_column(String(4000))
    diff: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class UserInputRow(Base):
    """ADR 0019 C3 · clarification request persistence (ask_user_question)."""

    __tablename__ = "user_inputs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tool_call_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    questions_json: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    answers_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class LLMProviderRow(Base):
    __tablename__ = "llm_providers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(32), default="openai")
    base_url: Mapped[str] = mapped_column(String(512))
    api_key: Mapped[str] = mapped_column(String(512), default="")
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
    # Optional explicit caps. None → "use model default" (we don't constrain
    # the request). When set, max_input_tokens drives the composer's budget
    # chip denominator and max_output_tokens is forwarded as `max_tokens` on
    # outbound chat requests. Kept separate from `context_window` because
    # vendors expose three distinct numbers (total / input / output) and
    # collapsing them produced the "6/64k" UX confusion.
    max_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # System-wide singleton: at most one row has is_default=True. Service
    # layer enforces — see LLMModelRepo.set_default(). Indexed because
    # `model_resolution.resolve()` runs every Lead Agent turn and needs a
    # fast lookup of "the unique default model".
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


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


class ArtifactRow(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(256), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    mime_type: Mapped[str] = mapped_column(String(128))
    # 2026-04-25 storage refactor: all kinds (text + binary) now live on
    # disk; ``content`` column is gone. ``file_path`` is required.
    file_path: Mapped[str] = mapped_column(String(512))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_by_run_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_by_employee_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    conversation_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    # 2026-04-25 v2 (Git-style) — see core.Artifact for semantics.
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    labels: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="published", index=True)
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    edit_count: Mapped[int] = mapped_column(Integer, default=0)
    extra_metadata: Mapped[dict[str, object]] = mapped_column("metadata", JSON, default=dict)


class ArtifactVersionRow(Base):
    __tablename__ = "artifact_versions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    artifact_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer)
    file_path: Mapped[str] = mapped_column(String(512))
    diff_from_prev: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    # 2026-04-25 v2 — per-version provenance + commit message.
    change_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    parent_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by_run_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_by_employee_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by_user: Mapped[str | None] = mapped_column(String(128), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)


class EventRow(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(128), index=True)
    payload: Mapped[dict[str, object]] = mapped_column(JSON)
    published_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    trigger_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor: Mapped[str | None] = mapped_column(String(128), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(128), nullable=True)
    severity: Mapped[str] = mapped_column(String(16), default="info")
    link: Mapped[str | None] = mapped_column(String(512), nullable=True)
    workspace_id: Mapped[str] = mapped_column(String(64), default="default", index=True)


class TaskRow(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(64), default="default", index=True)
    title: Mapped[str] = mapped_column(String(256))
    goal: Mapped[str] = mapped_column(String)
    dod: Mapped[str] = mapped_column(String)
    assignee_id: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    source: Mapped[str] = mapped_column(String(32))
    created_by: Mapped[str] = mapped_column(String(128))
    parent_task_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("tasks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    run_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    artifact_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    conversation_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    result_summary: Mapped[str | None] = mapped_column(String, nullable=True)
    error_summary: Mapped[str | None] = mapped_column(String, nullable=True)
    pending_input_question: Mapped[str | None] = mapped_column(String, nullable=True)
    pending_approval_payload: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    token_budget: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ObservabilityConfigRow(Base):
    """Singleton system-config row · post-Langfuse (2026-04-25).

    The langfuse credential + bootstrap columns were dropped via migration
    0023 once self-instrumentation became the only path.
    """

    __tablename__ = "observability_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime)
    auto_title_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class SkillRuntimeRow(Base):
    """Per-conversation SkillRuntime checkpoint (ADR 0011 · 原则 7).

    One row per conversation — `conversation_id` is PK to model 1:1 and to make
    the upsert cheap. Body is a JSON blob of `SkillRuntime.model_dump()` so
    schema evolutions stay backward-compatible (adding a field just needs a
    Pydantic default).

    We intentionally don't FK to `conversations.id` — the repo guarantees
    `save` is only called for live conversations, and compact clears both sides
    explicitly. Keeping the table standalone lets `DROP TABLE` / restore work
    without cascades biting us during dev iteration.
    """

    __tablename__ = "skill_runtimes"

    conversation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    body: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class ConversationEventRow(Base):
    """ADR 0017 · append-only conversation event log.

    The single source of truth for conversation history. ``content_json`` is
    the flexible payload (Claude Code's JSONL entry.content equivalent).

    - ``(conversation_id, sequence)`` has a UNIQUE index — no holes, no
      duplicates in a single conversation's timeline.
    - ``idempotency_key`` is UNIQUE per conversation (partial index, SQLite
      ``WHERE idempotency_key IS NOT NULL``) so client retries dedup cleanly.
    - ``parent_id`` references another event in the same log (not FK'd
      because cross-branch references may point at events that got soft-
      deleted during snip repair; the projection logic handles broken links).
    """

    __tablename__ = "conversation_events"

    __table_args__ = (
        UniqueConstraint("conversation_id", "sequence", name="uq_conv_events_conv_seq"),
        Index(
            "ix_conversation_events_subagent",
            "conversation_id",
            "subagent_id",
            "sequence",
        ),
        Index("ix_conversation_events_turn", "turn_id"),
        Index(
            "ix_conversation_events_idempotency",
            "conversation_id",
            "idempotency_key",
            unique=True,
            sqlite_where=text("idempotency_key IS NOT NULL"),
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(64))
    parent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sequence: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(48))
    content_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    subagent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    turn_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_compacted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class ModelPriceRow(Base):
    """Runtime overlay for per-model token pricing.

    Codebase ships seed prices in ``services/model_pricing.py``; this table
    overrides them at runtime so an Agent (or admin) can correct prices
    when a provider's page changes — without a code redeploy. Look-up
    semantics: DB row wins, code dict is fallback. ``model_ref`` is the
    same key the LLMModel layer uses (e.g. ``openai/gpt-4o-mini``).

    ``source_url`` carries the citation the curator-Agent used; ``note``
    is free-form (e.g. "promo until 2026-Q3"). ``updated_by_run_id``
    links back to the Observatory run that wrote the row — provenance.
    """

    __tablename__ = "model_prices"

    model_ref: Mapped[str] = mapped_column(String(128), primary_key=True)
    input_per_million_usd: Mapped[float] = mapped_column(Float, default=0.0)
    output_per_million_usd: Mapped[float] = mapped_column(Float, default=0.0)
    source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    note: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    updated_by_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
