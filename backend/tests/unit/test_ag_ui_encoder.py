"""Unit tests for the AG-UI Protocol SSE encoder (ADR 0010)."""

from __future__ import annotations

import json

import pytest

from allhands.api import ag_ui_encoder as ag


def _parse_sse(frame: bytes) -> tuple[str, dict]:
    """Tiny SSE frame parser for tests: returns (event_name, data_dict)."""
    text = frame.decode("utf-8")
    assert text.endswith("\n\n"), "frame must end with blank line"
    event_line, data_line, _blank = text.split("\n", 2)
    assert event_line.startswith("event: ")
    event_name = event_line[len("event: ") :]
    # _blank may contain more than just "" when multi-line — here we know
    # the encoder emits exactly two content lines + one blank.
    assert data_line.startswith("data: ")
    data_body = data_line[len("data: ") :]
    return event_name, json.loads(data_body)


class TestLifecycleFactories:
    def test_run_started_roundtrip(self) -> None:
        evt = ag.run_started("conv_123", "run_abc")
        name, data = _parse_sse(ag.encode_sse(evt))
        assert name == "RUN_STARTED"
        assert data == {"type": "RUN_STARTED", "threadId": "conv_123", "runId": "run_abc"}

    def test_run_finished_roundtrip(self) -> None:
        evt = ag.run_finished("conv_123", "run_abc")
        name, data = _parse_sse(ag.encode_sse(evt))
        assert name == "RUN_FINISHED"
        assert data == {"type": "RUN_FINISHED", "threadId": "conv_123", "runId": "run_abc"}

    def test_run_error_with_code(self) -> None:
        evt = ag.run_error("boom", "INTERNAL")
        name, data = _parse_sse(ag.encode_sse(evt))
        assert name == "RUN_ERROR"
        assert data == {"type": "RUN_ERROR", "message": "boom", "code": "INTERNAL"}

    def test_run_error_without_code_omits_field(self) -> None:
        _, data = _parse_sse(ag.encode_sse(ag.run_error("only msg")))
        assert "code" not in data
        assert data["message"] == "only msg"

    def test_step_started_and_finished(self) -> None:
        _, start = _parse_sse(ag.encode_sse(ag.step_started("agent.think")))
        _, end = _parse_sse(ag.encode_sse(ag.step_finished("agent.think")))
        assert start == {"type": "STEP_STARTED", "stepName": "agent.think"}
        assert end == {"type": "STEP_FINISHED", "stepName": "agent.think"}


class TestTextMessageFactories:
    def test_start_content_end_sequence(self) -> None:
        start = _parse_sse(ag.encode_sse(ag.text_message_start("m1")))
        content = _parse_sse(ag.encode_sse(ag.text_message_content("m1", "hel")))
        end = _parse_sse(ag.encode_sse(ag.text_message_end("m1")))

        assert start == (
            "TEXT_MESSAGE_START",
            {"type": "TEXT_MESSAGE_START", "messageId": "m1", "role": "assistant"},
        )
        assert content == (
            "TEXT_MESSAGE_CONTENT",
            {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "hel"},
        )
        assert end == ("TEXT_MESSAGE_END", {"type": "TEXT_MESSAGE_END", "messageId": "m1"})

    def test_chunk_convenience(self) -> None:
        name, data = _parse_sse(ag.encode_sse(ag.text_message_chunk("m2", "x")))
        assert name == "TEXT_MESSAGE_CHUNK"
        assert data == {
            "type": "TEXT_MESSAGE_CHUNK",
            "messageId": "m2",
            "role": "assistant",
            "delta": "x",
        }

    def test_start_role_override(self) -> None:
        _, data = _parse_sse(ag.encode_sse(ag.text_message_start("m3", role="user")))
        assert data["role"] == "user"

    def test_content_preserves_unicode(self) -> None:
        _, data = _parse_sse(ag.encode_sse(ag.text_message_content("m4", "你好")))
        assert data["delta"] == "你好"


class TestReasoningFactories:
    def test_reasoning_chunk_then_end(self) -> None:
        chunk = _parse_sse(ag.encode_sse(ag.reasoning_message_chunk("r1", "think")))
        end = _parse_sse(ag.encode_sse(ag.reasoning_message_end("r1")))
        assert chunk[0] == "REASONING_MESSAGE_CHUNK"
        assert chunk[1]["delta"] == "think"
        assert chunk[1]["role"] == "assistant"
        assert end[0] == "REASONING_MESSAGE_END"
        assert end[1] == {"type": "REASONING_MESSAGE_END", "messageId": "r1"}


class TestToolCallFactories:
    def test_full_tool_call_sequence(self) -> None:
        start = _parse_sse(ag.encode_sse(ag.tool_call_start("call_1", "fetch_url")))
        args = _parse_sse(ag.encode_sse(ag.tool_call_args("call_1", '{"url":"x"}')))
        end = _parse_sse(ag.encode_sse(ag.tool_call_end("call_1")))
        result = _parse_sse(ag.encode_sse(ag.tool_call_result("call_1", "OK")))

        assert start[0] == "TOOL_CALL_START"
        assert start[1] == {
            "type": "TOOL_CALL_START",
            "toolCallId": "call_1",
            "toolCallName": "fetch_url",
        }
        assert args[1]["delta"] == '{"url":"x"}'
        assert end[1] == {"type": "TOOL_CALL_END", "toolCallId": "call_1"}
        assert result[1] == {
            "type": "TOOL_CALL_RESULT",
            "toolCallId": "call_1",
            "content": "OK",
        }


class TestStateAndExtensionFactories:
    def test_state_snapshot(self) -> None:
        _, data = _parse_sse(ag.encode_sse(ag.state_snapshot({"a": 1})))
        assert data == {"type": "STATE_SNAPSHOT", "snapshot": {"a": 1}}

    def test_state_delta_is_patch_array(self) -> None:
        _, data = _parse_sse(
            ag.encode_sse(ag.state_delta([{"op": "replace", "path": "/foo", "value": 42}]))
        )
        assert data["type"] == "STATE_DELTA"
        assert data["patch"] == [{"op": "replace", "path": "/foo", "value": 42}]

    def test_custom_preserves_private_payload_shape(self) -> None:
        # allhands private payloads keep snake_case inside value
        private = {"confirmation_id": "c1", "tool_call_id": "t1"}
        _, data = _parse_sse(ag.encode_sse(ag.custom("allhands.confirm_required", private)))
        assert data == {
            "type": "CUSTOM",
            "name": "allhands.confirm_required",
            "value": private,
        }

    def test_raw_wraps_external_event(self) -> None:
        _, data = _parse_sse(ag.encode_sse(ag.raw("openai", {"id": "chatcmpl-x", "choices": []})))
        assert data["type"] == "RAW"
        assert data["source"] == "openai"
        assert data["event"] == {"id": "chatcmpl-x", "choices": []}


class TestEncoderContract:
    def test_frame_ends_with_blank_line(self) -> None:
        frame = ag.encode_sse(ag.run_started("t", "r"))
        assert frame.endswith(b"\n\n")

    def test_none_fields_omitted_from_body(self) -> None:
        # patch is None on a RUN_STARTED — must not appear in the data
        frame = ag.encode_sse(ag.run_started("t", "r"))
        text = frame.decode()
        assert "patch" not in text
        assert "snapshot" not in text

    def test_event_name_equals_type_field(self) -> None:
        for factory, required_fields in [
            (lambda: ag.run_started("t", "r"), {"type", "threadId", "runId"}),
            (lambda: ag.text_message_start("m"), {"type", "messageId", "role"}),
            (lambda: ag.custom("n", {"k": 1}), {"type", "name", "value"}),
        ]:
            evt = factory()
            name, data = _parse_sse(ag.encode_sse(evt))
            assert name == evt.type
            assert data["type"] == evt.type
            assert required_fields.issubset(set(data.keys()))

    def test_standard_event_set_is_stable(self) -> None:
        assert "CUSTOM" in ag.AG_UI_STANDARD_EVENTS
        assert "RUN_STARTED" in ag.AG_UI_STANDARD_EVENTS
        assert "TEXT_MESSAGE_CONTENT" in ag.AG_UI_STANDARD_EVENTS
        assert "foo" not in ag.AG_UI_STANDARD_EVENTS

    def test_invalid_event_type_rejected(self) -> None:
        with pytest.raises(Exception):
            ag.AgUiEvent(type="NOT_REAL")  # type: ignore[arg-type]
