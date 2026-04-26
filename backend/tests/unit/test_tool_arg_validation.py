"""Schema-driven tool-arg validator (iter 2 · 2026-04-27 round-22).

The point of this test file is to pin the *contract the LLM consumes when
its tool call shape is wrong*. The error envelope must carry:
- `error: "tool input validation failed"`
- `field`: which arg
- `expected`: JSON Schema type
- `received`: short human-readable summary of what came in (incl. parse
  errors when JSON parse was attempted)
- `hint`: a concrete next-action sentence the model can follow

If any of those fields silently disappear, the model's self-correction
loop breaks and we fall back to "guess and try" behaviour.
"""

from __future__ import annotations

from typing import Any

import pytest

from allhands.core import Tool, ToolKind, ToolScope
from allhands.execution.tool_arg_validation import (
    ToolArgError,
    coerce_and_validate,
    lenient_coerce,
)


def _tool(input_schema: dict[str, Any]) -> Tool:
    return Tool(
        id="test.tool",
        kind=ToolKind.META,
        name="test_tool",
        description="x",
        input_schema=input_schema,
        output_schema={},
        scope=ToolScope.READ,
        requires_confirmation=False,
    )


# -------- happy path -----------------------------------------------------


def test_typed_args_pass_through_unchanged() -> None:
    tool = _tool(
        {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "count": {"type": "integer"},
                "items": {"type": "array"},
            },
            "required": ["name"],
        }
    )
    out = coerce_and_validate(
        tool,
        {"name": "alice", "count": 3, "items": [1, 2]},
    )
    assert out == {"name": "alice", "count": 3, "items": [1, 2]}


def test_extra_args_pass_through() -> None:
    """Be lenient on unknown extras — the LLM might add explanation kwargs."""
    tool = _tool({"type": "object", "properties": {"name": {"type": "string"}}})
    out = coerce_and_validate(tool, {"name": "alice", "extra": "ignored"})
    assert out["extra"] == "ignored"


def test_open_property_no_type_passes_through() -> None:
    tool = _tool(
        {"type": "object", "properties": {"payload": {"description": "anything"}}}
    )
    out = coerce_and_validate(tool, {"payload": {"k": "v"}})
    assert out["payload"] == {"k": "v"}


# -------- coercion (the helpful path) -----------------------------------


def test_stringified_array_coerced_to_array() -> None:
    """Most common LLM bug: array arg sent as a JSON string.
    Must coerce silently — but only because schema says array."""
    tool = _tool(
        {
            "type": "object",
            "properties": {"sheets": {"type": "array"}},
            "required": ["sheets"],
        }
    )
    out = coerce_and_validate(tool, {"sheets": '[{"name":"Q1","rows":[]}]'})
    assert out["sheets"] == [{"name": "Q1", "rows": []}]


def test_stringified_object_coerced_to_object() -> None:
    tool = _tool({"type": "object", "properties": {"meta": {"type": "object"}}})
    out = coerce_and_validate(tool, {"meta": '{"a":1,"b":2}'})
    assert out["meta"] == {"a": 1, "b": 2}


def test_string_int_coerced_to_integer() -> None:
    tool = _tool({"type": "object", "properties": {"limit": {"type": "integer"}}})
    out = coerce_and_validate(tool, {"limit": "42"})
    assert out["limit"] == 42


def test_string_number_coerced_to_float() -> None:
    tool = _tool({"type": "object", "properties": {"ratio": {"type": "number"}}})
    out = coerce_and_validate(tool, {"ratio": "0.75"})
    assert out["ratio"] == 0.75


# -------- structured failure path (the educational ones) ----------------


def test_missing_required_arg_raises_with_hint() -> None:
    tool = _tool(
        {
            "type": "object",
            "properties": {"name": {"type": "string", "description": "user-facing title."}},
            "required": ["name"],
        }
    )
    with pytest.raises(ToolArgError) as ex:
        coerce_and_validate(tool, {})
    e = ex.value
    assert e.field == "name"
    assert e.expected == "string"
    assert "missing" in e.received
    payload = e.to_payload()
    assert payload["error"] == "tool input validation failed"
    assert payload["field"] == "name"
    assert payload["hint"]


def test_array_field_received_unparseable_string_explains_parse_error() -> None:
    """Real-world case: LLM sent `sheets='[{"name":"Q1"...'` truncated /
    malformed. The error envelope must include the JSON parse failure
    location so the model knows what to fix."""
    tool = _tool(
        {
            "type": "object",
            "properties": {"sheets": {"type": "array"}},
        }
    )
    bad = '[{"name":"Q1","rows":[1,2,3'  # truncated
    with pytest.raises(ToolArgError) as ex:
        coerce_and_validate(tool, {"sheets": bad})
    e = ex.value
    assert e.field == "sheets"
    assert e.expected == "array"
    assert "string" in e.received
    assert "JSON parse failed" in e.received
    assert "JSON array literal" in e.hint


def test_array_field_received_object_string_does_not_silently_coerce() -> None:
    """If schema says array but the LLM sends a string of JSON object,
    we must NOT silently accept the object — must error out so the model
    learns the right shape."""
    tool = _tool({"type": "object", "properties": {"sheets": {"type": "array"}}})
    with pytest.raises(ToolArgError) as ex:
        coerce_and_validate(tool, {"sheets": '{"oops":"this is an object"}'})
    e = ex.value
    assert e.field == "sheets"
    assert e.expected == "array"


def test_integer_field_received_non_numeric_string_raises() -> None:
    tool = _tool({"type": "object", "properties": {"limit": {"type": "integer"}}})
    with pytest.raises(ToolArgError) as ex:
        coerce_and_validate(tool, {"limit": "many"})
    assert ex.value.field == "limit"
    assert ex.value.expected == "integer"


def test_boolean_field_received_string_raises() -> None:
    tool = _tool({"type": "object", "properties": {"verbose": {"type": "boolean"}}})
    with pytest.raises(ToolArgError) as ex:
        coerce_and_validate(tool, {"verbose": "yes"})
    assert ex.value.expected == "boolean"
    assert "true" in ex.value.hint and "false" in ex.value.hint


def test_enum_violation_raises_with_choices() -> None:
    tool = _tool(
        {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["markdown", "html"]}
            },
        }
    )
    with pytest.raises(ToolArgError) as ex:
        coerce_and_validate(tool, {"source": "json"})
    e = ex.value
    assert "markdown" in e.expected and "html" in e.expected
    # full enum list rendered in hint so the LLM can verbatim-copy
    assert "['markdown', 'html']" in e.hint


def test_received_summary_truncates_long_strings() -> None:
    """Long bodies get truncated — saves model context AND keeps the
    error short enough to actually read."""
    tool = _tool({"type": "object", "properties": {"sheets": {"type": "array"}}})
    bad = "x" * 500  # not even json-shaped; just type mismatch
    with pytest.raises(ToolArgError) as ex:
        coerce_and_validate(tool, {"sheets": bad})
    assert "500 chars" in ex.value.received
    # only the head shows up, with ellipsis
    assert "…" in ex.value.received


def test_nullable_field_via_type_array_accepts_null() -> None:
    """JSON Schema allows `type: ["string", "null"]` for nullable. We
    must accept None for those declarations."""
    tool = _tool(
        {
            "type": "object",
            "properties": {"label": {"type": ["string", "null"]}},
        }
    )
    out = coerce_and_validate(tool, {"label": None})
    assert out["label"] is None


# -------- legacy lenient path -------------------------------------------


def test_lenient_coerce_parses_object_strings() -> None:
    out = lenient_coerce({"a": '{"k":1}', "b": "[1,2]", "c": "plain"})
    assert out == {"a": {"k": 1}, "b": [1, 2], "c": "plain"}


def test_lenient_coerce_leaves_nonjson_alone() -> None:
    out = lenient_coerce({"x": "hello world"})
    assert out["x"] == "hello world"
