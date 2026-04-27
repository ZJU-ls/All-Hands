"""Task family meta tools — agent-driven CRUD over asynchronous work units.

Spec: `docs/specs/agent-design/2026-04-18-tasks.md` § 5. The executor bindings
live in `allhands.execution.tools.__init__` with a no-op placeholder; actual
wiring to `TaskService` happens in the agent runtime when a real agent run is
scoped to a task. For the schema / description surface (which drives the UI
contract and Lead prompt), these declarations are the source of truth.

Description writing follows Claude Code's TodoWrite conventions (V04):
- Always a **"when to use"** and **"when NOT to use"** section in prose
- params are listed inline in the description for quick glance-while-reasoning
- scope + requires_confirmation match the UI surface (Confirmation Gate shows
  the matching card, so the two must agree)

ref-src: Claude Code V04 TodoWrite / Task / ExitPlanMode — all three teach the
"task description must be specific" + "ask user to confirm interpretation"
pattern that this family inherits.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

_STATUS_ENUM = [
    "queued",
    "running",
    "needs_input",
    "needs_approval",
    "completed",
    "failed",
    "cancelled",
]


TASK_CREATE_TOOL = Tool(
    id="allhands.meta.tasks.create",
    kind=ToolKind.META,
    name="tasks_create",
    description=(
        "Create an asynchronous task assigned to an employee. Returns "
        "`{task_id, status}`. The task runs out-of-band; the user watches "
        "/tasks for progress. Suited for multi-turn work (writing / "
        "research / coordination). For inline single-turn delegation use "
        "`dispatch_employee` instead. `dod` (Definition of Done) drives "
        "automatic acceptance — see the `task_management` skill body for "
        "what makes a good DoD."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "title": {"type": "string", "minLength": 1, "maxLength": 256},
            "goal": {"type": "string", "minLength": 1},
            "dod": {"type": "string", "minLength": 1},
            "assignee_id": {"type": "string"},
            "token_budget": {"type": "integer", "minimum": 1},
        },
        "required": ["title", "goal", "dod", "assignee_id"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "status": {"type": "string"},
        },
    },
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)


TASK_LIST_TOOL = Tool(
    id="allhands.meta.tasks.list",
    kind=ToolKind.META,
    name="tasks_list",
    description=(
        "List tasks in the current workspace. Filter by `status` (one or many of "
        "queued/running/needs_input/needs_approval/completed/failed/cancelled) and/or "
        "`assignee_id`. Returns newest-first (by updated_at). Use to check on long-running "
        "work before deciding whether to create a new task."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "status": {
                "type": "array",
                "items": {"type": "string", "enum": _STATUS_ENUM},
            },
            "assignee_id": {"type": "string"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 100},
        },
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


TASK_GET_TOOL = Tool(
    id="allhands.meta.tasks.get",
    kind=ToolKind.META,
    name="tasks_get",
    description=(
        "Fetch full detail for a task: title, goal, DoD, status, run_ids, artifact_ids, "
        "result_summary (if completed), error_summary (if failed), pending_input_question "
        "(if needs_input). Use after `tasks_list` to drill in, or after `tasks_create` "
        "to confirm persistence."
    ),
    input_schema={
        "type": "object",
        "properties": {"task_id": {"type": "string"}},
        "required": ["task_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


TASK_CANCEL_TOOL = Tool(
    id="allhands.meta.tasks.cancel",
    kind=ToolKind.META,
    name="tasks_cancel",
    description=(
        "Cancel a task. Stops the underlying run; already-produced artifacts are KEPT "
        "(spec § 10 Q3). Use when the task is no longer needed or has gone off the rails. "
        "Provide `reason` (short) — it's stored in the task's error_summary for the "
        "audit trail."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "reason": {"type": "string"},
        },
        "required": ["task_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)


TASK_ANSWER_INPUT_TOOL = Tool(
    id="allhands.meta.tasks.answer_input",
    kind=ToolKind.META,
    name="tasks_answer_input",
    description=(
        "Answer the pending question on a task that's in `needs_input` state. The answer "
        "is injected into the agent's conversation and the task resumes to `running`. "
        "Use this when the user told YOU the answer in chat — then you relay it to the "
        "paused task. Do NOT use if the task is in any state other than needs_input."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "answer": {"type": "string", "minLength": 1},
        },
        "required": ["task_id", "answer"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)


TASK_APPROVE_TOOL = Tool(
    id="allhands.meta.tasks.approve",
    kind=ToolKind.META,
    name="tasks_approve",
    description=(
        "Approve or deny a pending `needs_approval` payload on a task. `decision` is "
        "'approved' or 'denied'; note is optional but recommended for deny. An approved "
        "task resumes running; a denied task enters FAILED with error_summary="
        "'approval denied: <note>'."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "decision": {"type": "string", "enum": ["approved", "denied"]},
            "note": {"type": "string"},
        },
        "required": ["task_id", "decision"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)


TASK_ADD_ARTIFACT_TOOL = Tool(
    id="allhands.meta.tasks.add_artifact",
    kind=ToolKind.META,
    name="tasks_add_artifact",
    description=(
        "Attach an existing artifact to a task. Use when you created/updated an artifact "
        "as part of a task's work and want it surfaced in the task's detail page. "
        "The artifact is not moved, just linked."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "artifact_id": {"type": "string"},
        },
        "required": ["task_id", "artifact_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)


ALL_TASK_META_TOOLS = [
    TASK_CREATE_TOOL,
    TASK_LIST_TOOL,
    TASK_GET_TOOL,
    TASK_CANCEL_TOOL,
    TASK_ANSWER_INPUT_TOOL,
    TASK_APPROVE_TOOL,
    TASK_ADD_ARTIFACT_TOOL,
]
