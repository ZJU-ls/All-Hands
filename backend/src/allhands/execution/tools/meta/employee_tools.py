"""Meta tools for employee CRUD and dispatch."""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

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
    DISPATCH_EMPLOYEE_TOOL,
]
