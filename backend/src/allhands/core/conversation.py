"""Conversation, Message, ToolCall, RenderPayload domain models."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

MessageRole = Literal["user", "assistant", "tool", "system"]


class ToolCallStatus(StrEnum):
    PENDING = "pending"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    REJECTED = "rejected"


class ToolCall(BaseModel):
    id: str
    tool_id: str
    args: dict[str, object]
    status: ToolCallStatus
    result: object | None = None
    error: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


class InteractionSpec(BaseModel):
    kind: Literal["button", "form_submit", "link"]
    label: str
    action: str  # "invoke_tool" | "send_message" | "navigate"
    payload: dict[str, object] = Field(default_factory=dict)


class RenderPayload(BaseModel):
    component: str
    props: dict[str, object] = Field(default_factory=dict)
    interactions: list[InteractionSpec] = Field(default_factory=list)


class Message(BaseModel):
    id: str
    conversation_id: str
    role: MessageRole
    content: str
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tool_call_id: str | None = None
    render_payloads: list[RenderPayload] = Field(default_factory=list)
    trace_ref: str | None = None
    parent_run_id: str | None = None
    # Populated on finalize when the assistant message came from a
    # thinking-capable model (Anthropic Extended Thinking, Qwen3
    # enable_thinking, DeepSeek-R1). Lets the trace viewer reconstruct the
    # reasoning channel for past runs; live chat still streams via
    # ReasoningEvent / AG-UI REASONING_MESSAGE_CHUNK.
    reasoning: str | None = None
    created_at: datetime


class Conversation(BaseModel):
    id: str
    title: str | None = None
    employee_id: str
    created_at: datetime
    # Per-conversation override for the effective model ref. Priority at
    # dispatch time is: conversation.model_ref_override > employee.model_ref
    # > platform default. `None` (the default) means "inherit the employee's
    # model" — the common case for most chats.
    model_ref_override: str | None = None
    metadata: dict[str, object] = Field(default_factory=dict)
