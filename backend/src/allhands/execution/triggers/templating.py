"""Trigger template renderer — {{dotted.path}} and {{@keyword}} substitution.

See docs/specs/agent-design/2026-04-18-triggers.md § 6.

Deliberately tiny (no Jinja2): each `{{...}}` token is looked up against a
context dict using dotted path traversal. `@yesterday` / `@today` / `@last_run`
are pre-computed by the executor and passed as regular ctx keys (prefix is
kept so the template text stays 1:1 with the spec).

Unknown variables render as empty string — trigger templates are authored
interactively and crashing on a typo is worse than a visible blank in the
resulting task.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta
from typing import Any

_TOKEN_RE = re.compile(r"\{\{\s*([^{}\s]+)\s*\}\}")


def _lookup(ctx: dict[str, Any], dotted: str) -> Any:
    parts = dotted.split(".")
    node: Any = ctx.get(parts[0])
    for key in parts[1:]:
        node = node.get(key) if isinstance(node, dict) else getattr(node, key, None)
        if node is None:
            return None
    return node


def render_template(template: str, ctx: dict[str, Any]) -> str:
    """Render `{{var}}` and `{{@kw}}` substitutions against ctx.

    Unknown variables resolve to "". Non-string values are str()-coerced.
    """

    def _sub(match: re.Match[str]) -> str:
        key = match.group(1)
        value = _lookup(ctx, key)
        return "" if value is None else str(value)

    return _TOKEN_RE.sub(_sub, template)


def build_default_ctx(
    trigger_name: str,
    fired_at: datetime,
    event_payload: dict[str, Any] | None = None,
    timer_scheduled_at: datetime | None = None,
    last_run: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the ctx dict the executor hands to render_template.

    Mirrors spec § 6 table: trigger.*, event.*, timer.*, @today, @yesterday,
    @last_run.output_refs. UTC-only — we never render local-tz strings.
    """
    today: date = fired_at.astimezone(UTC).date()
    return {
        "trigger": {
            "name": trigger_name,
            "fired_at": fired_at.isoformat(),
        },
        "event": event_payload or {},
        "timer": {
            "scheduled_at": (timer_scheduled_at.isoformat() if timer_scheduled_at else ""),
        },
        "@today": today.isoformat(),
        "@yesterday": (today - timedelta(days=1)).isoformat(),
        "@last_run": last_run or {},
    }
