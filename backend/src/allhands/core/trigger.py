"""Trigger domain model — timer + event auto-dispatch for the digital team.

See docs/specs/agent-design/2026-04-18-triggers.md. A Trigger is either a
cron-scheduled Timer or an Event subscription; firing produces a TriggerFire
record and runs one of four action kinds (dispatch_employee, continue_conversation,
invoke_tool, notify_user). Defense rules (rate limit, auto-disable, cycle,
global limit, pause) live in execution/triggers; the core only models shape.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class TriggerKind(StrEnum):
    TIMER = "timer"
    EVENT = "event"


class TriggerActionType(StrEnum):
    DISPATCH_EMPLOYEE = "dispatch_employee"
    CONTINUE_CONVERSATION = "continue_conversation"
    INVOKE_TOOL = "invoke_tool"
    NOTIFY_USER = "notify_user"


class TriggerAction(BaseModel):
    """Union-by-type description of the side effect a trigger performs.

    Each action kind uses a different subset of the optional fields.
    The executor dispatches on `type` and asserts required fields are present.
    """

    type: TriggerActionType

    # dispatch_employee
    employee_id: str | None = None
    task_template: str | None = None

    # continue_conversation
    conversation_id: str | None = None
    message_template: str | None = None

    # invoke_tool
    tool_id: str | None = None
    args_template: dict[str, Any] | None = None

    # notify_user
    channel: Literal["cockpit"] | None = None
    message: str | None = None

    model_config = {"frozen": True}

    @model_validator(mode="after")
    def _check_required_fields(self) -> TriggerAction:
        if self.type is TriggerActionType.DISPATCH_EMPLOYEE:
            if not self.employee_id or not self.task_template:
                raise ValueError(
                    "dispatch_employee requires employee_id + task_template",
                )
        elif self.type is TriggerActionType.CONTINUE_CONVERSATION:
            if not self.conversation_id or not self.message_template:
                raise ValueError(
                    "continue_conversation requires conversation_id + message_template",
                )
        elif self.type is TriggerActionType.INVOKE_TOOL:
            if not self.tool_id:
                raise ValueError("invoke_tool requires tool_id")
        elif self.type is TriggerActionType.NOTIFY_USER and not self.message:
            raise ValueError("notify_user requires message")
        return self


class TimerSpec(BaseModel):
    cron: str = Field(..., min_length=1, max_length=128)
    timezone: str = Field(default="UTC", min_length=1, max_length=64)

    model_config = {"frozen": True}


class EventPattern(BaseModel):
    """Subscription pattern: exact event kind + field equality / simple glob filter.

    `filter` keys map to event payload fields. Values are matched with `==`
    unless they contain `*` (then fnmatch). v0 does NOT support expression
    languages — keep it flat so the matcher is trivially auditable.
    """

    type: str = Field(..., min_length=1, max_length=128)
    filter: dict[str, Any] = Field(default_factory=dict)

    model_config = {"frozen": True}


MIN_INTERVAL_SECONDS = 60
DEFAULT_MIN_INTERVAL_SECONDS = 300


class Trigger(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    kind: TriggerKind
    enabled: bool = True

    timer: TimerSpec | None = None
    event: EventPattern | None = None

    action: TriggerAction
    min_interval_seconds: int = Field(
        default=DEFAULT_MIN_INTERVAL_SECONDS,
        ge=MIN_INTERVAL_SECONDS,
    )

    fires_total: int = Field(default=0, ge=0)
    fires_failed_streak: int = Field(default=0, ge=0)
    last_fired_at: datetime | None = None
    auto_disabled_reason: str | None = None

    created_at: datetime
    created_by: str = Field(..., min_length=1, max_length=64)

    model_config = {"frozen": True}

    @model_validator(mode="after")
    def _check_kind_spec(self) -> Trigger:
        if self.kind is TriggerKind.TIMER:
            if self.timer is None:
                raise ValueError("kind=timer requires timer spec")
            if self.event is not None:
                raise ValueError("kind=timer cannot have event spec")
        else:  # EVENT
            if self.event is None:
                raise ValueError("kind=event requires event pattern")
            if self.timer is not None:
                raise ValueError("kind=event cannot have timer spec")
        return self


class TriggerFireStatus(StrEnum):
    QUEUED = "queued"
    DISPATCHED = "dispatched"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SUPPRESSED = "suppressed"


class TriggerFireSource(StrEnum):
    TIMER = "timer"
    EVENT = "event"
    MANUAL = "manual"


class TriggerFire(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    trigger_id: str = Field(..., min_length=1, max_length=64)
    fired_at: datetime
    source: TriggerFireSource
    event_payload: dict[str, Any] | None = None
    action_snapshot: TriggerAction
    rendered_task: str | None = None
    run_id: str | None = None
    status: TriggerFireStatus = TriggerFireStatus.QUEUED
    error_code: str | None = None
    error_detail: str | None = None

    model_config = {"frozen": True}


class EventEnvelope(BaseModel):
    """In-process + persisted event. Produced by EventBus.publish.

    Cockpit spec § 7 shares this envelope with the activity feed projection.
    `actor/subject/severity/link/workspace_id` default to None/"info"/"default"
    so triggers' existing ``publish(kind, payload)`` calls stay source-compatible.
    """

    id: str = Field(..., min_length=1, max_length=64)
    kind: str = Field(..., min_length=1, max_length=128)
    payload: dict[str, Any] = Field(default_factory=dict)
    published_at: datetime
    trigger_id: str | None = None  # set when this event was emitted by a TriggerFire
    actor: str | None = None
    subject: str | None = None
    severity: str = "info"
    link: str | None = None
    workspace_id: str = "default"

    model_config = {"frozen": True}
