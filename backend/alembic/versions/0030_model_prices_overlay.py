"""Add model_prices runtime overlay table.

Revision ID: 0030
Revises: 0029
Create Date: 2026-04-27

为什么需要 overlay 表(2026-04-27):
``services/model_pricing.py`` 是代码内置的小白名单 · 厂商调价时只能改代码 +
重新发版,这对运行中的部署不友好。新建 ``model_prices`` 作为运行时覆盖层:
  - 命中 DB → 用 DB 价格
  - 未命中 → fallback 到代码字典(语义不变)
  - 不在两处 → 0.0(UI 显示 "—")
``source_url`` 强制 curator Agent 引用一手页(透明 + 可审)
``updated_by_run_id`` 链回 Observatory 的 trace · 谁改的、什么时候、跑的哪步
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "model_prices",
        sa.Column("model_ref", sa.String(length=128), primary_key=True),
        sa.Column("input_per_million_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("output_per_million_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("source_url", sa.String(length=1024), nullable=True),
        sa.Column("note", sa.String(length=2000), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("updated_by_run_id", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_model_prices_updated_at", "model_prices", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_model_prices_updated_at", table_name="model_prices")
    op.drop_table("model_prices")
