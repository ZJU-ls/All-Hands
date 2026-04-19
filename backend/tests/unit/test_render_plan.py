"""Phase 3 · render_plan render tool + PlanCard envelope.

Spec: docs/specs/agent-runtime-contract.md § 6.1 (render_plan · PlanCard).

Contract highlights under test:
- Tool id `allhands.builtin.render_plan` · kind RENDER · scope READ · no gate
- First call with steps list → envelope `{component: "PlanCard", props, interactions}`
- Each step defaults status="pending" when omitted
- Approve round-trip: second call with `{plan_id, decision: "approve"}` flips
  every step.status to "approved" and keeps title/plan_id stable.
- Props shape matches `allhands.api.protocol.PlanCardProps` (parity guard).

Ref: ref-src-claude/V04-tool-call-mechanism.md § 2.2.2 · internal tools resolve
by name; same-kind tools coexist (render_plan vs plan_create).
Ref: ref-src-claude/V05-skills-system.md § 2.3 · skill bundles a prompt_fragment
that teaches the agent when to reach for the tool (sk_planner fragment tells
the model to always render_plan before side-effecting).
"""

from __future__ import annotations

import pytest

from allhands.core import ToolKind, ToolScope
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry, seed_skills
from allhands.execution.tools import discover_builtin_tools
from allhands.execution.tools.render.plan import TOOL as RENDER_PLAN_TOOL
from allhands.execution.tools.render.plan import execute as render_plan_exec


def test_render_plan_tool_contract() -> None:
    assert RENDER_PLAN_TOOL.id == "allhands.builtin.render_plan"
    assert RENDER_PLAN_TOOL.kind == ToolKind.RENDER
    assert RENDER_PLAN_TOOL.scope == ToolScope.READ
    assert RENDER_PLAN_TOOL.requires_confirmation is False
    # Input schema must require plan_id + title + steps (decision is optional).
    required = RENDER_PLAN_TOOL.input_schema.get("required", [])
    assert set(required) == {"plan_id", "title", "steps"}


def test_render_plan_tool_registered() -> None:
    reg = ToolRegistry()
    discover_builtin_tools(reg)
    tool, _ = reg.get("allhands.builtin.render_plan")
    assert tool.name == "render_plan"


@pytest.mark.asyncio
async def test_render_plan_returns_plan_card_envelope() -> None:
    out = await render_plan_exec(
        plan_id="plan-2026-04-19-abc",
        title="Q2 market research rollout",
        steps=[
            {"id": "s1", "title": "Crawl competitor pages", "body": "scrape top 10"},
            {"id": "s2", "title": "Summarize findings"},
        ],
    )
    assert out["component"] == "PlanCard"
    props = out["props"]
    assert props["plan_id"] == "plan-2026-04-19-abc"
    assert props["title"] == "Q2 market research rollout"
    assert len(props["steps"]) == 2
    # status defaults to "pending" when missing.
    assert all(s["status"] == "pending" for s in props["steps"])
    # Spec § 6.1 envelope exposes 3 interactions: Approve, Reject, Edit.
    actions = {(i["label"], i["action"]) for i in out["interactions"]}
    assert ("Approve", "invoke_tool") in actions
    assert ("Reject", "invoke_tool") in actions
    assert ("Edit", "send_message") in actions


@pytest.mark.asyncio
async def test_render_plan_approve_flips_step_status() -> None:
    """Spec § 6.1 Approve 回流 · second call with decision=approve overrides status."""
    out = await render_plan_exec(
        plan_id="plan-1",
        title="Approve me",
        steps=[
            {"id": "s1", "title": "step 1"},
            {"id": "s2", "title": "step 2"},
        ],
        decision="approve",
    )
    props = out["props"]
    assert props["plan_id"] == "plan-1"
    assert all(s["status"] == "approved" for s in props["steps"])


@pytest.mark.asyncio
async def test_render_plan_reject_flips_step_status() -> None:
    out = await render_plan_exec(
        plan_id="plan-1",
        title="Reject me",
        steps=[{"id": "s1", "title": "step 1"}],
        decision="reject",
    )
    assert all(s["status"] == "rejected" for s in out["props"]["steps"])


@pytest.mark.asyncio
async def test_render_plan_envelope_matches_protocol_model() -> None:
    """Parity guard · envelope props validate against api.protocol.PlanCardProps."""
    from allhands.api.protocol import PlanCardProps

    out = await render_plan_exec(
        plan_id="plan-7",
        title="Parity check",
        steps=[{"id": "s1", "title": "one"}],
    )
    model = PlanCardProps.model_validate(out["props"])
    assert model.plan_id == "plan-7"
    assert model.steps[0].id == "s1"
    assert model.steps[0].status == "pending"


@pytest.mark.asyncio
async def test_render_plan_preserves_step_bodies_and_custom_status() -> None:
    out = await render_plan_exec(
        plan_id="p",
        title="t",
        steps=[{"id": "s1", "title": "T", "body": "B", "status": "approved"}],
    )
    step = out["props"]["steps"][0]
    assert step["body"] == "B"
    assert step["status"] == "approved"


def test_sk_planner_skill_loads_from_manifest() -> None:
    sr = SkillRegistry()
    seed_skills(sr)
    skill = sr.get("sk_planner")
    assert skill is not None
    assert "allhands.builtin.render_plan" in skill.tool_ids
    # prompt_fragment must teach the model "plan before act".
    frag = (skill.prompt_fragment or "").lower()
    assert "render_plan" in frag
    assert "approval" in frag or "approve" in frag
