"""AgentEvent — internal event stream produced by AgentRunner."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from allhands.core import RenderPayload, ToolCall


class TokenEvent(BaseModel):
    kind: Literal["token"] = "token"
    message_id: str
    delta: str


class ReasoningEvent(BaseModel):
    """Thinking-channel delta from reasoning models.

    Emitted when the underlying chat model returns structured content blocks
    with ``type == "thinking"`` (Anthropic Extended Thinking, Qwen3 enable_thinking,
    DeepSeek-R1 reasoning_content). Kept separate from ``TokenEvent`` so the
    router can wire it to AG-UI's ``REASONING_MESSAGE_CHUNK`` frame instead of
    inlining the raw reasoning string into the user-visible text (the
    ``[{'thinking': ..., 'type': 'thinking'}]`` bug).
    """

    kind: Literal["reasoning"] = "reasoning"
    message_id: str
    delta: str


class ToolCallStartEvent(BaseModel):
    kind: Literal["tool_call_start"] = "tool_call_start"
    tool_call: ToolCall


class ToolCallEndEvent(BaseModel):
    kind: Literal["tool_call_end"] = "tool_call_end"
    tool_call: ToolCall


class ConfirmRequiredEvent(BaseModel):
    kind: Literal["confirm_required"] = "confirm_required"
    confirmation_id: str
    tool_call_id: str
    summary: str
    rationale: str
    diff: dict[str, object] | None = None


class ConfirmResolvedEvent(BaseModel):
    kind: Literal["confirm_resolved"] = "confirm_resolved"
    confirmation_id: str
    status: str


class InterruptEvent(BaseModel):
    """Graph paused at a LangGraph ``interrupt()`` call (ADR 0014 · Phase 3).

    Semantically equivalent to ``ConfirmRequiredEvent`` but generalised — any
    node/tool can emit an ``interrupt(value)`` and the resume payload isn't
    constrained to "approve" / "reject". Phase 4 will migrate ConfirmationGate
    onto this primitive so there's exactly one pause mechanism;
    ConfirmRequiredEvent stays for backward compatibility during the rollout.

    ``interrupt_id`` is LangGraph's own id (stable across the pause), used by
    the frontend to match a later resume decision to the right suspension.
    ``value`` is whatever the node passed to ``interrupt()`` — shape is agent-
    defined, the runner just forwards it.
    """

    kind: Literal["interrupt_required"] = "interrupt_required"
    interrupt_id: str
    value: dict[str, object]


class UserInputRequiredEvent(BaseModel):
    """ADR 0019 C3 · clarification request paused mid-turn.

    Mirrors ``ConfirmRequiredEvent`` shape but carries multiple-choice
    questions instead of a single approve/reject summary. Frontend
    renders the ``UserInputDialog`` which POSTs answers back to
    /api/user-input/{id}/answer.
    """

    kind: Literal["user_input_required"] = "user_input_required"
    user_input_id: str
    tool_call_id: str
    questions: list[dict[str, object]]


class RenderEvent(BaseModel):
    kind: Literal["render"] = "render"
    message_id: str
    payload: RenderPayload


class NestedRunStartEvent(BaseModel):
    kind: Literal["nested_run_start"] = "nested_run_start"
    run_id: str
    parent_run_id: str | None
    employee_name: str


class NestedRunEndEvent(BaseModel):
    kind: Literal["nested_run_end"] = "nested_run_end"
    run_id: str
    status: str


class TraceEvent(BaseModel):
    kind: Literal["trace"] = "trace"
    trace_id: str
    url: str | None = None


class ErrorEvent(BaseModel):
    kind: Literal["error"] = "error"
    code: str
    message: str


class DoneEvent(BaseModel):
    kind: Literal["done"] = "done"
    message_id: str
    reason: Literal["done", "max_iterations", "error"] = "done"


class LLMCallEvent(BaseModel):
    """Per-turn LLM telemetry · piped through the legacy AgentEvent stream.

    Carries the model identifier, wall-clock duration, and per-call token
    counts (input / output / total) so chat_service can accumulate run-level
    totals and write a per-call ``llm.call`` event to the trace ledger. NOT
    forwarded to AG-UI — the translator drops it (front-end has no direct
    use; trace viewer reads it from the events table).
    """

    kind: Literal["llm_call"] = "llm_call"
    message_id: str
    model_ref: str | None = None
    duration_s: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


AgentEvent = (
    TokenEvent
    | ReasoningEvent
    | ToolCallStartEvent
    | ToolCallEndEvent
    | ConfirmRequiredEvent
    | ConfirmResolvedEvent
    | InterruptEvent
    | UserInputRequiredEvent
    | RenderEvent
    | NestedRunStartEvent
    | NestedRunEndEvent
    | TraceEvent
    | ErrorEvent
    | DoneEvent
    | LLMCallEvent
)


class ArtifactChangedEvent(BaseModel):
    """Fan-out envelope for artifact writes (I-0005).

    Published on the in-process EventBus as ``kind="artifact_changed"`` by
    ``ArtifactService`` at the end of each write path so ``ArtifactPanel`` can
    live-refresh via ``/api/artifacts/stream`` instead of polling. Lives here
    (next to the AgentEvent family) so the wire shape has a single home;
    not part of the AgentEvent union because it is workspace-level, not
    conversation-scoped.
    """

    kind: Literal["artifact_changed"] = "artifact_changed"
    workspace_id: str
    artifact_id: str
    artifact_kind: str
    op: Literal["created", "updated", "deleted", "pinned"]
    version: int
    conversation_id: str | None = None
