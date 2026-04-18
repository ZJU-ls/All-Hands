"""Unit tests · execution/triggers/templating.py."""

from __future__ import annotations

from datetime import UTC, datetime

from allhands.execution.triggers.templating import (
    build_default_ctx,
    render_template,
)


def test_simple_variable() -> None:
    out = render_template("hello {{trigger.name}}", {"trigger": {"name": "daily"}})
    assert out == "hello daily"


def test_dotted_nested() -> None:
    out = render_template("{{event.run.id}}", {"event": {"run": {"id": "r1"}}})
    assert out == "r1"


def test_at_keyword() -> None:
    out = render_template("report for {{@yesterday}}", {"@yesterday": "2026-04-17"})
    assert out == "report for 2026-04-17"


def test_missing_variable_renders_blank() -> None:
    out = render_template("x={{trigger.missing}}y", {"trigger": {}})
    assert out == "x=y"


def test_non_string_coerced() -> None:
    out = render_template("count={{trigger.n}}", {"trigger": {"n": 42}})
    assert out == "count=42"


def test_build_default_ctx_shape() -> None:
    fired = datetime(2026, 4, 18, 12, 0, tzinfo=UTC)
    ctx = build_default_ctx(
        trigger_name="daily",
        fired_at=fired,
        event_payload={"x": 1},
    )
    assert ctx["trigger"]["name"] == "daily"
    assert ctx["@today"] == "2026-04-18"
    assert ctx["@yesterday"] == "2026-04-17"
    assert ctx["event"] == {"x": 1}
    assert ctx["@last_run"] == {}


def test_full_render_with_default_ctx() -> None:
    fired = datetime(2026, 4, 18, 12, 0, tzinfo=UTC)
    ctx = build_default_ctx(trigger_name="daily", fired_at=fired)
    out = render_template(
        "summarize {{@yesterday}} for {{trigger.name}}",
        ctx,
    )
    assert out == "summarize 2026-04-17 for daily"


def test_whitespace_inside_braces_ok() -> None:
    out = render_template("{{ trigger.name }}", {"trigger": {"name": "x"}})
    assert out == "x"


def test_no_braces_passthrough() -> None:
    assert render_template("plain text", {}) == "plain text"
