"""Backfill artifacts.conversation_id from events.run.started payloads.

Revision ID: 0037
Revises: 0036
Create Date: 2026-04-28

修制品孤儿 bug(2026-04-28):
========================
背景:LeadAgent 派子 agent(dispatch_employee / spawn_subagent)时,
``ChatService._build_runner_factory`` 给子 ``AgentRunner`` 没传
``conversation_id``。子 runner 的 ``self._conversation_id=""``,
``allhands.artifacts.create`` 拿到的 conversation_id 是 None,落库
时 ``conversation_id`` 列为 NULL。

后果:聊天右侧的 ArtifactPanel 用 ``listArtifacts(conversationId=...)``
按当前对话过滤,这些 NULL 的孤儿制品被排除 → 用户看到 "0 制品"
但 chat detail 里却能看到刚生成的 html / drawio · 严重不一致。

修复
----
1. ``chat_service.py`` 在 factory 里读 ``_parent_conversation_id``
   ContextVar 传给子 AgentRunner(同 commit 推送)。从此新的子 agent
   产物会带正确 conv_id。
2. 本 migration 回填历史孤儿:对每个 ``conversation_id IS NULL`` 且
   ``created_by_run_id IS NOT NULL`` 的 artifact,从 ``events`` 表里
   找出该 run_id 对应的 ``run.started`` / ``run.completed`` 事件,从
   payload.conversation_id 反查并写回。

回滚:downgrade 是 no-op,因为我们不知道哪些 artifact 是被本迁移修
正的(列里没标记)。即使重新执行 upgrade 也 idempotent — 只回填
仍然 NULL 的行。
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # 1. 找出所有"有 run_id 但 conversation_id 为空"的孤儿 artifacts。
    orphans = bind.execute(
        sa.text(
            """
            SELECT id, created_by_run_id
            FROM artifacts
            WHERE conversation_id IS NULL
              AND created_by_run_id IS NOT NULL
            """
        )
    ).fetchall()
    if not orphans:
        return

    # 2. 一次性把"事件 run_id → conversation_id"的反查表 build 出来。
    # run.started / run.completed payload 都带 conversation_id;run_id
    # 在 payload.run_id 里。subagent run 也走同一套 bus,所以无论是
    # parent 还是 child 都能找到。
    rows = bind.execute(
        sa.text(
            """
            SELECT payload
            FROM events
            WHERE kind IN ('run.started', 'run.completed', 'run.failed')
            """
        )
    ).fetchall()
    run_to_conv: dict[str, str] = {}
    for (raw_payload,) in rows:
        # SQLAlchemy JSON 在 sqlite 下回 dict,在 pg 下也回 dict;
        # 防御性地处理两种形式。
        if isinstance(raw_payload, str):
            try:
                payload = json.loads(raw_payload)
            except (ValueError, TypeError):
                continue
        elif isinstance(raw_payload, dict):
            payload = raw_payload
        else:
            continue
        rid = payload.get("run_id")
        cid = payload.get("conversation_id")
        if rid and cid and rid not in run_to_conv:
            run_to_conv[rid] = cid

    # 3. 回填。每条 artifact 一次 UPDATE — 量级一般 < 1000,不上 batch。
    backfilled = 0
    for art_id, run_id in orphans:
        conv_id = run_to_conv.get(run_id)
        if not conv_id:
            continue
        bind.execute(
            sa.text(
                "UPDATE artifacts SET conversation_id = :cid WHERE id = :aid"
            ),
            {"cid": conv_id, "aid": art_id},
        )
        backfilled += 1

    # 4. 进度日志(打到 alembic stderr,生产环境会留下来)。
    if backfilled:
        op.execute(
            sa.text(
                f"-- artifact orphan backfill: {backfilled} of "
                f"{len(orphans)} rows updated from {len(run_to_conv)} runs"
            )
        )


def downgrade() -> None:
    # No-op: we did not record which rows were touched; reverting would
    # require a marker column the source code doesn't carry.
    pass
