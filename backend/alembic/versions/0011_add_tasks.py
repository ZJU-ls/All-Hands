"""add tasks table (tasks spec § 3.2)

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-19

Task is a first-class asynchronous work unit orthogonal to Chat — spec
`docs/specs/agent-design/2026-04-18-tasks.md` § 3. artifacts.task_id is added
here as a nullable back-reference so an artifact can be attached to the Task
that produced it (§ 8 "关系" table).
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("workspace_id", sa.String(64), nullable=False, server_default="default"),
        sa.Column("title", sa.String(256), nullable=False),
        sa.Column("goal", sa.String, nullable=False),
        sa.Column("dod", sa.String, nullable=False),
        sa.Column("assignee_id", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="queued"),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("created_by", sa.String(128), nullable=False),
        sa.Column(
            "parent_task_id",
            sa.String(64),
            sa.ForeignKey("tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("run_ids", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("artifact_ids", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("conversation_id", sa.String(64), nullable=True),
        sa.Column("result_summary", sa.String, nullable=True),
        sa.Column("error_summary", sa.String, nullable=True),
        sa.Column("pending_input_question", sa.String, nullable=True),
        sa.Column("pending_approval_payload", sa.JSON, nullable=True),
        sa.Column("token_budget", sa.Integer, nullable=True),
        sa.Column("tokens_used", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.Column("completed_at", sa.DateTime, nullable=True),
    )
    op.create_index("idx_tasks_status", "tasks", ["workspace_id", "status", "updated_at"])
    op.create_index("idx_tasks_assignee", "tasks", ["workspace_id", "assignee_id", "status"])
    op.create_index("idx_tasks_parent", "tasks", ["parent_task_id"])


def downgrade() -> None:
    op.drop_index("idx_tasks_parent", table_name="tasks")
    op.drop_index("idx_tasks_assignee", table_name="tasks")
    op.drop_index("idx_tasks_status", table_name="tasks")
    op.drop_table("tasks")
