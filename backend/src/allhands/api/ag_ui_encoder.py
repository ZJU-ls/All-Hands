"""AG-UI Protocol SSE encoder.

One-stop factory + serializer for AG-UI v1 compatible SSE frames. See
ADR 0010 and ``docs/specs/2026-04-19-ag-ui-migration.md`` for the full
event catalogue and the 4-by-N mapping from allhands legacy SSE events
to AG-UI standard types.

Contract:

* Fields named by the AG-UI spec are camelCase **on the wire**
  (messageId, toolCallId, threadId, runId, delta, snapshot, stepName,
  content, patch). Python attributes stay snake_case and map through
  Pydantic aliases; ``model_dump(by_alias=True)`` is what the encoder
  serialises.
* Private allhands payloads travel inside ``CUSTOM.value`` with their
  original snake_case keys -- avoid a repo-wide rename.
* Each event serialises as ``event: <TYPE>\\ndata: <json>\\n\\n``. The
  body always repeats the event type under ``type`` so consumers can
  reconstruct a canonical AG-UI envelope from the data line alone.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

AgUiEventType = Literal[
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_END",
    "TEXT_MESSAGE_CHUNK",
    "TOOL_CALL_START",
    "TOOL_CALL_ARGS",
    "TOOL_CALL_END",
    "TOOL_CALL_RESULT",
    "STATE_SNAPSHOT",
    "STATE_DELTA",
    "MESSAGES_SNAPSHOT",
    "STEP_STARTED",
    "STEP_FINISHED",
    "RUN_STARTED",
    "RUN_FINISHED",
    "RUN_ERROR",
    "REASONING_START",
    "REASONING_MESSAGE_START",
    "REASONING_MESSAGE_CONTENT",
    "REASONING_MESSAGE_END",
    "REASONING_MESSAGE_CHUNK",
    "REASONING_END",
    "RAW",
    "CUSTOM",
]

AG_UI_STANDARD_EVENTS: frozenset[str] = frozenset(
    [
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "TEXT_MESSAGE_CHUNK",
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
        "TOOL_CALL_RESULT",
        "STATE_SNAPSHOT",
        "STATE_DELTA",
        "MESSAGES_SNAPSHOT",
        "STEP_STARTED",
        "STEP_FINISHED",
        "RUN_STARTED",
        "RUN_FINISHED",
        "RUN_ERROR",
        "REASONING_START",
        "REASONING_MESSAGE_START",
        "REASONING_MESSAGE_CONTENT",
        "REASONING_MESSAGE_END",
        "REASONING_MESSAGE_CHUNK",
        "REASONING_END",
        "RAW",
        "CUSTOM",
    ]
)


class AgUiEvent(BaseModel):
    """AG-UI v1 event envelope.

    Python attributes are snake_case; wire field names are camelCase
    via Pydantic aliases. Only fields relevant to the event type are
    populated; every other field is omitted via ``exclude_none``.
    """

    model_config = ConfigDict(extra="forbid")

    type: AgUiEventType
    timestamp: int | None = None

    # Lifecycle / identifiers
    thread_id: str | None = Field(default=None, serialization_alias="threadId")
    run_id: str | None = Field(default=None, serialization_alias="runId")
    message_id: str | None = Field(default=None, serialization_alias="messageId")
    tool_call_id: str | None = Field(default=None, serialization_alias="toolCallId")
    tool_call_name: str | None = Field(default=None, serialization_alias="toolCallName")
    role: str | None = None
    step_name: str | None = Field(default=None, serialization_alias="stepName")

    # Text / reasoning / tool streaming
    delta: str | None = None
    content: str | None = None

    # State snapshots / deltas
    snapshot: dict[str, Any] | None = None
    patch: list[dict[str, Any]] | None = None
    messages: list[dict[str, Any]] | None = None

    # CUSTOM
    name: str | None = None
    value: Any = None

    # RAW wrapper
    source: str | None = None
    event: dict[str, Any] | None = None

    # RUN_ERROR
    message: str | None = None
    code: str | None = None


def encode_sse(evt: AgUiEvent) -> bytes:
    """Serialise an AG-UI event as one SSE frame (utf-8 bytes)."""
    body = evt.model_dump(mode="json", exclude_none=True, by_alias=True)
    frame = f"event: {evt.type}\ndata: {json.dumps(body, ensure_ascii=False)}\n\n"
    return frame.encode()


# ---------------------------------------------------------------------------
# Lifecycle factories
# ---------------------------------------------------------------------------


def run_started(thread_id: str, run_id: str) -> AgUiEvent:
    return AgUiEvent(type="RUN_STARTED", thread_id=thread_id, run_id=run_id)


def run_finished(thread_id: str, run_id: str) -> AgUiEvent:
    return AgUiEvent(type="RUN_FINISHED", thread_id=thread_id, run_id=run_id)


def run_error(message: str, code: str | None = None) -> AgUiEvent:
    return AgUiEvent(type="RUN_ERROR", message=message, code=code)


def step_started(step_name: str) -> AgUiEvent:
    return AgUiEvent(type="STEP_STARTED", step_name=step_name)


def step_finished(step_name: str) -> AgUiEvent:
    return AgUiEvent(type="STEP_FINISHED", step_name=step_name)


# ---------------------------------------------------------------------------
# Text message factories
# ---------------------------------------------------------------------------


def text_message_start(message_id: str, role: str = "assistant") -> AgUiEvent:
    return AgUiEvent(type="TEXT_MESSAGE_START", message_id=message_id, role=role)


def text_message_content(message_id: str, delta: str) -> AgUiEvent:
    return AgUiEvent(type="TEXT_MESSAGE_CONTENT", message_id=message_id, delta=delta)


def text_message_end(message_id: str) -> AgUiEvent:
    return AgUiEvent(type="TEXT_MESSAGE_END", message_id=message_id)


def text_message_chunk(message_id: str, delta: str, role: str = "assistant") -> AgUiEvent:
    return AgUiEvent(type="TEXT_MESSAGE_CHUNK", message_id=message_id, role=role, delta=delta)


# ---------------------------------------------------------------------------
# Reasoning factories
# ---------------------------------------------------------------------------


def reasoning_message_chunk(message_id: str, delta: str) -> AgUiEvent:
    return AgUiEvent(
        type="REASONING_MESSAGE_CHUNK",
        message_id=message_id,
        delta=delta,
        role="assistant",
    )


def reasoning_message_end(message_id: str) -> AgUiEvent:
    return AgUiEvent(type="REASONING_MESSAGE_END", message_id=message_id)


# ---------------------------------------------------------------------------
# Tool call factories
# ---------------------------------------------------------------------------


def tool_call_start(tool_call_id: str, tool_call_name: str) -> AgUiEvent:
    return AgUiEvent(
        type="TOOL_CALL_START",
        tool_call_id=tool_call_id,
        tool_call_name=tool_call_name,
    )


def tool_call_args(tool_call_id: str, delta: str) -> AgUiEvent:
    return AgUiEvent(type="TOOL_CALL_ARGS", tool_call_id=tool_call_id, delta=delta)


def tool_call_end(tool_call_id: str) -> AgUiEvent:
    return AgUiEvent(type="TOOL_CALL_END", tool_call_id=tool_call_id)


def tool_call_result(tool_call_id: str, content: str) -> AgUiEvent:
    return AgUiEvent(type="TOOL_CALL_RESULT", tool_call_id=tool_call_id, content=content)


# ---------------------------------------------------------------------------
# State / extension factories
# ---------------------------------------------------------------------------


def state_snapshot(snapshot: dict[str, Any]) -> AgUiEvent:
    return AgUiEvent(type="STATE_SNAPSHOT", snapshot=snapshot)


def state_delta(patch: list[dict[str, Any]]) -> AgUiEvent:
    return AgUiEvent(type="STATE_DELTA", patch=patch)


def custom(name: str, value: Any) -> AgUiEvent:
    return AgUiEvent(type="CUSTOM", name=name, value=value)


def raw(source: str, event: dict[str, Any]) -> AgUiEvent:
    return AgUiEvent(type="RAW", source=source, event=event)
