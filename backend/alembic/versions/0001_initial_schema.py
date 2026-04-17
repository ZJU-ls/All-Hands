"""initial schema (v0 MVP)

Revision ID: 0001
Revises:
Create Date: 2026-04-17

Creates: employees, skills, mcp_servers, conversations, messages, tool_calls, confirmations.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "employees",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("description", sa.String(2000), nullable=False),
        sa.Column("system_prompt", sa.String(20000), nullable=False),
        sa.Column("model_ref", sa.String(128), nullable=False),
        sa.Column("tool_ids", sa.JSON, nullable=False),
        sa.Column("skill_ids", sa.JSON, nullable=False),
        sa.Column("max_iterations", sa.Integer, nullable=False, server_default="10"),
        sa.Column(
            "is_lead_agent",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("metadata", sa.JSON, nullable=False),
    )
    op.create_index("ix_employees_name", "employees", ["name"], unique=True)
    op.create_index("ix_employees_is_lead_agent", "employees", ["is_lead_agent"])
    op.create_index("ix_employees_created_at", "employees", ["created_at"])
    # SQLite: partial unique index to enforce singleton lead agent.
    op.execute(
        "CREATE UNIQUE INDEX uq_employees_lead_singleton "
        "ON employees (is_lead_agent) WHERE is_lead_agent = 1"
    )

    op.create_table(
        "skills",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.String(2000), nullable=False),
        sa.Column("tool_ids", sa.JSON, nullable=False),
        sa.Column("prompt_fragment", sa.String(8000), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
    )
    op.create_index("ix_skills_name", "skills", ["name"], unique=True)

    op.create_table(
        "mcp_servers",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("transport", sa.String(16), nullable=False),
        sa.Column("config", sa.JSON, nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("exposed_tool_ids", sa.JSON, nullable=False),
        sa.Column("last_handshake_at", sa.DateTime, nullable=True),
        sa.Column("health", sa.String(32), nullable=False, server_default="unknown"),
    )
    op.create_index("ix_mcp_servers_name", "mcp_servers", ["name"], unique=True)

    op.create_table(
        "conversations",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("title", sa.String(256), nullable=True),
        sa.Column(
            "employee_id",
            sa.String(64),
            sa.ForeignKey("employees.id"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("metadata", sa.JSON, nullable=False),
    )
    op.create_index(
        "ix_conversations_employee_id", "conversations", ["employee_id"]
    )
    op.create_index(
        "ix_conversations_created_at", "conversations", ["created_at"]
    )

    op.create_table(
        "messages",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(64),
            sa.ForeignKey("conversations.id"),
            nullable=False,
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.String, nullable=False),
        sa.Column("tool_calls", sa.JSON, nullable=False),
        sa.Column("tool_call_id", sa.String(64), nullable=True),
        sa.Column("render_payloads", sa.JSON, nullable=False),
        sa.Column("trace_ref", sa.String(128), nullable=True),
        sa.Column("parent_run_id", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index(
        "ix_messages_conversation_id", "messages", ["conversation_id"]
    )
    op.create_index("ix_messages_created_at", "messages", ["created_at"])

    op.create_table(
        "tool_calls",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "message_id",
            sa.String(64),
            sa.ForeignKey("messages.id"),
            nullable=False,
        ),
        sa.Column("tool_id", sa.String(128), nullable=False),
        sa.Column("args", sa.JSON, nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("result", sa.JSON, nullable=True),
        sa.Column("error", sa.String, nullable=True),
        sa.Column("started_at", sa.DateTime, nullable=True),
        sa.Column("ended_at", sa.DateTime, nullable=True),
    )
    op.create_index("ix_tool_calls_message_id", "tool_calls", ["message_id"])
    op.create_index("ix_tool_calls_tool_id", "tool_calls", ["tool_id"])
    op.create_index("ix_tool_calls_status", "tool_calls", ["status"])

    op.create_table(
        "confirmations",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "tool_call_id",
            sa.String(64),
            sa.ForeignKey("tool_calls.id"),
            nullable=False,
        ),
        sa.Column("rationale", sa.String(4000), nullable=False),
        sa.Column("summary", sa.String(4000), nullable=False),
        sa.Column("diff", sa.JSON, nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("resolved_at", sa.DateTime, nullable=True),
        sa.Column("expires_at", sa.DateTime, nullable=False),
    )
    op.create_index(
        "ix_confirmations_tool_call_id",
        "confirmations",
        ["tool_call_id"],
        unique=True,
    )
    op.create_index("ix_confirmations_status", "confirmations", ["status"])
    op.create_index("ix_confirmations_expires_at", "confirmations", ["expires_at"])


def downgrade() -> None:
    op.drop_table("confirmations")
    op.drop_table("tool_calls")
    op.drop_table("messages")
    op.drop_table("conversations")
    op.drop_table("mcp_servers")
    op.drop_table("skills")
    op.execute("DROP INDEX IF EXISTS uq_employees_lead_singleton")
    op.drop_table("employees")
