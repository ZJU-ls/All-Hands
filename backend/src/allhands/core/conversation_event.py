"""ADR 0017 · conversation_events append-only log (Claude Code `{sessionId}.jsonl` equivalent).

This is the authoritative source of truth for conversation history. Classical
``Message`` rows become a *projection cache* of these events (kept for the
frontend's ``/api/conversations/{id}/messages`` endpoint to stay unchanged).

Event kinds are modeled after Claude Code's transcript entries + our
additional needs for turn-lifecycle bookkeeping:

- ``USER`` · user input
- ``ASSISTANT`` · assistant completed message (content + blocks)
- ``TOOL_CALL_REQUESTED`` · assistant emits a tool_use
- ``TOOL_CALL_APPROVED`` · confirmation gate approves
- ``TOOL_CALL_DENIED`` · confirmation gate denies
- ``TOOL_CALL_EXECUTED`` · tool returned successfully
- ``TOOL_CALL_FAILED`` · tool raised
- ``TURN_STARTED`` · assistant turn boundary open
- ``TURN_COMPLETED`` · assistant turn boundary close (normal)
- ``TURN_ABORTED`` · assistant turn boundary close (abnormal). Carries
  ``reason`` ∈ {user_superseded, stream_error, crash_recovery,
  concurrent_write_rejected} + optional partial_content. See plan §1 and
  V02 § 1.3 for the Claude-style 'errors as messages' semantics.
- ``SKILL_ACTIVATED`` · resolve_skill succeeded (runtime mutation recorded)
- ``SYSTEM`` · non-model-facing annotations (UI markers, ops log)
- ``SUMMARY`` · auto-compact replacement for a range of older events
- ``INTERRUPT_RAISED`` · LangGraph interrupt() fired in tool node
- ``INTERRUPT_RESUMED`` · user replied with approve/deny
- ``CONVERSATION_FORKED`` · branch point marker
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class EventKind(StrEnum):
    """All event kinds the log accepts. Order is irrelevant; names are stable."""

    USER = "user"
    ASSISTANT = "assistant"
    TOOL_CALL_REQUESTED = "tool_call_requested"
    TOOL_CALL_APPROVED = "tool_call_approved"
    TOOL_CALL_DENIED = "tool_call_denied"
    TOOL_CALL_EXECUTED = "tool_call_executed"
    TOOL_CALL_FAILED = "tool_call_failed"
    TURN_STARTED = "turn_started"
    TURN_COMPLETED = "turn_completed"
    TURN_ABORTED = "turn_aborted"
    SKILL_ACTIVATED = "skill_activated"
    SYSTEM = "system"
    SUMMARY = "summary"
    INTERRUPT_RAISED = "interrupt_raised"
    INTERRUPT_RESUMED = "interrupt_resumed"
    CONVERSATION_FORKED = "conversation_forked"


class TurnAbortReason(StrEnum):
    """Canonical reasons a turn ended abnormally. Write-side records one of these;
    build_llm_context reads them to decide what synthetic assistant message to
    project (see plan §1)."""

    USER_SUPERSEDED = "user_superseded"
    STREAM_ERROR = "stream_error"
    CRASH_RECOVERY = "crash_recovery"
    CONCURRENT_WRITE_REJECTED = "concurrent_write_rejected"
    CLIENT_DISCONNECT = "client_disconnect"


class ConversationEvent(BaseModel):
    """A single immutable entry in the conversation event log.

    ``content_json`` is the flexible payload — Claude Code's JSONL
    entry.content equivalent. Schema per kind is documented in
    ``services/context_builder.py`` (the sole reader).
    """

    id: str
    conversation_id: str
    parent_id: str | None = None
    sequence: int
    kind: EventKind
    content_json: dict[str, Any] = Field(default_factory=dict)
    subagent_id: str | None = None
    turn_id: str | None = None
    idempotency_key: str | None = None
    is_compacted: bool = False
    created_at: datetime

    model_config = {"frozen": True}
