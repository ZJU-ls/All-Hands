"""add watched_symbols + holdings + market_snapshots + market_news (Wave 2 · market-data)

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-19

market-data spec § 3.2. Four tables:
- ``watched_symbols``: user watchlist (per-symbol metadata + tag)
- ``holdings``: user positions (symbol + qty + avg_cost)
- ``market_snapshots``: bar cache (interval × ts)
- ``market_news``: news/announcement cache
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watched_symbols",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("symbol", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("tag", sa.String(64), nullable=True),
        sa.Column("added_at", sa.DateTime, nullable=False),
    )
    op.create_index("idx_watched_tag", "watched_symbols", ["tag"])

    op.create_table(
        "holdings",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("symbol", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("avg_cost", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("opened_at", sa.DateTime, nullable=True),
        sa.Column("notes", sa.String(1000), nullable=True),
    )

    op.create_table(
        "market_snapshots",
        sa.Column("symbol", sa.String(32), primary_key=True),
        sa.Column("interval", sa.String(8), primary_key=True),
        sa.Column("ts", sa.DateTime, primary_key=True),
        sa.Column("open", sa.Numeric(18, 4), nullable=True),
        sa.Column("high", sa.Numeric(18, 4), nullable=True),
        sa.Column("low", sa.Numeric(18, 4), nullable=True),
        sa.Column("close", sa.Numeric(18, 4), nullable=True),
        sa.Column("volume", sa.BigInteger, nullable=True),
    )
    op.create_index(
        "idx_snap_symbol_interval",
        "market_snapshots",
        ["symbol", "interval", "ts"],
    )

    op.create_table(
        "market_news",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("symbol", sa.String(32), nullable=True, index=True),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("summary", sa.String(4000), nullable=True),
        sa.Column("url", sa.String(1024), nullable=False),
        sa.Column("published_at", sa.DateTime, nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("fetched_at", sa.DateTime, nullable=False),
        sa.Column("kind", sa.String(16), nullable=False, server_default="news"),
    )
    op.create_index("idx_news_symbol_time", "market_news", ["symbol", "published_at"])


def downgrade() -> None:
    op.drop_index("idx_news_symbol_time", table_name="market_news")
    op.drop_table("market_news")
    op.drop_index("idx_snap_symbol_interval", table_name="market_snapshots")
    op.drop_table("market_snapshots")
    op.drop_table("holdings")
    op.drop_index("idx_watched_tag", table_name="watched_symbols")
    op.drop_table("watched_symbols")
