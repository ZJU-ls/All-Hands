"""add channels + channel_subscriptions + channel_messages tables (Wave 2 · notification-channels)

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-19

notification-channels spec § 3. Three tables:
- ``channels``: one row per registered adapter instance (kind + config_json)
- ``channel_subscriptions``: topic-based routing (channel × topic + filter_json)
- ``channel_messages``: audit log of inbound + outbound messages

All tables are additive; no existing schema touched. SQLite-compatible
(no partial indexes; plain WHERE-less indexes).
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "channels",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("kind", sa.String(32), nullable=False, index=True),
        sa.Column("display_name", sa.String(128), nullable=False),
        sa.Column("config_json", sa.JSON, nullable=False, server_default="{}"),
        sa.Column(
            "inbound_enabled",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "outbound_enabled",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("webhook_secret", sa.String(128), nullable=True),
        sa.Column(
            "auto_approve_outbound",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    op.create_index("idx_channels_kind_enabled", "channels", ["kind", "enabled"])

    op.create_table(
        "channel_subscriptions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "channel_id",
            sa.String(64),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("topic", sa.String(128), nullable=False, index=True),
        sa.Column("filter_json", sa.JSON, nullable=True),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index(
        "idx_channel_subs_topic_enabled",
        "channel_subscriptions",
        ["topic", "enabled"],
    )

    op.create_table(
        "channel_messages",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "channel_id",
            sa.String(64),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("direction", sa.String(8), nullable=False),
        sa.Column("topic", sa.String(128), nullable=True),
        sa.Column("payload_json", sa.JSON, nullable=False, server_default="{}"),
        sa.Column("conversation_id", sa.String(64), nullable=True, index=True),
        sa.Column("external_id", sa.String(128), nullable=True),
        sa.Column("external_user_ref", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.String(2000), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index(
        "idx_channel_messages_channel_time",
        "channel_messages",
        ["channel_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_channel_messages_channel_time", table_name="channel_messages")
    op.drop_table("channel_messages")
    op.drop_index("idx_channel_subs_topic_enabled", table_name="channel_subscriptions")
    op.drop_table("channel_subscriptions")
    op.drop_index("idx_channels_kind_enabled", table_name="channels")
    op.drop_table("channels")
