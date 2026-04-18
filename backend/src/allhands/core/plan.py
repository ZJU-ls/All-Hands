"""AgentPlan domain model — conversation-scoped Plan owned by an employee.

See `docs/specs/agent-design/2026-04-18-agent-design.md` § 5 for the origin.
Plans are the agent's "working notes" — they do not touch external systems,
so the plan mutation tools don't require confirmation. The side effects live
in the business tools the agent invokes between steps.

Step statuses track execution lifecycle:

- `pending`  — not started
- `running`  — currently being worked on (only one per plan in v0)
- `done`     — finished successfully
- `skipped`  — deliberately bypassed (often because previous work made it moot)
- `failed`   — attempted and errored; agent decides whether to retry/replan
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class StepStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    SKIPPED = "skipped"
    FAILED = "failed"


class PlanStep(BaseModel):
    index: int = Field(..., ge=0)
    title: str = Field(..., min_length=1, max_length=512)
    status: StepStatus = StepStatus.PENDING
    note: str | None = None

    model_config = {"frozen": True}


class AgentPlan(BaseModel):
    id: str = Field(..., min_length=1)
    conversation_id: str = Field(..., min_length=1)
    run_id: str | None = None
    owner_employee_id: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1, max_length=512)
    steps: list[PlanStep] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = {"frozen": True}
