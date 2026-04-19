"""Render tool: render_plan — PlanCard envelope with Approve / Reject / Edit.

Spec: docs/specs/agent-runtime-contract.md § 6.1.

Two execution modes, one tool (same shape as spec § 6.1 Approve 回流):
- Default (no `decision`): stamp each step with status="pending" (unless the
  caller supplied one) and return a PlanCard ready for human review.
- `decision="approve" | "reject"`: override every step status with the decision
  outcome · this is the re-invocation path from the frontend button click.

Ref: ref-src-claude/V04-tool-call-mechanism.md § 2.2.2 · internal tools resolve
by name · render_plan coexists with the older plan_create/PlanTimeline pair
(`plan_create` = agent's internal memo · `render_plan` = awaiting-human card).
"""

from __future__ import annotations

from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.builtin.render_plan",
    kind=ToolKind.RENDER,
    name="render_plan",
    description=(
        "Emit a PlanCard that asks the user to approve a plan before any "
        "side-effecting step runs. Use when you need explicit human sign-off "
        "on a multi-step strategy; use render_steps for a read-only progress "
        "indicator and plan_create for internal progress memos instead."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "plan_id": {
                "type": "string",
                "description": "Stable id for this plan (used by the approve round-trip).",
            },
            "title": {"type": "string", "maxLength": 160},
            "steps": {
                "type": "array",
                "minItems": 1,
                "maxItems": 20,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "title": {"type": "string", "maxLength": 120},
                        "body": {"type": "string", "maxLength": 2000},
                        "status": {
                            "type": "string",
                            "enum": ["pending", "approved", "rejected"],
                            "default": "pending",
                        },
                    },
                    "required": ["id", "title"],
                },
            },
            "decision": {
                "type": "string",
                "enum": ["approve", "reject"],
                "description": (
                    "Approve/Reject round-trip · second call from the PlanCard "
                    "button click (spec § 6.1). Omit on initial emission."
                ),
            },
        },
        "required": ["plan_id", "title", "steps"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "component": {"type": "string"},
            "props": {"type": "object"},
            "interactions": {"type": "array"},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


_DECISION_TO_STATUS: dict[str, str] = {"approve": "approved", "reject": "rejected"}


async def execute(
    plan_id: str,
    title: str,
    steps: list[dict[str, Any]],
    decision: str | None = None,
) -> dict[str, object]:
    override = _DECISION_TO_STATUS.get(decision) if decision else None
    normalized_steps: list[dict[str, Any]] = []
    for step in steps:
        normalized_steps.append(
            {
                "id": str(step["id"]),
                "title": str(step["title"]),
                "body": str(step.get("body", "")),
                "status": override or str(step.get("status", "pending")),
            }
        )

    approve_payload = {
        "tool": "allhands.builtin.render_plan",
        "args": {"plan_id": plan_id, "title": title, "steps": steps, "decision": "approve"},
    }
    reject_payload = {
        "tool": "allhands.builtin.render_plan",
        "args": {"plan_id": plan_id, "title": title, "steps": steps, "decision": "reject"},
    }
    edit_payload = {"text": f"Please revise plan {plan_id}: "}

    return {
        "component": "PlanCard",
        "props": {
            "plan_id": plan_id,
            "title": title,
            "steps": normalized_steps,
        },
        "interactions": [
            {
                "kind": "button",
                "label": "Approve",
                "action": "invoke_tool",
                "payload": approve_payload,
            },
            {
                "kind": "button",
                "label": "Reject",
                "action": "invoke_tool",
                "payload": reject_payload,
            },
            {
                "kind": "button",
                "label": "Edit",
                "action": "send_message",
                "payload": edit_payload,
            },
        ],
    }
