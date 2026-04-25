"""ADR 0018 · Internal event protocol for AgentLoop.

Two layers:

* **Terminal events** — persisted, drive state, consumed by services to
  write Message / Confirmation / event ledger rows. Once emitted, the
  underlying message is immutable.

* **Preview events** — ephemeral UX hints. NOT persisted, NOT a state
  mutation. Concatenation across all previews for a given message_id
  MUST equal the corresponding committed message's text content
  (drop-safe: a missing preview only loses live-streaming smoothness).

The translator at ``api/ag_ui_translator.py`` projects these to AG-UI
wire events. ``execution/`` and ``services/`` consume internal events
directly; AG-UI types stay in ``api/``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from allhands.core.conversation import Message

# --- Terminal events --------------------------------------------------------


@dataclass
class AssistantMessageCommitted:
    """An assistant message has been fully assembled and is now immutable.

    ``message.content_blocks`` is authoritative — text, tool_use, and
    reasoning blocks in the order the model emitted them. Any tool_use
    blocks here MUST be executed by the surrounding pipeline before the
    next agent turn.
    """

    message: Message  # role="assistant", content_blocks populated


@dataclass
class ToolMessageCommitted:
    """A tool result has landed for one previously-committed tool_use.

    ``message.tool_call_id`` references the originating ``ToolUseBlock.id``.
    ``message.content`` carries either the structured success payload or
    a synthetic ``{"error": "..."}`` envelope on rejection / failure /
    timeout.
    """

    message: Message  # role="tool", tool_call_id set


@dataclass
class ConfirmationRequested:
    """A deferred tool has published a confirmation request and is now
    awaiting the user's decision. The frontend MUST render a dialog;
    the loop continues to await internally."""

    confirmation_id: str
    tool_use_id: str
    summary: str
    rationale: str
    diff: dict[str, object] | None = None


@dataclass
class UserInputRequested:
    """ADR 0019 C3 · A deferred ``ask_user_question`` tool has published
    a clarification request and is now awaiting the user's answers.

    Mirrors ConfirmationRequested but carries a list of multiple-choice
    questions instead of a single approve/reject summary. Frontend renders
    a structured dialog; on submit POSTs to /api/user-input/{id}/answer
    which flips the row to ANSWERED and unblocks the polling signal.
    """

    user_input_id: str
    tool_use_id: str
    questions: list[dict[str, object]]


LoopExitReason = Literal[
    "completed",
    "max_iterations",
    "aborted",
    "prompt_too_long",
    "stopped_by_hook",
]


@dataclass
class LoopExited:
    """The agent loop has finished or been terminated. Always the last
    event in a stream — services may close persistence handles on this."""

    reason: LoopExitReason
    detail: str | None = None


# --- Preview events ---------------------------------------------------------


@dataclass
class AssistantMessagePartial:
    """Live preview of an in-progress assistant message.

    Either text_delta OR reasoning_delta will be non-empty (not both).
    Frontend uses these to render a live-typing cursor. Aggregation over
    a message_id reconstructs the final text content; drop-safe.
    """

    message_id: str
    text_delta: str = ""
    reasoning_delta: str = ""


@dataclass
class ToolCallProgress:
    """Live preview of a tool_use block's input being streamed.

    Only emitted by providers with atomic content_block_start guarantees
    (Anthropic). OpenAI-compat providers skip this preview to avoid
    leaking phantom tool_calls — for them, the tool_use first surfaces
    in AssistantMessageCommitted (the protocol-level phantom defense).
    """

    tool_use_id: str
    args_delta: str


# --- Union ------------------------------------------------------------------

InternalEvent = (
    AssistantMessageCommitted
    | ToolMessageCommitted
    | ConfirmationRequested
    | UserInputRequested
    | LoopExited
    | AssistantMessagePartial
    | ToolCallProgress
)


__all__ = [
    "AssistantMessageCommitted",
    "AssistantMessagePartial",
    "ConfirmationRequested",
    "InternalEvent",
    "LoopExitReason",
    "LoopExited",
    "ToolCallProgress",
    "ToolMessageCommitted",
    "UserInputRequested",
]


# Suppress "field" import unused warning if linter checks (we may not need
# `field` in this skeleton; left as `from dataclasses import field` for
# downstream extensions).
_ = field
