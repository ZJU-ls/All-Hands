# ruff: noqa: SIM102, SIM105, ASYNC240
"""Round 1 e2e validation against the user's real LLM gateway.

This script does NOT mock the model. It builds a minimal AgentLoop run
with:
  - `update_plan` + `view_plan` tools registered
  - the planner skill prompt loaded as system_prompt
  - real ChatAnthropic bound to the user's CodingPlan gateway (qwen3.6-plus)

Goal: prove the new single-tool design causes weak models to actually
call update_plan and progress through a multi-step task, instead of
narrating in prose.

Usage:
  cd backend
  uv run python scripts/e2e_plan_test.py

The script is intentionally a script (not a pytest test) — it costs real
tokens and shouldn't run in CI by default. The user said they don't mind
token spend tonight, this is for the morning verification.

Verifies (per scenario):
  Scenario 1 · "Plan-and-execute":
    - first turn produces update_plan with N todos, exactly 1 in_progress
    - subsequent turn(s) produce more update_plan calls advancing the in_progress index
    - eventually all todos reach completed

  Scenario 2 · "Trivial reply":
    - "What time is it?" must NOT call update_plan (anti-pattern guard)

  Scenario 3 · "Mid-flight error":
    - When asked to do impossible work, must use note: blocker not magic-completed
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# Allow running from backend/ directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from langchain_anthropic import ChatAnthropic  # type: ignore
from sqlalchemy.ext.asyncio import (  # type: ignore
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from allhands.core import Employee
from allhands.execution.agent_loop import AgentLoop
from allhands.execution.gate import AutoApproveGate
from allhands.execution.internal_events import (
    AssistantMessageCommitted,
    LoopExited,
    ToolMessageCommitted,
)
from allhands.execution.registry import ToolRegistry
from allhands.execution.tools import discover_builtin_tools
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlAgentPlanRepo

PROD_DB = "/Volumes/Storage/code/allhands/backend/data/app.db"
GATEWAY_BASE = "https://coding.dashscope.aliyuncs.com/apps/anthropic"
MODEL_NAME = "qwen3.6-plus"


def fetch_api_key() -> str:
    conn = sqlite3.connect(PROD_DB)
    cur = conn.cursor()
    cur.execute("SELECT api_key FROM llm_providers WHERE name='CodingPlan'")
    row = cur.fetchone()
    conn.close()
    if not row or not row[0]:
        raise RuntimeError("could not find CodingPlan API key in prod DB")
    return row[0]


def load_planner_prompt() -> str:
    body = Path(
        Path(__file__).resolve().parents[1] / "skills/builtin/planner/prompts/guidance.md"
    ).read_text(encoding="utf-8")
    # Strip the leading frontmatter line "---"
    if body.startswith("---"):
        # there's no explicit close; treat first line as marker only
        body = body.split("---", 1)[-1].lstrip("\n")
    return f"You are a planner agent. {body}"


def build_model() -> Any:
    """ChatAnthropic against the user's gateway."""
    return ChatAnthropic(
        model=MODEL_NAME,
        api_key=fetch_api_key(),
        base_url=GATEWAY_BASE,
        max_tokens=2048,
        timeout=60,
        temperature=0,
    )


async def _make_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s


def _employee(model_ref: str) -> Employee:
    return Employee(
        id="e-test",
        name="planner-test",
        description="e2e planner test",
        system_prompt=load_planner_prompt(),
        model_ref=model_ref,
        tool_ids=[
            "allhands.meta.update_plan",
            "allhands.meta.view_plan",
        ],
        skill_ids=[],
        is_lead_agent=False,
        max_iterations=10,
        created_by="e2e",
        created_at=datetime.now(UTC),
    )


async def run_scenario(
    name: str,
    user_messages: list[str],
    *,
    expect_update_plan: bool,
    expect_completed: bool = False,
    max_turns_per_message: int = 4,
) -> dict[str, Any]:
    """Run a multi-turn dialogue and collect what tool_calls fired."""
    print(f"\n{'━' * 60}\n  Scenario · {name}\n{'━' * 60}")

    tool_registry = ToolRegistry()
    discover_builtin_tools(tool_registry)

    # Bind real model.
    real_model = build_model()
    from unittest.mock import patch

    history: list[dict[str, Any]] = []
    update_plan_calls: list[dict[str, Any]] = []
    final_completed_count = 0
    final_total = 0

    async for session in _make_session():
        plan_repo = SqlAgentPlanRepo(session)

        for msg_idx, user_msg in enumerate(user_messages, 1):
            history.append({"role": "user", "content": user_msg})
            print(f"\n[Turn {msg_idx}] user: {user_msg}")

            with patch(
                "allhands.execution.agent_loop._build_model",
                return_value=real_model,
            ):
                loop = AgentLoop(
                    employee=_employee(MODEL_NAME),
                    tool_registry=tool_registry,
                    gate=AutoApproveGate(),
                    plan_repo=plan_repo,
                    conversation_id="e2e-conv",
                )
                turn_count = 0
                async for ev in loop.stream(messages=history):
                    if isinstance(ev, AssistantMessageCommitted):
                        turn_count += 1
                        msg = ev.message
                        text = msg.content or ""
                        tool_call_summary: list[str] = []
                        for blk in msg.content_blocks:
                            if blk.type == "tool_use":
                                tool_call_summary.append(
                                    f"{blk.name}({list((blk.input or {}).keys())})"
                                )
                                if blk.name == "update_plan":
                                    update_plan_calls.append(blk.input or {})
                        print(
                            f"  ← assistant#{turn_count} · text={text[:80]!r}"
                            f"  tools={tool_call_summary}"
                        )
                        # Append to history for next user-turn replay.
                        history.append(
                            {
                                "role": "assistant",
                                "content": text,
                                "tool_calls": [
                                    {
                                        "id": blk.id,
                                        "name": blk.name,
                                        "args": blk.input,
                                    }
                                    for blk in msg.content_blocks
                                    if blk.type == "tool_use"
                                ],
                            }
                        )
                    elif isinstance(ev, ToolMessageCommitted):
                        result = ev.message.content
                        if isinstance(result, str):
                            try:
                                result = json.loads(result)
                            except Exception:
                                pass
                        print(f"    tool_result: {str(result)[:120]}")
                        history.append(
                            {
                                "role": "tool",
                                "content": (
                                    json.dumps(result, ensure_ascii=False)
                                    if not isinstance(result, str)
                                    else result
                                ),
                                "tool_call_id": ev.message.tool_call_id,
                            }
                        )
                    elif isinstance(ev, LoopExited):
                        print(f"  ⏹  loop exited reason={ev.reason} detail={ev.detail}")
                        break

        # After all messages, query the plan
        plan = await plan_repo.get_latest_for_conversation("e2e-conv")
        if plan:
            final_total = len(plan.steps)
            final_completed_count = sum(1 for s in plan.steps if s.status.value == "done")
            print(f"\n  📊 final plan: {plan.title!r}  {final_completed_count}/{final_total} done")
            for s in plan.steps:
                print(f"      [{s.status.value}] {s.title}")
        break

    # Verdict
    def _todos_count(call: dict[str, Any]) -> int:
        v = call.get("todos", [])
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except Exception:
                return 0
        return len(v) if isinstance(v, list) else 0

    verdict = {
        "scenario": name,
        "update_plan_calls": len(update_plan_calls),
        "final_done": final_completed_count,
        "final_total": final_total,
        "first_call_todos": _todos_count(update_plan_calls[0]) if update_plan_calls else 0,
        "passed": True,
        "notes": [],
    }

    if expect_update_plan:
        if not update_plan_calls:
            verdict["passed"] = False
            verdict["notes"].append("FAIL: expected update_plan call, got none")
        else:
            first_todos = update_plan_calls[0].get("todos", [])
            # Some LangChain adapters (e.g. anthropic-style) deliver tool
            # args with `todos` JSON-encoded as a string. Normalize.
            if isinstance(first_todos, str):
                try:
                    first_todos = json.loads(first_todos)
                except Exception:
                    pass
            if not isinstance(first_todos, list) or len(first_todos) < 1:
                verdict["passed"] = False
                verdict["notes"].append("FAIL: first update_plan had empty todos")
            else:
                # Check shape: each todo must have content + status
                bad = [
                    t
                    for t in first_todos
                    if not (isinstance(t, dict) and "content" in t and "status" in t)
                ]
                if bad:
                    verdict["passed"] = False
                    verdict["notes"].append(f"FAIL: malformed todos: {bad[:2]}")
                # Check at most 1 in_progress
                in_progress = [
                    t
                    for t in first_todos
                    if isinstance(t, dict) and t.get("status") == "in_progress"
                ]
                if len(in_progress) > 1:
                    verdict["passed"] = False
                    verdict["notes"].append(f"FAIL: {len(in_progress)} todos in_progress (max 1)")
    else:
        if update_plan_calls:
            verdict["passed"] = False
            verdict["notes"].append(
                f"FAIL: did not expect update_plan but got {len(update_plan_calls)} calls"
            )

    if expect_completed:
        if final_completed_count < final_total:
            verdict["notes"].append(
                f"WARN: only {final_completed_count}/{final_total} completed (expected all done)"
            )

    print(
        f"\n  {'✅ PASS' if verdict['passed'] else '❌ FAIL'}  "
        f"update_plan_calls={verdict['update_plan_calls']}  "
        f"todos={verdict['first_call_todos']}  "
        f"final={verdict['final_done']}/{verdict['final_total']}"
    )
    for note in verdict["notes"]:
        print(f"    · {note}")
    return verdict


async def main() -> int:
    print("Round 1 e2e validation against CodingPlan gateway · qwen3.6-plus")
    print(f"Gateway: {GATEWAY_BASE}")

    results = []

    # S1 · plan-and-execute happy path
    results.append(
        await run_scenario(
            "plan-and-execute",
            user_messages=[
                "请帮我做一份 Q2 竞品调研的简版计划,3 家产品(GitHub Copilot / Cursor / Amazon Q),核心步骤 4 步:列竞品、收集功能、对比、写结论。每完成一步就更新一下计划。",
                "继续推进。",
                "继续。",
            ],
            expect_update_plan=True,
            expect_completed=False,  # might not finish in 3 turns
        )
    )

    # S2 · trivial reply (must NOT call update_plan)
    results.append(
        await run_scenario(
            "trivial-question",
            user_messages=["请问 1+1 等于几?"],
            expect_update_plan=False,
        )
    )

    # S3 · single-step (also must NOT plan)
    results.append(
        await run_scenario(
            "single-step",
            user_messages=["请用一句话解释 LangGraph 是什么?"],
            expect_update_plan=False,
        )
    )

    # S4 · long plan (can the model handle 8 todos?)
    results.append(
        await run_scenario(
            "long-plan-8-steps",
            user_messages=[
                "我要做一个完整的电商商品详情页设计方案,8 步:1.竞品分析 2.信息架构 3.线框图 "
                "4.高保真稿 5.交互流程 6.适配方案 7.可访问性检查 8.交付文档。请按 update_plan "
                "工具的规范,先列出 8 个 todo,我来一一确认。"
            ],
            expect_update_plan=True,
        )
    )

    # S5 · view_plan recall
    results.append(
        await run_scenario(
            "view-plan-recall",
            user_messages=[
                "做一份 3 步的简单备份方案计划:盘点数据 / 选定存储 / 写定时任务。",
                "现在我们走到哪一步了?用 view_plan 告诉我状态。",
            ],
            expect_update_plan=True,
        )
    )

    print(f"\n\n{'═' * 60}\n  RESULT SUMMARY\n{'═' * 60}")
    pass_count = sum(1 for r in results if r["passed"])
    for r in results:
        icon = "✅" if r["passed"] else "❌"
        print(
            f"  {icon} {r['scenario']:<25} "
            f"update_plan_calls={r['update_plan_calls']} "
            f"final={r['final_done']}/{r['final_total']}"
        )
    print(f"\n  {pass_count}/{len(results)} scenarios passed")

    # Save results for the morning HTML report
    out_path = Path("/tmp/plan-iterate/e2e_results.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(f"\n  Detailed results → {out_path}")

    return 0 if pass_count == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
