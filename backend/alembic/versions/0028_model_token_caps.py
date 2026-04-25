"""Add max_input_tokens / max_output_tokens to llm_models.

Revision ID: 0028
Revises: 0027
Create Date: 2026-04-25

为什么拆三列(2026-04-25):
``context_window`` 单列把厂商三个独立概念(总额 / 最大输入 / 最大输出)
压成一个数,UI 上"6 / 64.0k"出现时用户分不清分母在算什么,体验回归。
本迁移把"最大输入"和"最大输出"提升为独立可选列:
  - 都为 NULL → 行为不变,沿用 ``context_window`` 兜底
  - ``max_input_tokens`` 已配 → composer 预算条用它当分母
  - ``max_output_tokens`` 已配 → 出站 chat 请求带上 ``max_tokens=...``
列均 nullable,旧数据零迁移;前端在"高级设置"里露出。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "llm_models",
        sa.Column("max_input_tokens", sa.Integer(), nullable=True),
    )
    op.add_column(
        "llm_models",
        sa.Column("max_output_tokens", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("llm_models", "max_output_tokens")
    op.drop_column("llm_models", "max_input_tokens")
