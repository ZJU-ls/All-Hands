"""Regression: LLMs that serialize nested tool args as JSON strings must not
crash with `ToolInvocationError` (Pydantic ValidationError) — the runner's
`_CoercingStructuredTool` parses strings that successfully decode to a dict
or list back into structured values before validation runs.

Real-world trigger (seen in production):

    render_stat(label="今日活跃员工数", value="12", delta='{"value": 2, "direction": "up"}')

Pydantic v2 (lax mode) does NOT auto-coerce `str → dict`, so `delta` as a
JSON string blows up. Same pattern for `render_bar_chart(bars='[...]')` and
any other render tool with nested object/array args.
"""

from __future__ import annotations

from allhands.execution.runner import _coerce_stringified_json


def test_parses_json_object_string_to_dict() -> None:
    kwargs = {"delta": '{"value": 2, "direction": "up"}'}
    out = _coerce_stringified_json(kwargs)
    assert out == {"delta": {"value": 2, "direction": "up"}}


def test_parses_json_array_string_to_list() -> None:
    kwargs = {"bars": '[{"label": "A", "value": 12}, {"label": "B", "value": 8}]'}
    out = _coerce_stringified_json(kwargs)
    assert isinstance(out["bars"], list)
    assert out["bars"][0] == {"label": "A", "value": 12}


def test_preserves_already_structured_values() -> None:
    # Idempotent — double-coercion must not break dicts/lists already structured.
    kwargs = {
        "delta": {"value": 2, "direction": "up"},
        "bars": [{"label": "A", "value": 12}],
        "label": "Today's users",
        "value": 123,
    }
    assert _coerce_stringified_json(kwargs) == kwargs


def test_leaves_plain_strings_untouched() -> None:
    # A human caption that happens to start with "{" but isn't JSON stays a str.
    kwargs = {"caption": "{not json}", "label": "hello", "value": "not a number"}
    out = _coerce_stringified_json(kwargs)
    assert out == kwargs


def test_leaves_numeric_and_none_values_untouched() -> None:
    kwargs = {"value": 12, "unit": None, "caption": ""}
    assert _coerce_stringified_json(kwargs) == kwargs


def test_ignores_string_that_parses_to_primitive() -> None:
    # '"foo"' is valid JSON (to the string "foo") but we only rescue dict/list
    # to avoid surprise-coercing captions/labels.
    kwargs = {"caption": '"foo"', "n": "123"}
    out = _coerce_stringified_json(kwargs)
    assert out == kwargs


def test_real_render_stat_failing_call() -> None:
    # The exact kwargs shape that crashed in production (from user report).
    kwargs = {
        "label": "今日活跃员工数",
        "value": "12",
        "delta": '{"value": 2, "direction": "up", "tone": "positive"}',
    }
    out = _coerce_stringified_json(kwargs)
    assert out["label"] == "今日活跃员工数"
    assert out["value"] == "12"  # value can be str|number per schema; left alone
    assert out["delta"] == {"value": 2, "direction": "up", "tone": "positive"}
