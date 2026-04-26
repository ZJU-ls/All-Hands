"""Schema-driven tool-arg validation with self-explanatory errors.

Principle (2026-04-27 round-22): when an LLM passes the wrong shape to a
tool, the failure must travel back to the model as a *structured*,
*self-explanatory* `ToolMessage`. The previous behaviour was to surface
Pydantic's raw `ValidationError`, which the LLM read as opaque text and
then guessed-and-tried until it timed out.

Contract returned to the model on failure::

    {
        "error": "tool input validation failed",
        "field":   "<top-level arg name>",
        "expected":"<JSON Schema type · 'array' / 'object' / 'string' / ...>",
        "received":"<short summary of what came in>",
        "hint":    "<one-sentence concrete fix>"
    }

The LLM then sees "expected array, got stringified JSON · pass the array
literal directly" and self-corrects on the very next turn. No prompt
patches, no provider-specific gymnastics.

Coercion is allowed where a fuzzy LLM mistake has an obvious right
answer: a stringified JSON object/array gets parsed if the schema
expects an object/array. Anything else is rejected with a hint.

Backwards-compatible: callers that don't pass a schema get the legacy
`_coerce_stringified_json` behaviour (parse where parseable, leave the
rest alone).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from allhands.core import Tool

__all__ = [
    "ToolArgError",
    "coerce_and_validate",
    "lenient_coerce",
]


@dataclass
class ToolArgError(Exception):
    """Schema validation failure that the LLM should be able to self-correct.

    Carries the exact pieces a model needs to fix its next call: which
    field, what the schema wants, what it actually got, and one
    actionable hint. Do NOT format the message yourself when raising —
    let `to_payload()` produce the canonical envelope.
    """

    field: str
    expected: str
    received: str
    hint: str

    def __str__(self) -> str:  # pragma: no cover - rarely triggered
        return (
            f"tool input validation failed: field={self.field!r} "
            f"expected={self.expected!r} received={self.received!r} hint={self.hint!r}"
        )

    def to_payload(self) -> dict[str, str]:
        """Return the structured error envelope wrapped into the
        ToolMessage content. The shape is the contract the LLM consumes;
        do not change keys without adapting the prompt-side guidance.
        """
        return {
            "error": "tool input validation failed",
            "field": self.field,
            "expected": self.expected,
            "received": self.received,
            "hint": self.hint,
        }


# --- helpers --------------------------------------------------------------


_TYPE_NAMES: dict[type, str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    list: "array",
    dict: "object",
    type(None): "null",
}


def _python_type_name(value: Any) -> str:
    if isinstance(value, bool):
        # bool must be checked before int (bool subclasses int)
        return "boolean"
    for cls, name in _TYPE_NAMES.items():
        if isinstance(value, cls):
            return name
    return type(value).__name__


def _matches(value: Any, expected: str) -> bool:
    """JSON Schema type test, with the int/number subtyping JSON Schema
    expects: an int satisfies expected="number" but not the other way."""
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, int | float) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "null":
        return value is None
    return True  # unknown / open type → accept


def _summarise(value: Any, field: str) -> str:
    """Produce a short, model-readable summary of what was actually received.

    For oversize/multiline values we truncate to the first ~80 chars and
    note the type so the LLM can correlate without dumping a huge blob
    into the next-turn context.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return f"boolean {value}"
    if isinstance(value, int | float):
        return f"{_python_type_name(value)} {value}"
    if isinstance(value, str):
        head = value.strip().splitlines()[0] if value.strip() else ""
        if len(head) > 80:
            head = head[:80] + "…"
        return (
            f"string ({len(value)} chars) starting with {head!r}"
            if head
            else "empty string"
        )
    if isinstance(value, list):
        return f"array (length {len(value)})"
    if isinstance(value, dict):
        keys = list(value.keys())[:5]
        return f"object with keys {keys}"
    return f"{type(value).__name__} value"


def _try_parse_json(text: str) -> tuple[Any, str | None]:
    """Best-effort JSON parse. Returns (parsed, error_msg)."""
    try:
        return json.loads(text), None
    except (ValueError, TypeError) as exc:
        return None, str(exc)


# --- public API -----------------------------------------------------------


def lenient_coerce(kwargs: dict[str, Any]) -> dict[str, Any]:
    """Legacy schema-less coercion · parse stringified objects/arrays.

    Kept for callers that don't have a Tool reference (legacy paths).
    Behaviour matches the pre-validation `_coerce_stringified_json`
    helper — any string starting with `{` or `[` that parses as JSON is
    promoted to dict/list.
    """
    out: dict[str, Any] = {}
    for k, v in kwargs.items():
        if isinstance(v, str):
            stripped = v.strip()
            if stripped.startswith(("{", "[")):
                parsed, _ = _try_parse_json(stripped)
                if isinstance(parsed, dict | list):
                    out[k] = parsed
                    continue
        out[k] = v
    return out


def coerce_and_validate(tool: Tool, kwargs: dict[str, Any]) -> dict[str, Any]:
    """Validate `kwargs` against `tool.input_schema`, coerce safely.

    Steps:
    1. Required keys missing → ToolArgError(field, expected="present", ...)
    2. For each provided key with a schema-declared type:
       - Type matches → keep as-is.
       - String supplied but schema expects array/object → try json.loads;
         success → coerce silently; failure → ToolArgError with the parse
         error embedded in `received` so the LLM sees both the wrong shape
         AND the parse failure point (most actionable).
       - String supplied but schema expects integer/number → try int/float;
         success → coerce; failure → ToolArgError.
       - Otherwise (e.g. boolean expected, string given) → ToolArgError.
    3. If schema declares `enum` for a field, value must be in it.

    Tool input schemas in this codebase are simple flat JSON Schema; we
    don't drill into nested object validation here — nested validation
    happens inside the executor (Pydantic models). This function is the
    OUTERMOST gate so the LLM gets a meaningful hint before reaching
    Pydantic at all.
    """
    schema = tool.input_schema or {}
    properties_raw = schema.get("properties") or {}
    properties: dict[str, Any] = (
        properties_raw if isinstance(properties_raw, dict) else {}
    )
    required_raw = schema.get("required") or []
    required: list[str] = list(required_raw) if isinstance(required_raw, list) else []

    # Step 1 — required.
    for field in required:
        if field not in kwargs or kwargs[field] is None:
            spec = properties.get(field) or {}
            expected_type = str(spec.get("type") or "value")
            description = (spec.get("description") or "").strip()
            hint = (
                f"Pass `{field}` in the tool call. "
                + (f"It is described as: {description[:120]}" if description else "")
            ).strip()
            raise ToolArgError(
                field=field,
                expected=expected_type,
                received="missing or null",
                hint=hint or f"`{field}` is required.",
            )

    # Step 2 — type coercion + validation per property.
    out: dict[str, Any] = {}
    for k, v in kwargs.items():
        spec = properties.get(k)
        if not isinstance(spec, dict):
            # Open / unknown property — pass through (lenient on extras).
            out[k] = v
            continue

        expected_type_raw = spec.get("type")
        # JSON Schema allows `type` to be a list (e.g. ["string", "null"]).
        accepted: list[str]
        if isinstance(expected_type_raw, list):
            accepted = [str(t) for t in expected_type_raw]
        elif isinstance(expected_type_raw, str):
            accepted = [expected_type_raw]
        else:
            accepted = []

        # Already matches one of the accepted types? Done.
        if not accepted or any(_matches(v, t) for t in accepted):
            out[k] = _check_enum(spec, k, v)
            continue

        # Coerce.
        coerced, parse_err = _try_coerce(v, accepted)
        if coerced is _UNCOERCED:
            primary = accepted[0] if accepted else "value"
            received_summary = _summarise(v, k)
            if parse_err:
                received_summary = f"{received_summary} · JSON parse failed: {parse_err}"
            raise ToolArgError(
                field=k,
                expected=primary
                if len(accepted) == 1
                else " | ".join(accepted),
                received=received_summary,
                hint=_hint_for(k, primary, v, spec),
            )
        out[k] = _check_enum(spec, k, coerced)

    return out


# Sentinel for "coercion was attempted but didn't succeed".
_UNCOERCED: Any = object()


def _try_coerce(value: Any, accepted: list[str]) -> tuple[Any, str | None]:
    """Try to convert `value` to one of the accepted JSON Schema types.

    Returns (coerced_value, parse_error_or_None). When coercion fails
    the value is `_UNCOERCED` and parse_error may carry the JSON parse
    diagnostic to help the model debug.
    """
    # array / object from stringified JSON
    if isinstance(value, str) and ("array" in accepted or "object" in accepted):
        stripped = value.strip()
        parsed, err = _try_parse_json(stripped)
        if isinstance(parsed, list) and "array" in accepted:
            return parsed, None
        if isinstance(parsed, dict) and "object" in accepted:
            return parsed, None
        return _UNCOERCED, err

    # numeric coercion
    if isinstance(value, str):
        s = value.strip()
        if "integer" in accepted:
            try:
                return int(s), None
            except (ValueError, TypeError):
                pass
        if "number" in accepted:
            try:
                return float(s), None
            except (ValueError, TypeError):
                pass

    # int passed where number expected — already covered by _matches above

    return _UNCOERCED, None


def _check_enum(spec: dict[str, Any], field: str, value: Any) -> Any:
    enum = spec.get("enum")
    if not isinstance(enum, list) or not enum:
        return value
    if value not in enum:
        raise ToolArgError(
            field=field,
            expected=f"one of {enum}",
            received=_summarise(value, field),
            hint=f"Pass one of these values verbatim for `{field}`: {enum}.",
        )
    return value


def _hint_for(field: str, expected: str, value: Any, spec: dict[str, Any]) -> str:
    """Per-shape concrete fix sentence."""
    desc = (spec.get("description") or "").strip()
    desc_clip = desc[:120] + ("…" if len(desc) > 120 else "")

    if expected == "array":
        return (
            f"Pass `{field}` as a JSON array literal in the tool call arguments, "
            f"not as a stringified JSON value. "
            f'Example: "{field}": [{{"name":"...","rows":[...]}}].'
        )
    if expected == "object":
        return (
            f"Pass `{field}` as a JSON object literal, not as a string. "
            f'Example: "{field}": {{"key":"value"}}.'
        )
    if expected == "integer":
        return f"Pass `{field}` as a JSON integer (no quotes)." + (
            f" {desc_clip}" if desc_clip else ""
        )
    if expected == "number":
        return f"Pass `{field}` as a JSON number (no quotes)." + (
            f" {desc_clip}" if desc_clip else ""
        )
    if expected == "boolean":
        return f"Pass `{field}` as JSON `true` or `false` (lowercase, no quotes)."
    if expected == "string":
        return f"Pass `{field}` as a string." + (f" {desc_clip}" if desc_clip else "")
    return f"Check the schema for `{field}`."
