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
    model_ref_override: str | None = None
    created_at: str


class UpdateConversationRequest(BaseModel):
    """Partial update for conversation metadata.

    Only fields provided in the JSON body are touched. An explicit ``null``
    for ``model_ref_override`` clears the override (falls back to the
    employee's model_ref); omitting the field leaves it unchanged. Because
    Pydantic doesn't distinguish "omitted" from "null" in the default model,
    clients send either ``{"clear_model_ref_override": true}`` to clear or
    ``{"model_ref_override": "Provider/model"}`` to set.
    """

    title: str | None = None
    model_ref_override: str | None = None
    clear_model_ref_override: bool = False


class SendMessageRequest(BaseModel):
    """A single user turn sent to the chat streaming endpoint.

    The optional fields are **per-turn** model knobs. They override whatever
    the employee's default config has for this one run — think of them the
    same way the ModelTestDialog "高级参数" drawer does. Unset fields fall
    back to provider / model defaults (no clamping, no 0-defaults — the
    model gets whatever it would have without the field).
    """

    content: str
    # Per-turn model knobs (all optional). Scoped to this run only — nothing
    # persists across turns unless the caller threads them again.
    thinking: bool | None = None
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    system_override: str | None = None


class ChatMessageResponse(BaseModel):
    """A single persisted conversation message, as returned by GET/compact.

    Tool-call / render-payload details are omitted deliberately — the UI
    reconstructs those from its SSE stream for the live turn and doesn't need
    to reload them for a history read. Keep this shape narrow so it stays
    stable as the internal Message model evolves.
    """

    id: str
    conversation_id: str
    role: str
    content: str
    created_at: str


class CompactConversationRequest(BaseModel):
    keep_last: int | None = None


class CompactConversationResponse(BaseModel):
    dropped: int
    summary_id: str | None
    messages: list[ChatMessageResponse]


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


PlanCardStepStatus = Literal["pending", "approved", "rejected"]


class PlanCardStep(BaseModel):
    """One step in a PlanCard (spec § 6.1)."""

    id: str
    title: str
    body: str = ""
    status: PlanCardStepStatus = "pending"


class PlanCardProps(BaseModel):
    """Props for the PlanCard render component (spec § 6.1).

    Emitted by `allhands.builtin.render_plan` when a planner agent needs human
    sign-off before taking side-effecting action. Keep in lock-step with
    `PlanCardProps` in web/lib/protocol.ts.
    """

    plan_id: str
    title: str
    steps: list[PlanCardStep]
