"""Task domain (L4) — asynchronous work unit the user fires-and-forgets.

Spec: `docs/specs/agent-design/2026-04-18-tasks.md`.

Chat (synchronous: user online, streamed tokens) and Task (asynchronous: user
offline, returns result + artifacts) are orthogonal. Both persist; Chat can
produce a Task via `tasks.create`, and a Task that enters `needs_input` can open
a conversation to ask the user back.

State machine:

    queued → running → (needs_input | needs_approval) ↔ running
                    → completed | failed | cancelled  (terminal)

Terminal states require `result_summary` (completed) or `error_summary`
(failed/cancelled with error). `needs_input` requires `pending_input_question`;
`needs_approval` requires `pending_approval_payload`. Invariant enforcement
lives in `TaskService`; this module only defines shapes + legal transitions.

ref-src: Claude Code TodoWrite state machine — minimal states, explicit
transitions. Our `needs_input` / `needs_approval` are extensions TodoWrite
lacks, but the "少状态 + 严格转换" principle carries.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class TaskStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    NEEDS_INPUT = "needs_input"
    NEEDS_APPROVAL = "needs_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES: frozenset[TaskStatus] = frozenset(
    {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED}
)

PENDING_USER_STATUSES: frozenset[TaskStatus] = frozenset(
    {TaskStatus.NEEDS_INPUT, TaskStatus.NEEDS_APPROVAL}
)

ACTIVE_STATUSES: frozenset[TaskStatus] = frozenset(
    {TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.NEEDS_INPUT, TaskStatus.NEEDS_APPROVAL}
)


# (from, to) pairs that are legal.
_LEGAL_TRANSITIONS: frozenset[tuple[TaskStatus, TaskStatus]] = frozenset(
    {
        (TaskStatus.QUEUED, TaskStatus.RUNNING),
        (TaskStatus.QUEUED, TaskStatus.CANCELLED),
        (TaskStatus.RUNNING, TaskStatus.NEEDS_INPUT),
        (TaskStatus.RUNNING, TaskStatus.NEEDS_APPROVAL),
        (TaskStatus.RUNNING, TaskStatus.COMPLETED),
        (TaskStatus.RUNNING, TaskStatus.FAILED),
        (TaskStatus.RUNNING, TaskStatus.CANCELLED),
        (TaskStatus.NEEDS_INPUT, TaskStatus.RUNNING),
        (TaskStatus.NEEDS_INPUT, TaskStatus.CANCELLED),
        (TaskStatus.NEEDS_APPROVAL, TaskStatus.RUNNING),
        (TaskStatus.NEEDS_APPROVAL, TaskStatus.CANCELLED),
        (TaskStatus.NEEDS_APPROVAL, TaskStatus.FAILED),
    }
)


def is_legal_transition(from_status: TaskStatus, to_status: TaskStatus) -> bool:
    if from_status == to_status:
        return True
    return (from_status, to_status) in _LEGAL_TRANSITIONS


class TaskSource(StrEnum):
    USER = "user"
    LEAD = "lead"
    TRIGGER = "trigger"
    EMPLOYEE = "employee"


class Task(BaseModel):
    id: str = Field(..., min_length=1)
    workspace_id: str = Field(default="default", min_length=1)
    title: str = Field(..., min_length=1, max_length=256)
    goal: str = Field(..., min_length=1)
    dod: str = Field(..., min_length=1)

    assignee_id: str = Field(..., min_length=1)
    status: TaskStatus = TaskStatus.QUEUED

    source: TaskSource
    created_by: str = Field(..., min_length=1)
    parent_task_id: str | None = None

    run_ids: list[str] = Field(default_factory=list)
    artifact_ids: list[str] = Field(default_factory=list)
    conversation_id: str | None = None

    result_summary: str | None = None
    error_summary: str | None = None

    pending_input_question: str | None = None
    pending_approval_payload: dict[str, Any] | None = None

    token_budget: int | None = Field(default=None, ge=1)
    tokens_used: int = Field(default=0, ge=0)

    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None

    model_config = {"frozen": True}

    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES

    def needs_user(self) -> bool:
        return self.status in PENDING_USER_STATUSES


__all__ = [
    "ACTIVE_STATUSES",
    "PENDING_USER_STATUSES",
    "TERMINAL_STATUSES",
    "Task",
    "TaskSource",
    "TaskStatus",
    "is_legal_transition",
]
