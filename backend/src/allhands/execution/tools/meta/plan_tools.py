"""Plan family meta tools — agent's working memo (§ 5.2 of agent-design spec).

The spec calls for `plan_view` to return a Render payload driving the
`PlanTimeline` frontend component. These tool declarations expose the schema
to the agent; the actual call wiring (service resolution, render payload
construction) lives in `execution/tools/meta/handlers.py`-style glue — kept
out of the declaration module for the same reason other meta tools do.

Reference: Claude Code's TodoWrite tool is the same "agent tracks its own
plan, user sees it, no confirmation required" shape.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

PLAN_CREATE_TOOL = Tool(
    id="allhands.meta.plan_create",
    kind=ToolKind.META,
    name="plan_create",
    description=(
        "Create your own todo list for the current task — short title + ordered "
        "step descriptions (1-20). Returns plan_id. Use this for any non-trivial "
        "request (3+ steps). After creating, IMMEDIATELY proceed to execute step 1; "
        "do NOT wait for user approval. Mark steps with plan_update_step as you "
        "work, and call plan_view occasionally so the user sees the timeline. "
        "This is YOUR working memo — the user observes; they don't approve. "
        "(For approval-gated plans use a confirmation tool, not this one.)"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short plan title."},
            "steps": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 20,
                "description": "Ordered list of step titles.",
            },
        },
        "required": ["title", "steps"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "plan_id": {"type": "string"},
        },
    },
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

PLAN_UPDATE_STEP_TOOL = Tool(
    id="allhands.meta.plan_update_step",
    kind=ToolKind.META,
    name="plan_update_step",
    description=(
        "Update a single plan step. Pass plan_id, step_index (0-based), and the new "
        "status (pending | running | done | skipped | failed). Optional note for "
        "failed / skipped steps."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "plan_id": {"type": "string"},
            "step_index": {"type": "integer", "minimum": 0},
            "status": {
                "type": "string",
                "enum": ["pending", "running", "done", "skipped", "failed"],
            },
            "note": {"type": "string", "description": "Optional short note."},
        },
        "required": ["plan_id", "step_index", "status"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

PLAN_COMPLETE_STEP_TOOL = Tool(
    id="allhands.meta.plan_complete_step",
    kind=ToolKind.META,
    name="plan_complete_step",
    description=(
        "Shortcut — mark a step as 'done'. Equivalent to plan_update_step with status='done'."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "plan_id": {"type": "string"},
            "step_index": {"type": "integer", "minimum": 0},
        },
        "required": ["plan_id", "step_index"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

PLAN_VIEW_TOOL = Tool(
    id="allhands.meta.plan_view",
    kind=ToolKind.META,
    name="plan_view",
    description=(
        "Fetch the current plan. If plan_id is omitted, returns the latest plan for "
        "the current conversation. The response includes a Render payload that draws "
        "the plan as a timeline in the chat UI."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "plan_id": {"type": "string"},
        },
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

ALL_PLAN_TOOLS = [
    PLAN_CREATE_TOOL,
    PLAN_UPDATE_STEP_TOOL,
    PLAN_COMPLETE_STEP_TOOL,
    PLAN_VIEW_TOOL,
]
