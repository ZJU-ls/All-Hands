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
Create and manage a structured task list for the current conversation. \
This is YOUR working memo — the user just observes the timeline render in \
chat. Atomic replace: every call sends the COMPLETE current todo list.

WHEN TO USE (proactively):
  • Multi-step tasks with 3+ distinct actions
  • Non-trivial tasks that benefit from progress tracking
  • The user explicitly asks for a plan / todo / checklist
  • The user gives multiple discrete tasks
  • At the START of any complex task — emit the plan, then immediately begin work

WHEN NOT TO USE:
  • Single-step tasks
  • Trivial tasks completable in 1-2 actions
  • Pure conversational / informational replies
  • As an approval gate (it isn't one — the user just watches)

HOW TO USE:
  • Send the COMPLETE list of todos every call (atomic replace, never partial)
  • Each todo has three required fields:
      - content: imperative form (e.g. "Run tests")
      - activeForm: present continuous form for spinner (e.g. "Running tests")
      - status: "pending" | "in_progress" | "completed"
  • EXACTLY ONE todo may be in_progress at any time. As you finish a step:
    in the next update_plan call, mark that step "completed" AND mark the
    next step "in_progress" — same call.
  • Update the plan in real-time at every transition. Do NOT batch up several
    completions before sending an update.
  • Mark a step "completed" ONLY when fully done — tests pass, no errors,
    nothing partial. If blocked, leave it in_progress and add a new pending
    todo describing the blocker.
  • Companion text in your assistant message should be a short status line
    (1-2 sentences) — not a re-statement of the whole plan, the plan card
    already shows that.

EXAMPLES:

  ✅ Initial plan (first todo in_progress, rest pending):
     update_plan(todos=[
       {"content": "Read existing auth code", "activeForm": "Reading existing auth code", "status": "in_progress"},
       {"content": "Add session middleware", "activeForm": "Adding session middleware", "status": "pending"},
       {"content": "Write tests", "activeForm": "Writing tests", "status": "pending"}
     ])

  ✅ After finishing step 1 (atomic replace · note both transitions in ONE call):
     update_plan(todos=[
       {"content": "Read existing auth code", "activeForm": "Reading existing auth code", "status": "completed"},
       {"content": "Add session middleware", "activeForm": "Adding session middleware", "status": "in_progress"},
       {"content": "Write tests", "activeForm": "Writing tests", "status": "pending"}
     ])

  ❌ Don't send only the changed todo (the call replaces the full list).
  ❌ Don't have two todos in_progress at once.
  ❌ Don't mark a todo completed when its work is blocked or partial.
  ❌ Don't use this for a "say hello" type single-reply task.
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
