"""ADR 0018 · Internal event → AG-UI wire event translator.

Internal events (`execution/internal_events.py`) carry conversation
truth — terminal Message commits + preview deltas. AG-UI events
(`api/ag_ui_encoder.py`) carry frontend rendering instructions in the
shape the React UI consumes today.

This module is the only place the two protocols touch. ``execution/``
and ``services/`` deal in InternalEvent; SSE encoding goes through
this translator. Mapping is one-way; persistence / event ledger writes
consume the InternalEvent stream directly (chat_service tap), not the
AG-UI projection — internal events carry richer typed payloads.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from allhands.api.ag_ui_encoder import (
    AgUiEvent,
    custom,
    reasoning_message_chunk,
    run_error,
    run_finished,
    text_message_content,
    tool_call_args,
    tool_call_end,
    tool_call_result,
    tool_call_start,
)
from allhands.core.conversation import ToolUseBlock
from allhands.execution.internal_events import (
    AssistantMessageCommitted,
    AssistantMessagePartial,
    ConfirmationRequested,
    InternalEvent,
    LLMCallFinished,
    LoopExited,
    ToolCallProgress,
    ToolMessageCommitted,
    UserInputRequested,
)


def _serialize(value: Any) -> str:
    """Render a tool input / result for the wire.

    AG-UI's TOOL_CALL_ARGS / TOOL_CALL_RESULT carry strings (the wire
    is JSON-over-SSE; structured payloads get JSON-encoded once here).
    """
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def translate_to_agui(
    event: InternalEvent,
    *,
    thread_id: str,
    run_id: str,
) -> Iterator[AgUiEvent]:
    """Project one internal event onto zero or more AG-UI wire events.

    ``thread_id`` + ``run_id`` come from the surrounding HTTP request
    context (chat router). They're required by RUN_FINISHED so the
    frontend can correlate the SSE close to its open request.
    """
    if isinstance(event, AssistantMessagePartial):
        if event.text_delta:
            yield text_message_content(event.message_id, event.text_delta)
        if event.reasoning_delta:
            yield reasoning_message_chunk(event.message_id, event.reasoning_delta)
        return

    if isinstance(event, AssistantMessageCommitted):
        # Project tool_use blocks into TOOL_CALL_START + TOOL_CALL_ARGS
        # pairs. Text content was already streamed via partials; the
        # commit doesn't re-emit it on the wire.
        for block in event.message.content_blocks:
            if isinstance(block, ToolUseBlock):
                yield tool_call_start(block.id, block.name)
                yield tool_call_args(block.id, _serialize(block.input))
        return

    if isinstance(event, ToolMessageCommitted):
        msg = event.message
        tool_use_id = msg.tool_call_id or ""
        yield tool_call_end(tool_use_id)
        yield tool_call_result(tool_use_id, _serialize(msg.content))
        return

    if isinstance(event, ToolCallProgress):
        # Args streaming for atomic-content-block providers (Anthropic).
        # Wire shape is the same as the post-commit ARGS event; UI
        # accumulates deltas if it sees both.
        yield tool_call_args(event.tool_use_id, event.args_delta)
        return

    if isinstance(event, UserInputRequested):
        yield custom(
            "allhands.user_input_required",
            {
                "user_input_id": event.user_input_id,
                "tool_call_id": event.tool_use_id,
                "questions": event.questions,
            },
        )
        return

    if isinstance(event, ConfirmationRequested):
        # Wire shape preserves what the legacy InterruptConfirmationGate
        # emitted as its CUSTOM event so the frontend dialog code stays
        # untouched during this refactor.
        yield custom(
            "allhands.confirm_required",
            {
                "confirmation_id": event.confirmation_id,
                "tool_call_id": event.tool_use_id,
                "summary": event.summary,
                "rationale": event.rationale,
                "diff": event.diff,
            },
        )
        return

    if isinstance(event, LoopExited):
        if event.reason == "completed":
            yield run_finished(thread_id=thread_id, run_id=run_id)
        else:
            yield run_error(
                message=event.detail or event.reason,
                code=event.reason.upper(),
            )
        return

    if isinstance(event, LLMCallFinished):
        # Per-call telemetry — token totals, duration, model. Surfaces as a
        # custom event the frontend / observatory can subscribe to without
        # the persistence tap being the only consumer (R1 review · C5).
        yield custom(
            "allhands.llm_call_finished",
            {
                "message_id": event.message_id,
                "model_ref": event.model_ref,
                "duration_s": event.duration_s,
                "input_tokens": event.input_tokens,
                "output_tokens": event.output_tokens,
                "total_tokens": event.total_tokens,
            },
        )
        return

    # Exhaustiveness guard. Adding a new InternalEvent variant without an
    # arm here previously fell through silently — the R1 review caught
    # `LLMCallFinished` being dropped this way for months. Now any future
    # variant raises at runtime in dev / tests so the omission is loud.
    raise NotImplementedError(
        f"ag_ui_translator missing arm for InternalEvent {type(event).__name__}"
    )


__all__ = ["translate_to_agui"]
