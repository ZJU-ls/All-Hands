"""Plan meta tool · Claude-Code-style atomic todo list (single-tool design).

Why one tool, not four
----------------------

The first cut had four tools:

  plan_create / plan_update_step / plan_complete_step / plan_view

Per real-model testing on qwen3-plus, the model would reliably call
``plan_create`` and then narrate the rest of the plan in prose, never
calling the per-step tools again. Failure mode: long text reply, no
forward motion. Anthropic's Claude Code TodoWrite ships exactly one tool,
takes the **whole list** every call (atomic replace), and that turns out
to be much easier for weak models to use:

  - the model never has to remember a plan_id + step_index + status enum
  - "to complete step 3, mark it completed in the next call" is a single
    snapshot, not a sequence
  - one in_progress at a time is enforced by the executor, not by
    multi-tool choreography

Reference:
  - github.com/Piebald-AI/claude-code-system-prompts (TodoWrite spec)
  - code.claude.com/docs/en/agent-sdk/todo-tracking (official SDK docs)

Schema
------

  update_plan(todos: [{content, activeForm, status}], title?: str)

  todos          1-20 items
  content        imperative — "Run tests"
  activeForm     present continuous — "Running tests" · UI shows this when in_progress
  status         pending | in_progress | completed
  title          optional · only set on first call

Constraints (validated by executor):
  - exactly 0 or 1 todos with status="in_progress"
  - content / activeForm both non-empty after strip()

Internal mapping to existing AgentPlan:
  - "pending"     → StepStatus.PENDING
  - "in_progress" → StepStatus.RUNNING
  - "completed"   → StepStatus.DONE

Atomic replace semantics:
  - First call: create new AgentPlan for the conversation
  - Subsequent calls: replace the conversation's latest plan's steps
    in place (same plan_id) so the UI keeps refreshing the same panel
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

# ──────────────────────────────────────────────────────────────────────────
# update_plan · the primary plan tool. Claude Code's TodoWrite shape.
# ──────────────────────────────────────────────────────────────────────────

UPDATE_PLAN_DESCRIPTION = """\
Working todo list for the current conversation · the user watches the \
timeline render in chat. Atomic replace: every call sends the COMPLETE \
current todo list (Claude-Code TodoWrite shape). Each todo has \
`content` (imperative · "Run tests"), `activeForm` (present continuous · \
"Running tests"), `status` ("pending" / "in_progress" / "completed"). \
At most one todo may be in_progress at a time. \
See `planner` skill for examples and decision rules.
"""

UPDATE_PLAN_TOOL = Tool(
    id="allhands.meta.update_plan",
    kind=ToolKind.META,
    name="update_plan",
    description=UPDATE_PLAN_DESCRIPTION,
    input_schema={
        "type": "object",
        "properties": {
            "todos": {
                "type": "array",
                "minItems": 1,
                "maxItems": 20,
                "description": "Complete current todo list (atomic replace).",
                "items": {
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 200,
                            "description": "Imperative form, shown when pending / completed.",
                        },
                        "activeForm": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 200,
                            "description": "Present continuous form, shown when in_progress.",
                        },
                        "status": {
                            "type": "string",
                            "enum": ["pending", "in_progress", "completed"],
                        },
                    },
                    "required": ["content", "activeForm", "status"],
                },
            },
            "title": {
                "type": "string",
                "maxLength": 100,
                "description": "Optional plan title. Only set on the first call; later calls inherit the existing title unless this field is explicitly provided.",
            },
        },
        "required": ["todos"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "plan_id": {"type": "string"},
            "summary": {
                "type": "string",
                "description": "Short echo, e.g. '3/5 done · 1 in progress'.",
            },
        },
    },
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)


# ──────────────────────────────────────────────────────────────────────────
# view_plan · read-only fetch · used when chat history is compacted.
# ──────────────────────────────────────────────────────────────────────────

VIEW_PLAN_TOOL = Tool(
    id="allhands.meta.view_plan",
    kind=ToolKind.META,
    name="view_plan",
    description=(
        "Read the current conversation's todo list. Use this if the chat "
        "history was compacted away and you need to recall where you are. "
        "Returns the title + todos array. Returns an error envelope if no "
        "plan exists yet for this conversation."
    ),
    input_schema={
        "type": "object",
        "properties": {},
    },
    output_schema={
        "type": "object",
        "properties": {
            "plan_id": {"type": "string"},
            "title": {"type": "string"},
            "todos": {"type": "array"},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
)


ALL_PLAN_TOOLS = [
    UPDATE_PLAN_TOOL,
    VIEW_PLAN_TOOL,
]


__all__ = [
    "ALL_PLAN_TOOLS",
    "UPDATE_PLAN_TOOL",
    "VIEW_PLAN_TOOL",
]
