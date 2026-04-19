"""Meta tools for employee CRUD and dispatch."""

from __future__ import annotations

from typing import Any

from allhands.core import Tool, ToolKind, ToolScope

# Keep in sync with allhands.api.protocol.EmployeeCardProps + web/lib/protocol.ts.
# The parity check in tests/integration/test_render_protocol.py asserts all
# three sources agree on field names.
EMPLOYEE_CARD_COMPONENT = "EmployeeCard"
_PREVIEW_MAX_CHARS = 240
_VALID_STATUSES = ("draft", "active", "paused")


def _truncate_preview(text: str, limit: int = _PREVIEW_MAX_CHARS) -> str:
    stripped = (text or "").strip()
    if len(stripped) <= limit:
        return stripped
    return stripped[: limit - 1].rstrip() + "…"


def _parse_model_ref(model_ref: str | None) -> dict[str, str] | None:
    if not model_ref:
        return None
    provider, _, name = model_ref.partition("/")
    if not name:
        return {"provider": "custom", "name": provider}
    return {"provider": provider, "name": name}


def build_employee_card_render(
    *,
    employee_id: str,
    name: str,
    role: str | None = None,
    system_prompt_preview: str | None = None,
    skill_count: int | None = None,
    tool_count: int | None = None,
    model_ref: str | None = None,
    status: str | None = None,
    avatar_initial: str | None = None,
) -> dict[str, Any]:
    """Shape a create/update employee result into the EmployeeCard render envelope (I-0008).

    Emits ``{component, props, interactions}`` so the resulting message can
    render inline in chat without a round-trip to ``/employees``.
    """

    props: dict[str, Any] = {
        "employee_id": employee_id,
        "name": name,
        "status": status if status in _VALID_STATUSES else "draft",
    }
    if role:
        props["role"] = role
    if avatar_initial:
        props["avatar_initial"] = avatar_initial
    preview = _truncate_preview(system_prompt_preview or "")
    if preview:
        props["system_prompt_preview"] = preview
    if isinstance(skill_count, int):
        props["skill_count"] = skill_count
    if isinstance(tool_count, int):
        props["tool_count"] = tool_count
    model = _parse_model_ref(model_ref)
    if model is not None:
        props["model"] = model

    return {
        "component": EMPLOYEE_CARD_COMPONENT,
        "props": props,
        "interactions": [],
    }


async def execute_create_employee(
    *,
    name: str,
    description: str = "",
    system_prompt: str = "",
    model_ref: str = "openai/gpt-4o-mini",
    tool_ids: list[str] | None = None,
    skill_ids: list[str] | None = None,
    max_iterations: int = 10,
) -> dict[str, Any]:
    """Executor for ``allhands.meta.create_employee``.

    Returns an EmployeeCard render envelope built from the request inputs so
    the Lead's chat surface renders the new employee inline (Tool-First N1).

    Employee persistence still flows through the service/repository layer;
    this executor is the render-tool wrapper over the result so the agent
    surface doesn't have to know about the component registry contract.
    """
    _ = description  # unused in the card preview (description lives on /employees)
    tool_count = len(tool_ids or [])
    skill_count = len(skill_ids or [])
    _ = max_iterations  # reserved for future meta badges (not shown in the card today)
    return build_employee_card_render(
        employee_id=f"pending:{name}",
        name=name,
        system_prompt_preview=system_prompt,
        skill_count=skill_count,
        tool_count=tool_count,
        model_ref=model_ref,
        status="draft",
    )


LIST_EMPLOYEES_TOOL = Tool(
    id="allhands.meta.list_employees",
    kind=ToolKind.META,
    name="list_employees",
    description="List all employees in the system.",
    input_schema={"type": "object", "properties": {}},
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

GET_EMPLOYEE_TOOL = Tool(
    id="allhands.meta.get_employee_detail",
    kind=ToolKind.META,
    name="get_employee_detail",
    description="Get details of a specific employee by name.",
    input_schema={
        "type": "object",
        "properties": {"name": {"type": "string"}},
        "required": ["name"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

CREATE_EMPLOYEE_TOOL = Tool(
    id="allhands.meta.create_employee",
    kind=ToolKind.META,
    name="create_employee",
    description=(
        "Create a new employee. Specify name, description, system_prompt, "
        "and either tool_ids or skill_ids."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "description": {"type": "string"},
            "system_prompt": {"type": "string"},
            "model_ref": {"type": "string", "default": "openai/gpt-4o-mini"},
            "tool_ids": {"type": "array", "items": {"type": "string"}, "default": []},
            "skill_ids": {"type": "array", "items": {"type": "string"}, "default": []},
            "max_iterations": {"type": "integer", "default": 10},
        },
        "required": ["name", "description", "system_prompt"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

UPDATE_EMPLOYEE_TOOL = Tool(
    id="allhands.meta.update_employee",
    kind=ToolKind.META,
    name="update_employee",
    description="Update an existing employee's configuration.",
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "description": {"type": "string"},
            "system_prompt": {"type": "string"},
            "model_ref": {"type": "string"},
            "tool_ids": {"type": "array", "items": {"type": "string"}},
            "skill_ids": {"type": "array", "items": {"type": "string"}},
            "max_iterations": {"type": "integer"},
        },
        "required": ["name"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

DELETE_EMPLOYEE_TOOL = Tool(
    id="allhands.meta.delete_employee",
    kind=ToolKind.META,
    name="delete_employee",
    description="Permanently delete an employee by name.",
    input_schema={
        "type": "object",
        "properties": {"name": {"type": "string"}},
        "required": ["name"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)

PREVIEW_EMPLOYEE_COMPOSITION_TOOL = Tool(
    id="allhands.meta.preview_employee_composition",
    kind=ToolKind.META,
    name="preview_employee_composition",
    description=(
        "Dry-run preview · given a preset id (execute / plan / plan_with_subagent) "
        "and optional custom_tool_ids / custom_skill_ids / custom_max_iterations, "
        "return the fully-expanded {tool_ids, skill_ids, max_iterations} that "
        "would be persisted. Does not touch the DB. See agent-runtime-contract §4.2."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "preset": {
                "type": "string",
                "enum": ["execute", "plan", "plan_with_subagent"],
            },
            "custom_tool_ids": {
                "type": "array",
                "items": {"type": "string"},
                "default": [],
            },
            "custom_skill_ids": {
                "type": "array",
                "items": {"type": "string"},
                "default": [],
            },
            "custom_max_iterations": {
                "type": "integer",
                "minimum": 1,
                "maximum": 50,
            },
        },
        "required": ["preset"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "tool_ids": {"type": "array", "items": {"type": "string"}},
            "skill_ids": {"type": "array", "items": {"type": "string"}},
            "max_iterations": {"type": "integer"},
        },
        "required": ["tool_ids", "skill_ids", "max_iterations"],
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
)


async def execute_preview_employee_composition(
    *,
    preset: str,
    custom_tool_ids: list[str] | None = None,
    custom_skill_ids: list[str] | None = None,
    custom_max_iterations: int | None = None,
) -> dict[str, Any]:
    """Executor for ``allhands.meta.preview_employee_composition``.

    Thin wrapper over :func:`allhands.execution.modes.compose_preview` so the
    Lead Agent and the ``/employees/design`` dry-run panel share one code path.
    """
    from allhands.execution.modes import PRESETS, compose_preview

    if preset not in PRESETS:
        raise ValueError(f"unknown preset: {preset}")
    preview = compose_preview(
        PRESETS[preset],
        custom_tool_ids=custom_tool_ids,
        custom_skill_ids=custom_skill_ids,
        custom_max_iterations=custom_max_iterations,
    )
    return preview.model_dump()


DISPATCH_EMPLOYEE_TOOL = Tool(
    id="allhands.meta.dispatch_employee",
    kind=ToolKind.META,
    name="dispatch_employee",
    description=(
        "Dispatch a task to an employee as a sub-agent. The sub-run gets a fresh "
        "thread_id and does NOT inherit parent conversation history. Returns "
        "{run_id, status, summary, output_refs}. See agent-design § 6."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "employee_id": {
                "type": "string",
                "description": "Employee ID (from list_employees).",
            },
            "task": {
                "type": "string",
                "description": "Clear, self-contained task description for the sub-agent.",
            },
            "context_refs": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional refs to prior run_ids / message_ids for context.",
                "default": [],
            },
            "timeout_seconds": {
                "type": "integer",
                "description": "Sub-run timeout (default 300s).",
                "default": 300,
                "minimum": 1,
            },
        },
        "required": ["employee_id", "task"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

ALL_META_TOOLS = [
    LIST_EMPLOYEES_TOOL,
    GET_EMPLOYEE_TOOL,
    CREATE_EMPLOYEE_TOOL,
    UPDATE_EMPLOYEE_TOOL,
    DELETE_EMPLOYEE_TOOL,
    PREVIEW_EMPLOYEE_COMPOSITION_TOOL,
    DISPATCH_EMPLOYEE_TOOL,
]
