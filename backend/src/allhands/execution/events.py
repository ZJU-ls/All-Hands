"""AgentEvent — internal event stream produced by AgentRunner."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from allhands.core import RenderPayload, ToolCall


class TokenEvent(BaseModel):
    kind: Literal["token"] = "token"
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


AgentEvent = (
    TokenEvent
    | ToolCallStartEvent
    | ToolCallEndEvent
    | ConfirmRequiredEvent
    | ConfirmResolvedEvent
    | RenderEvent
    | NestedRunStartEvent
    | NestedRunEndEvent
    | TraceEvent
    | ErrorEvent
    | DoneEvent
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
