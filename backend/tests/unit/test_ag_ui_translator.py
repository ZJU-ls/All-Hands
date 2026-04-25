"""ADR 0018 · Translator unit tests · internal event → AG-UI wire event.

Each test uses a single InternalEvent input and asserts the exact list
of AG-UI events emitted. Wire compatibility with the existing frontend
is the contract — emitted shapes must match what the InterruptConfirmation
+ LangGraph runner stack emits today, so the frontend never sees the
refactor.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from allhands.api.ag_ui_translator import translate_to_agui
from allhands.core.conversation import (
    Message,
    ReasoningBlock,
    TextBlock,
    ToolUseBlock,
)
from allhands.execution.internal_events import (
    AssistantMessageCommitted,
    AssistantMessagePartial,
    ConfirmationRequested,
    LoopExited,
    ToolCallProgress,
    ToolMessageCommitted,
)

THREAD = "thr_test"
RUN = "run_test"


def _now() -> datetime:
    return datetime.now(UTC)


# --- Partial events ---------------------------------------------------------


def test_partial_text_delta_emits_text_message_content() -> None:
    out = list(
        translate_to_agui(
            AssistantMessagePartial(message_id="m1", text_delta="hello"),
            thread_id=THREAD,
            run_id=RUN,
        )
    )
    assert len(out) == 1
    assert out[0].type == "TEXT_MESSAGE_CONTENT"
    assert out[0].message_id == "m1"
    assert out[0].delta == "hello"


def test_partial_reasoning_delta_emits_reasoning_chunk() -> None:
    out = list(
        translate_to_agui(
            AssistantMessagePartial(message_id="m1", reasoning_delta="thinking step"),
            thread_id=THREAD,
            run_id=RUN,
        )
    )
    assert len(out) == 1
    assert out[0].type == "REASONING_MESSAGE_CHUNK"
    assert out[0].delta == "thinking step"


def test_partial_with_both_deltas_emits_both_events() -> None:
    out = list(
        translate_to_agui(
            AssistantMessagePartial(message_id="m1", text_delta="hi", reasoning_delta="reason"),
            thread_id=THREAD,
            run_id=RUN,
        )
    )
    assert len(out) == 2
    assert {e.type for e in out} == {"TEXT_MESSAGE_CONTENT", "REASONING_MESSAGE_CHUNK"}


def test_partial_with_empty_deltas_emits_nothing() -> None:
    out = list(
        translate_to_agui(
            AssistantMessagePartial(message_id="m1"),
            thread_id=THREAD,
            run_id=RUN,
        )
    )
    assert out == []


# --- Assistant commit -------------------------------------------------------


def test_assistant_commit_text_only_emits_no_wire_events() -> None:
    """Text was already streamed via partials. The commit itself doesn't
    re-emit text on the wire — it's a state transition the SSE doesn't
    re-render."""
    msg = Message(
        id="m1",
        conversation_id="c1",
        role="assistant",
        content="hello",
        content_blocks=[TextBlock(text="hello")],
        created_at=_now(),
    )
    out = list(
        translate_to_agui(AssistantMessageCommitted(message=msg), thread_id=THREAD, run_id=RUN)
    )
    assert out == []


def test_assistant_commit_with_tool_use_emits_start_and_args() -> None:
    msg = Message(
        id="m1",
        conversation_id="c1",
        role="assistant",
        content="",
        content_blocks=[
            TextBlock(text="calling tools"),
            ToolUseBlock(id="tu1", name="add", input={"a": 1, "b": 2}),
        ],
        created_at=_now(),
    )
    out = list(
        translate_to_agui(AssistantMessageCommitted(message=msg), thread_id=THREAD, run_id=RUN)
    )
    types = [e.type for e in out]
    assert types == ["TOOL_CALL_START", "TOOL_CALL_ARGS"]
    start, args = out
    assert start.tool_call_id == "tu1"
    assert start.tool_call_name == "add"
    assert args.tool_call_id == "tu1"
    assert json.loads(args.delta) == {"a": 1, "b": 2}


def test_assistant_commit_with_two_tool_uses_emits_pairs_in_order() -> None:
    msg = Message(
        id="m1",
        conversation_id="c1",
        role="assistant",
        content="",
        content_blocks=[
            ToolUseBlock(id="tu1", name="add", input={"a": 1}),
            ToolUseBlock(id="tu2", name="mul", input={"a": 2}),
        ],
        created_at=_now(),
    )
    out = list(
        translate_to_agui(AssistantMessageCommitted(message=msg), thread_id=THREAD, run_id=RUN)
    )
    types = [e.type for e in out]
    assert types == ["TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_START", "TOOL_CALL_ARGS"]
    assert out[0].tool_call_id == "tu1"
    assert out[2].tool_call_id == "tu2"


def test_assistant_commit_reasoning_block_does_not_emit_tool_events() -> None:
    msg = Message(
        id="m1",
        conversation_id="c1",
        role="assistant",
        content="hi",
        content_blocks=[
            ReasoningBlock(text="hidden"),
            TextBlock(text="hi"),
        ],
        created_at=_now(),
    )
    out = list(
        translate_to_agui(AssistantMessageCommitted(message=msg), thread_id=THREAD, run_id=RUN)
    )
    assert out == []  # only tool_use blocks project to wire on commit


# --- Tool message commit ----------------------------------------------------


def test_tool_message_commit_emits_end_and_result() -> None:
    msg = Message(
        id="t1",
        conversation_id="c1",
        role="tool",
        content="",
        tool_call_id="tu1",
        created_at=_now(),
    )
    # Manually carry result via a dict-content message — for translation
    # tests, content is the structured payload to render.
    msg = msg.model_copy(update={"content": json.dumps({"sum": 5})})
    out = list(translate_to_agui(ToolMessageCommitted(message=msg), thread_id=THREAD, run_id=RUN))
    types = [e.type for e in out]
    assert types == ["TOOL_CALL_END", "TOOL_CALL_RESULT"]
    end, result = out
    assert end.tool_call_id == "tu1"
    assert result.tool_call_id == "tu1"
    assert json.loads(result.content) == {"sum": 5}


# --- Tool call progress (args streaming) ------------------------------------


def test_tool_call_progress_emits_args_delta() -> None:
    out = list(
        translate_to_agui(
            ToolCallProgress(tool_use_id="tu1", args_delta='{"code":"def '),
            thread_id=THREAD,
            run_id=RUN,
        )
    )
    assert len(out) == 1
    assert out[0].type == "TOOL_CALL_ARGS"
    assert out[0].tool_call_id == "tu1"
    assert out[0].delta == '{"code":"def '


# --- Confirmation requested -------------------------------------------------


def test_confirmation_requested_emits_custom_with_legacy_shape() -> None:
    """Wire shape preserves InterruptConfirmationGate's legacy CUSTOM
    payload so frontend dialog code stays unchanged."""
    out = list(
        translate_to_agui(
            ConfirmationRequested(
                confirmation_id="cf_x",
                tool_use_id="tu1",
                summary="run dangerous tool",
                rationale="because reasons",
                diff={"foo": "bar"},
            ),
            thread_id=THREAD,
            run_id=RUN,
        )
    )
    assert len(out) == 1
    assert out[0].type == "CUSTOM"
    assert out[0].name == "allhands.confirm_required"
    assert out[0].value == {
        "confirmation_id": "cf_x",
        "tool_call_id": "tu1",  # legacy field name preserved
        "summary": "run dangerous tool",
        "rationale": "because reasons",
        "diff": {"foo": "bar"},
    }


# --- Loop exit --------------------------------------------------------------


def test_loop_exited_completed_emits_run_finished() -> None:
    out = list(translate_to_agui(LoopExited(reason="completed"), thread_id=THREAD, run_id=RUN))
    assert len(out) == 1
    assert out[0].type == "RUN_FINISHED"
    assert out[0].thread_id == THREAD
    assert out[0].run_id == RUN


def test_loop_exited_max_iterations_emits_run_error_with_code() -> None:
    out = list(
        translate_to_agui(
            LoopExited(reason="max_iterations", detail="exceeded 10 iters"),
            thread_id=THREAD,
            run_id=RUN,
        )
    )
    assert len(out) == 1
    assert out[0].type == "RUN_ERROR"
    assert out[0].code == "MAX_ITERATIONS"
    assert out[0].message == "exceeded 10 iters"


def test_loop_exited_aborted_uses_reason_as_message_when_no_detail() -> None:
    out = list(translate_to_agui(LoopExited(reason="aborted"), thread_id=THREAD, run_id=RUN))
    assert out[0].type == "RUN_ERROR"
    assert out[0].code == "ABORTED"
    assert out[0].message == "aborted"


def test_loop_exited_empty_response_surfaces_as_run_error() -> None:
    """The "model said nothing" case must reach the UI as a real error,
    not a silent run_finished. Pairs with the AgentLoop change that
    distinguishes empty_response from completed."""
    out = list(
        translate_to_agui(
            LoopExited(
                reason="empty_response",
                detail="model produced no text and no tool calls",
            ),
            thread_id=THREAD,
            run_id=RUN,
        )
    )
    assert len(out) == 1
    assert out[0].type == "RUN_ERROR"
    assert out[0].code == "EMPTY_RESPONSE"
    assert "no text and no tool calls" in out[0].message
