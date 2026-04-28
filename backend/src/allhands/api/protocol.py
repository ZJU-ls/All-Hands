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
    # Computed at response time by the three-stage resolver (override →
    # employee → workspace default). Lets the model chip show what will
    # actually run instead of just echoing the override field — the two
    # diverge whenever the override / employee ref points at an
    # unconfigured provider/model and resolution falls through to the
    # workspace default. ``None`` only when no provider repo is wired
    # (legacy test paths) — production always populates this.
    effective_model_ref: str | None = None
    effective_model_source: str | None = None
    created_at: str
    # Persisted message count (user + assistant + tool). The history panel
    # renders this as the "N 轮" badge — defaults to 0 so older clients can
    # ignore it. Derived field, not stored on core.Conversation.
    message_count: int = 0
    # 2026-04-28 · run_id of an in-flight agent task for this conversation,
    # or null if no run is active. Frontend reads this on chat-page mount
    # and resubscribes via POST /runs/{id}/subscribe to recover a stream
    # that survived a tab switch / route change / refresh. Computed at
    # response time from the in-process broker registry — not persisted,
    # so a server restart resets to null (intended; the broker is
    # in-memory v0).
    active_run_id: str | None = None


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
    # Optional attachment ids (uploaded via POST /api/attachments). Resolved
    # at runtime by chat_service into ImageBlock / FileBlock entries on the
    # user Message.content_blocks. Empty/None = pure text turn (legacy path).
    attachment_ids: list[str] | None = None
    # Per-turn model knobs (all optional). Scoped to this run only — nothing
    # persists across turns unless the caller threads them again.
    thinking: bool | None = None
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    system_override: str | None = None


class ChatMessageResponse(BaseModel):
    """A single persisted conversation message, as returned by GET/compact.

    Carries render_payloads, tool_calls, and reasoning so a page reload
    rehydrates charts / cards / inline tool chips / thinking-channel replay
    to exactly what the user saw on the live SSE turn. Pre-fix this shape
    was narrow (id / role / content / created_at) on the assumption that
    the live SSE stream was the only render delivery path — that broke
    historical review, trace replay, and "open another tab".
    """

    id: str
    conversation_id: str
    role: str
    content: str
    created_at: str
    # Empty list when the message is text-only. Serialized as the JSON shape
    # of core.RenderPayload (component + props + interactions) so the frontend
    # component-registry can look them up by name.
    render_payloads: list[dict[str, Any]] = []
    # Empty list when the turn triggered no tool calls. Serialized as the
    # JSON shape of core.ToolCall (id / tool_id / args / status / result).
    tool_calls: list[dict[str, Any]] = []
    # None when the underlying model did not produce a thinking channel for
    # this turn. Populated on finalize for Anthropic Extended Thinking /
    # Qwen3 enable_thinking / DeepSeek-R1 reasoning_content.
    reasoning: str | None = None
    # 2026-04-25 · True when the producing turn didn't reach a clean
    # done (user 中止 / network drop / mid-stream error). UI uses this
    # to render an 「已中止」 tail. See core.Message.interrupted.
    interrupted: bool = False
    # Attachment ids on this user-uploaded turn. Empty for assistant/tool
    # rows. Frontend resolves to thumbnail / file chips via /api/attachments.
    attachment_ids: list[str] = []
    # 2026-04-28 · True when manual /compact has soft-flagged this message.
    is_compacted: bool = False


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
