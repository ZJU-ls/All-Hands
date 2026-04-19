"""API protocol schemas. Kept in sync with web/lib/protocol.ts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class CreateConversationRequest(BaseModel):
    employee_id: str


class ConversationResponse(BaseModel):
    id: str
    employee_id: str
    title: str | None = None
    created_at: str


class SendMessageRequest(BaseModel):
    content: str


class ConfirmationDecisionRequest(BaseModel):
    decision: Literal["approve", "reject"]


class ConfirmationResponse(BaseModel):
    id: str
    tool_call_id: str
    summary: str
    rationale: str
    diff: dict[str, Any] | None = None
    status: str
    created_at: str
    expires_at: str


class ErrorResponse(BaseModel):
    code: str
    message: str


# ---------------------------------------------------------------------------
# Render-tool payload schemas
# ---------------------------------------------------------------------------
#
# The `component` field of a RenderPayload targets a named React component in
# web/lib/component-registry.ts. Each supported `component` has a matching
# Props model here so backend executors can build the payload by name rather
# than by ad-hoc dicts. web/lib/protocol.ts carries the TypeScript twin — the
# schema-parity check in tests/integration/test_render_protocol.py keeps the
# two in lock-step.


EmployeeCardStatus = Literal["draft", "active", "paused"]


class EmployeeCardModelRef(BaseModel):
    provider: str
    name: str


class EmployeeCardProps(BaseModel):
    """Props for the EmployeeCard render component (see I-0008).

    Consumed by the `create_employee` meta tool wrapper: after an employee is
    created, the meta tool returns
    `{component: "EmployeeCard", props: EmployeeCardProps(...).model_dump()}`
    so Lead's chat surface can render the new employee inline.
    """

    employee_id: str
    name: str
    role: str | None = None
    avatar_initial: str | None = None
    system_prompt_preview: str | None = None
    skill_count: int | None = None
    tool_count: int | None = None
    model: EmployeeCardModelRef | None = None
    status: EmployeeCardStatus | None = None
