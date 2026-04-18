"""Trigger meta tools — spec § 5/9.

These tool declarations let the Lead Agent do through chat everything a
user can do on the `/triggers` page (L01 Tool First). They mirror the
REST router 1:1 and delegate to the same TriggerService at execution
time. The 4 write tools declare `scope=WRITE` with
`requires_confirmation=True` — except `toggle_trigger`, whose risk is
pausing/unpausing a single already-approved trigger; the user opted
into that surface when they created it.

`fire_trigger_now` is a WRITE that fires immediately and is used
primarily for debugging; it requires confirmation by default.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

LIST_TRIGGERS_TOOL = Tool(
    id="allhands.meta.list_triggers",
    kind=ToolKind.META,
    name="list_triggers",
    description=(
        "List all triggers (timer + event). Returns id, name, kind, enabled, "
        "cron/event pattern, last_fired_at, failed_streak, auto_disabled_reason."
    ),
    input_schema={"type": "object", "properties": {}},
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

GET_TRIGGER_TOOL = Tool(
    id="allhands.meta.get_trigger",
    kind=ToolKind.META,
    name="get_trigger",
    description="Get full detail of a single trigger by id.",
    input_schema={
        "type": "object",
        "properties": {"trigger_id": {"type": "string"}},
        "required": ["trigger_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

CREATE_TRIGGER_TOOL = Tool(
    id="allhands.meta.create_trigger",
    kind=ToolKind.META,
    name="create_trigger",
    description=(
        "Create a trigger. kind=timer requires `timer.cron` (5-field). "
        "kind=event requires `event.type` (+ optional `event.filter` dict). "
        "`action.type` is one of notify_user | invoke_tool | dispatch_employee | "
        "continue_conversation; include only the fields relevant to that type "
        "(message/channel, tool_id/args_template, employee_id/task_template, "
        "conversation_id/message_template). `min_interval_seconds` defaults "
        "to 300 (spec § 7 rate limit)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string", "minLength": 1, "maxLength": 128},
            "kind": {"type": "string", "enum": ["timer", "event"]},
            "action": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "notify_user",
                            "invoke_tool",
                            "dispatch_employee",
                            "continue_conversation",
                        ],
                    },
                    "message": {"type": "string"},
                    "channel": {"type": "string", "enum": ["cockpit"]},
                    "tool_id": {"type": "string"},
                    "args_template": {"type": "object"},
                    "employee_id": {"type": "string"},
                    "task_template": {"type": "string"},
                    "conversation_id": {"type": "string"},
                    "message_template": {"type": "string"},
                },
                "required": ["type"],
            },
            "timer": {
                "type": "object",
                "properties": {
                    "cron": {"type": "string"},
                    "timezone": {"type": "string", "default": "UTC"},
                },
                "required": ["cron"],
            },
            "event": {
                "type": "object",
                "properties": {
                    "type": {"type": "string"},
                    "filter": {"type": "object"},
                },
                "required": ["type"],
            },
            "min_interval_seconds": {"type": "integer", "minimum": 60, "default": 300},
        },
        "required": ["name", "kind", "action"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

UPDATE_TRIGGER_TOOL = Tool(
    id="allhands.meta.update_trigger",
    kind=ToolKind.META,
    name="update_trigger",
    description=(
        "Partial update: pass only fields you want to change. Kind cannot "
        "switch between timer and event — create a new trigger instead."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "trigger_id": {"type": "string"},
            "name": {"type": "string"},
            "action": {"type": "object"},
            "timer": {"type": "object"},
            "event": {"type": "object"},
            "min_interval_seconds": {"type": "integer", "minimum": 60},
        },
        "required": ["trigger_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

TOGGLE_TRIGGER_TOOL = Tool(
    id="allhands.meta.toggle_trigger",
    kind=ToolKind.META,
    name="toggle_trigger",
    description=(
        "Enable or disable a trigger. Disabling a timer removes its job; "
        "enabling re-schedules it. Event triggers simply stop matching."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "trigger_id": {"type": "string"},
            "enabled": {"type": "boolean"},
        },
        "required": ["trigger_id", "enabled"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

DELETE_TRIGGER_TOOL = Tool(
    id="allhands.meta.delete_trigger",
    kind=ToolKind.META,
    name="delete_trigger",
    description="Permanently delete a trigger and all its fire history.",
    input_schema={
        "type": "object",
        "properties": {"trigger_id": {"type": "string"}},
        "required": ["trigger_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)

FIRE_TRIGGER_NOW_TOOL = Tool(
    id="allhands.meta.fire_trigger_now",
    kind=ToolKind.META,
    name="fire_trigger_now",
    description=(
        "Fire a trigger manually (source=manual). For event triggers, pass an "
        "optional event_payload that stands in for a real event. Respects the "
        "5 defense gates (paused/rate-limit/cycle) just like a natural fire."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "trigger_id": {"type": "string"},
            "event_payload": {"type": "object"},
        },
        "required": ["trigger_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

LIST_TRIGGER_FIRES_TOOL = Tool(
    id="allhands.meta.list_trigger_fires",
    kind=ToolKind.META,
    name="list_trigger_fires",
    description=(
        "Fetch recent fire records for a trigger. Ordered newest-first. Default limit 50, max 200."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "trigger_id": {"type": "string"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
        },
        "required": ["trigger_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

ALL_TRIGGER_META_TOOLS = [
    LIST_TRIGGERS_TOOL,
    GET_TRIGGER_TOOL,
    CREATE_TRIGGER_TOOL,
    UPDATE_TRIGGER_TOOL,
    TOGGLE_TRIGGER_TOOL,
    DELETE_TRIGGER_TOOL,
    FIRE_TRIGGER_NOW_TOOL,
    LIST_TRIGGER_FIRES_TOOL,
]
