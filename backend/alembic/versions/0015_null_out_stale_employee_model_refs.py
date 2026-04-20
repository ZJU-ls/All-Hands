"""null out stale employee model_refs (bailian/* · deepseek/*)

Revision ID: 0015
Revises: 0014
Create Date: 2026-04-20

The v0 seed shipped employees pinned to `bailian/qwen-plus`,
`bailian/qwen-max`, and `deepseek/deepseek-coder` — prefixes that were
placeholders for providers that never got bound. With the current single
CodingPlan provider (kind=aliyun), `build_llm` used to strip those
prefixes blindly and send e.g. ``qwen-plus`` to DashScope, which 400s
because the registered model on that account is ``qwen3.6-plus``.

`resolve_model_name` now falls back to ``provider.default_model`` at
runtime, but the stored refs are still lies. Blanking them means the UI
(employees page, model override chip) shows the truth: "this employee
uses whatever the bound provider recommends".

Only these two known-stale prefixes are cleared; any other custom ref is
left alone (runtime fallback will still handle it gracefully).
"""

from __future__ import annotations

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE employees
        SET model_ref = ''
        WHERE model_ref LIKE 'bailian/%'
           OR model_ref LIKE 'deepseek/%'
        """
    )


def downgrade() -> None:
    # Irreversible — we can't know which original value each row had.
    pass
